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

test('buildFavoriteLeagueMap: empty leagues mean all leagues for that sport', () => {
  const map = buildFavoriteLeagueMap([
    { sport_name: 'Футбол', leagues: ['Premier League'] },
    { sport_name: 'Теннис', leagues: [] },
  ]);

  assert.deepEqual([...map.get('футбол')], ['premier league']);
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
      recommended_bets: [{ market: '1X2', selection: 'home', odds: 1.91 }],
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
      recommended_bets: [],
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
      recommended_bets: [],
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
  assert.deepEqual(today.primary_bet, { market: '1X2', selection: 'home', odds: 1.91 });
  assert.equal(today.source_url, 'https://example.test/m/101');
  assert.deepEqual(today.source_refs, ['card']);

  const tomorrow = slots.get('2026-07-04');
  assert.equal(tomorrow.match_slug, 'sys-201');
  assert.equal(tomorrow.league, 'Premier League');
  assert.equal(tomorrow.primary_bet, null);
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
        recommended_bets: [],
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
        recommended_bets: [],
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
  assert.deepEqual(pg.calls[0].params, ['2026-07-03', '2026-07-04']);
});

test('getMoscowDate: uses Moscow calendar date', () => {
  assert.equal(getMoscowDate(0, new Date('2026-07-03T21:30:00.000Z')), '2026-07-04');
  assert.equal(getMoscowDate(1, new Date('2026-07-03T21:30:00.000Z')), '2026-07-05');
});
