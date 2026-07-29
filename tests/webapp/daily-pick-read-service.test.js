const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFavoriteLeagueMap,
  filterRowsByFavoriteLeagues,
  getMoscowDate,
  buildSlotMap,
  getDailyPicksFeed,
} = require('../../webapp/services/dailyPickReadService');
const { createFakePg } = require('./testHelpers');

const LOCKED_BETS = [
  { type: 'one_x_two', outcome: 'w1' },
  { type: 'total_over', outcome: '2_5' },
  { type: 'both_to_score', outcome: 'yes' },
];

test('buildFavoriteLeagueMap: empty leagues mean all leagues for that sport', () => {
  const map = buildFavoriteLeagueMap([
    { sport_name: 'Футбол', leagues: ['Premier League'] },
    { sport_name: 'Теннис', leagues: [] },
  ]);

  assert.deepEqual([...map.get('футбол')], ['premier league', 'премьер-лига', 'апл']);
  assert.equal(map.get('теннис').size, 0);
});

test('filterRowsByFavoriteLeagues: keeps only rows from selected leagues and selected sports', () => {
  const rows = [
    { sport_name: 'Футбол', tournament_name_en: 'Premier League' },
    { sport_name: 'Футбол', tournament_name_en: 'Ykkosliiga' },
    { sport_name: 'Теннис', tournament_name_en: 'ATP' },
    { sport_name: 'Хоккей', tournament_name_en: 'NHL' },
  ];

  const filtered = filterRowsByFavoriteLeagues(rows, [
    { sport_name: 'Футбол', leagues: ['Premier League'] },
    { sport_name: 'Теннис', leagues: [] },
  ]);

  assert.deepEqual(filtered, [
    { sport_name: 'Футбол', tournament_name_en: 'Premier League' },
    { sport_name: 'Теннис', tournament_name_en: 'ATP' },
  ]);
});

test('filterRowsByFavoriteLeagues: same league name in another sport does not match', () => {
  const rows = [
    { sport_name: 'Футбол', tournament_name_en: 'World Cup' },
    { sport_name: 'Хоккей', tournament_name_en: 'World Cup' },
  ];

  const filtered = filterRowsByFavoriteLeagues(rows, [
    { sport_name: 'Футбол', leagues: ['World Cup'] },
  ]);

  assert.deepEqual(filtered, [
    { sport_name: 'Футбол', tournament_name_en: 'World Cup' },
  ]);
});

test('filterRowsByFavoriteLeagues: accepts explicit Russian and English canonical tournament aliases', () => {
  const rows = [
    { sport_name: 'Футбол', tournament_name: 'Лига чемпионов УЕФА' },
    { sport_name: 'Футбол', tournament_name: 'Премьер-лига' },
    { sport_name: 'Футбол', tournament_name: 'Лига 1' },
  ];

  const filtered = filterRowsByFavoriteLeagues(rows, [
    { sport_name: 'Футбол', leagues: ['Champions League', 'Premier League'] },
  ]);

  assert.deepEqual(filtered, rows.slice(0, 2));
});

test('buildSlotMap: formats today/tomorrow cards and keeps first row per slot_date', () => {
  const rows = [
    {
      slot_date: '2026-07-03',
      match_analysis_id: 11,
      match_id: 101,
      system_match_id: 'sys-101',
      home_team: 'Alpha FC',
      away_team: 'Beta FC',
      sport_name: 'Футбол',
      tournament_name: 'Лига 1',
      tournament_name_en: 'Ligue 1',
      match_start_at: '2026-07-03T15:00:00.000Z',
      analysis_status_name: 'ready',
      analysis_headline: 'Сегодняшний пик',
      analysis_brief: 'Короткий бриф',
      analysis_risk_note: 'Риск умеренный',
      recommended_bets: LOCKED_BETS,
      source_payload: { match_slug: 'alpha-beta', source_url: 'https://example.test/m/101', source_refs: ['card'] },
      model_name: 'gpt',
      prompt_version: 'v1',
      analysis_create_at: '2026-07-03T10:00:00.000Z',
      analysis_update_at: '2026-07-03T10:05:00.000Z',
    },
    {
      slot_date: '2026-07-03',
      match_analysis_id: 12,
      match_id: 102,
      home_team: 'Ignored',
      away_team: 'Ignored',
      recommended_bets: LOCKED_BETS,
      source_payload: {},
    },
    {
      slot_date: '2026-07-04',
      match_analysis_id: 21,
      match_id: 201,
      system_match_id: 'sys-201',
      home_team: 'Gamma FC',
      away_team: 'Delta FC',
      sport_name: 'Футбол',
      tournament_name: null,
      tournament_name_en: 'Premier League',
      match_start_at: '2026-07-04T18:30:00.000Z',
      analysis_status_name: 'ready',
      analysis_headline: 'Завтрашний пик',
      analysis_brief: 'Ещё один бриф',
      analysis_risk_note: '',
      recommended_bets: LOCKED_BETS,
      source_payload: { source_refs: 'bad-value' },
      model_name: 'gpt',
      prompt_version: 'v2',
      analysis_create_at: '2026-07-03T11:00:00.000Z',
      analysis_update_at: '2026-07-03T11:10:00.000Z',
    },
  ];

  const slots = buildSlotMap(rows);
  assert.equal(slots.size, 2);

  const today = slots.get('2026-07-03');
  assert.equal(today.id, 'daily-pick:2026-07-03:11');
  assert.equal(today.match, 'Alpha FC — Beta FC');
  assert.equal(today.match_slug, 'alpha-beta');
  assert.equal(today.league, 'Лига 1');
  assert.deepEqual(today.primary_bet, LOCKED_BETS[0]);
  assert.equal(today.source_url, 'https://example.test/m/101');
  assert.deepEqual(today.source_refs, ['card']);

  const tomorrow = slots.get('2026-07-04');
  assert.equal(tomorrow.match_slug, 'sys-201');
  assert.equal(tomorrow.league, 'Premier League');
  assert.deepEqual(tomorrow.primary_bet, LOCKED_BETS[0]);
  assert.deepEqual(tomorrow.source_refs, []);
});

test('getDailyPicksFeed: returns today/tomorrow slots and latest updated_at', async () => {
  const pg = createFakePg({
    rows: [
      {
        slot_date: '2026-07-03',
        match_analysis_id: 1,
        match_id: 101,
        system_match_id: 'sys-101',
        home_team: 'Alpha FC',
        away_team: 'Beta FC',
        sport_name: 'Футбол',
        tournament_name: 'Лига 1',
        tournament_name_en: 'Ligue 1',
        match_start_at: '2026-07-03T15:00:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Сегодня',
        analysis_brief: 'Бриф',
        analysis_risk_note: '',
        recommended_bets: LOCKED_BETS,
        source_payload: { match_slug: 'alpha-beta' },
        model_name: 'gpt',
        prompt_version: 'v1',
        analysis_create_at: '2026-07-03T10:00:00.000Z',
        analysis_update_at: '2026-07-03T10:05:00.000Z',
      },
      {
        slot_date: '2026-07-04',
        match_analysis_id: 2,
        match_id: 201,
        system_match_id: 'sys-201',
        home_team: 'Gamma FC',
        away_team: 'Delta FC',
        sport_name: 'Футбол',
        tournament_name: 'АПЛ',
        tournament_name_en: 'Premier League',
        match_start_at: '2026-07-04T18:30:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Завтра',
        analysis_brief: 'Бриф 2',
        analysis_risk_note: '',
        recommended_bets: LOCKED_BETS,
        source_payload: { match_slug: 'gamma-delta' },
        model_name: 'gpt',
        prompt_version: 'v1',
        analysis_create_at: '2026-07-03T11:00:00.000Z',
        analysis_update_at: '2026-07-03T11:10:00.000Z',
      },
    ],
  });

  const feed = await getDailyPicksFeed(pg, {
    now: new Date('2026-07-03T12:00:00.000Z'),
    favoriteSports: [{ sport_name: 'Футбол', leagues: [] }],
  });

  assert.equal(feed.today_date, '2026-07-03');
  assert.equal(feed.tomorrow_date, '2026-07-04');
  assert.equal(feed.today?.headline, 'Сегодня');
  assert.equal(feed.tomorrow?.headline, 'Завтра');
  assert.equal(feed.updated_at, '2026-07-03T11:10:00.000Z');
  assert.match(pg.calls[0].query, /match_analysis/);
  assert.match(pg.calls[0].query, /ma\.analysis_create_at ASC/);
  assert.deepEqual(pg.calls[0].params, ['2026-07-03', '2026-07-04']);
});

test('getDailyPicksFeed: selects the first favorite-league row for a day before choosing its daily slot', async () => {
  const pg = createFakePg({
    rows: [
      {
        slot_date: '2026-07-03',
        match_analysis_id: 1,
        match_id: 101,
        home_team: 'Unrelated FC',
        away_team: 'Other FC',
        sport_name: 'Футбол',
        tournament_name_en: 'La Liga',
        match_start_at: '2026-07-03T12:00:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Не выбранная лига',
        recommended_bets: LOCKED_BETS,
        source_payload: {},
        analysis_create_at: '2026-07-03T09:00:00.000Z',
      },
      {
        slot_date: '2026-07-03',
        match_analysis_id: 2,
        match_id: 102,
        home_team: 'Favorite FC',
        away_team: 'Selected FC',
        sport_name: 'Футбол',
        tournament_name: 'АПЛ',
        tournament_name_en: 'Premier League',
        match_start_at: '2026-07-03T15:00:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Выбранная лига',
        recommended_bets: LOCKED_BETS,
        source_payload: {},
        analysis_create_at: '2026-07-03T10:00:00.000Z',
      },
    ],
  });

  const feed = await getDailyPicksFeed(pg, {
    now: new Date('2026-07-03T12:00:00.000Z'),
    favoriteSports: [{ sport_name: 'Футбол', leagues: ['Premier League'] }],
  });

  assert.equal(feed.today?.match_id, 102);
  assert.equal(feed.today?.headline, 'Выбранная лига');
  assert.doesNotMatch(pg.calls[0].query, /ROW_NUMBER|row_rank/i);
});

test('getDailyPicksFeed: returns no cards when the user has no favorites', async () => {
  const pg = createFakePg({
    rows: [{
      slot_date: '2026-07-03',
      match_analysis_id: 1,
      match_id: 101,
      sport_name: 'Футбол',
      tournament_name_en: 'Premier League',
      match_start_at: '2026-07-03T12:00:00.000Z',
      analysis_status_name: 'ready',
      recommended_bets: LOCKED_BETS,
      source_payload: {},
    }],
  });

  const feed = await getDailyPicksFeed(pg, {
    now: new Date('2026-07-03T12:00:00.000Z'),
    favoriteSports: [],
  });

  assert.equal(feed.today, null);
  assert.equal(feed.tomorrow, null);
});

test('getMoscowDate: uses Moscow calendar date', () => {
  assert.equal(getMoscowDate(0, new Date('2026-07-03T21:30:00.000Z')), '2026-07-04');
  assert.equal(getMoscowDate(1, new Date('2026-07-03T21:30:00.000Z')), '2026-07-05');
});

test('buildSlotMap hides ready analyses that do not contain exactly three distinct non-conflicting outcomes', () => {
  const base = {
    slot_date: '2026-07-22', analysis_status_name: 'ready', match_analysis_id: 1,
    match_id: 10, home_team: 'A', away_team: 'B', source_payload: {},
  };
  const invalid = buildSlotMap([{ ...base, recommended_bets: [{ type: 'one_x_two', outcome: 'w1' }] }]);
  const valid = buildSlotMap([{
    ...base,
    recommended_bets: [
      { type: 'one_x_two', outcome: 'w1' },
      { type: 'total_over', outcome: '2_5' },
      { type: 'both_to_score', outcome: 'yes' },
    ],
  }]);

  assert.equal(invalid.size, 0);
  assert.equal(valid.size, 1);
});
