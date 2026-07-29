'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sstatsApi = require('../../lib/sstatsApi');
const { buildAnalyticsFirstPayload, enrichPayloadWithSStatsData, reusableSnapshotMatchIds, buildGenerationReport } = require('../../scheduler/DailyPicks');

const basePayload = {
  source_mode: 'full',
  source_hash: 'stavka-hash',
  sport_slug: 'soccer',
  market_catalog: {
    version: 'catalog-v1',
    catalog_coverage: 'partial',
    markets: [
      { market_key: 'one_x_two:w1', type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, market_category: 'winner' },
      { market_key: 'total_over:2_5', type: 'total_over', outcome: '2_5', label: 'Тотал больше 2.5', rate: 1.91, market_category: 'total' },
      { market_key: 'both_to_score:yes', type: 'both_to_score', outcome: 'yes', label: 'Обе забьют — да', rate: 1.86, market_category: 'btts' },
    ],
  },
  sstats_data: {
    team_stats: {
      home: { avg_scored: 2, avg_conceded: 1, xG: 2, xGA: 1 },
      away: { avg_scored: 1, avg_conceded: 2, xG: 1, xGA: 2 },
    },
    recent_form: {
      home: [{ result: 'W' }, { result: 'W' }, { result: 'D' }],
      away: [{ result: 'L' }, { result: 'D' }, { result: 'L' }],
    },
  },
};

function withSstatsStub(t, { games, matchPayload = null }) {
  const original = {
    hasApiKey: sstatsApi.hasApiKey,
    apiGet: sstatsApi.apiGet,
    buildMatchPayload: sstatsApi.buildMatchPayload,
  };
  const apiCalls = [];
  sstatsApi.hasApiKey = () => true;
  sstatsApi.apiGet = async (path, params) => {
    apiCalls.push({ path, params });
    return games;
  };
  sstatsApi.buildMatchPayload = async () => matchPayload;
  t.after(() => Object.assign(sstatsApi, original));
  return apiCalls;
}

function sstatsPayload(fixtureId) {
  return {
    fixture_id: fixtureId,
    league_slug: 'uefa-champions-league',
    status: 1,
    round: 'Q2',
    referee: null,
    lineups: null,
    events: [],
    statistics: null,
    recent_form: { home: [], away: [] },
    team_stats: { home: {}, away: {} },
    odds: null,
  };
}

function fixture({ id, date = '2026-07-22T17:00:00Z', home = 'Omonia Nicosia', away = 'Kairat Almaty' } = {}) {
  return { id, date, homeTeam: { name: home }, awayTeam: { name: away } };
}

test('analytics source hash changes when analytics input changes despite same selected market', () => {
  const first = buildAnalyticsFirstPayload(basePayload);
  const second = buildAnalyticsFirstPayload({
    ...basePayload,
    sstats_data: {
      ...basePayload.sstats_data,
      team_stats: { ...basePayload.sstats_data.team_stats, home: { ...basePayload.sstats_data.team_stats.home, xG: 2.4 } },
    },
  });

  assert.equal(first.market_fit.selected_bets[0].market_key, second.market_fit.selected_bets[0].market_key);
  assert.notEqual(first.source_hash, second.source_hash);
});

test('analytics source hash changes when an ineligible input changes', () => {
  const ineligiblePayload = {
    ...basePayload,
    sstats_data: { team_stats: {}, recent_form: {} },
  };
  const first = buildAnalyticsFirstPayload(ineligiblePayload);
  const second = buildAnalyticsFirstPayload({
    ...ineligiblePayload,
    sstats_data: { team_stats: { home: { xG: 0.1 } }, recent_form: {} },
  });

  assert.equal(first.source_mode, 'skip');
  assert.equal(second.source_mode, 'skip');
  assert.notEqual(first.source_hash, second.source_hash);
});

test('analytics source hash changes when a no-market-fit input changes', () => {
  const skippedPayload = { ...basePayload, market_catalog: { ...basePayload.market_catalog, markets: [] } };
  const first = buildAnalyticsFirstPayload(skippedPayload);
  const second = buildAnalyticsFirstPayload({
    ...skippedPayload,
    sstats_data: {
      ...skippedPayload.sstats_data,
      team_stats: { ...skippedPayload.sstats_data.team_stats, home: { ...skippedPayload.sstats_data.team_stats.home, xG: 2.4 } },
    },
  });

  assert.equal(first.skip_reason, 'daily_pick_requires_three_outcomes');
  assert.equal(second.skip_reason, 'daily_pick_requires_three_outcomes');
  assert.notEqual(first.source_hash, second.source_hash);
});

test('SStats discovery resolves a non-World-Cup English fixture from the day list', { concurrency: false }, async (t) => {
  const apiCalls = withSstatsStub(t, {
    games: [fixture({ id: 2026 })],
    matchPayload: sstatsPayload(2026),
  });
  const payload = await enrichPayloadWithSStatsData({
    ...basePayload,
    sstats_data: undefined,
    match_slug: 'omonia-nicosia-kairat-almaty-2026',
    fixture_context: {
      home_team: 'Omonia Nicosia', away_team: 'Kairat Almaty', starts_at: '2026-07-22T17:00:00Z',
    },
  });

  assert.equal(payload.sstats_data.fixture_id, 2026);
  assert.equal(payload.sstats_data.league_slug, 'uefa-champions-league');
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].path, '/Games/list');
  assert.equal(apiCalls[0].params.LeagueId, undefined, 'daily discovery must not pin the World Cup');
  assert.equal(apiCalls[0].params.from, '2026-07-22T00:00:00+03:00');
});

test('SStats discovery uses the ordered English provider pair in a Stavka slug when display names are localized', { concurrency: false }, async (t) => {
  withSstatsStub(t, { games: [fixture({ id: 2026 })], matchPayload: sstatsPayload(2026) });
  const payload = await enrichPayloadWithSStatsData({
    ...basePayload,
    sstats_data: undefined,
    match_slug: '22-07-2026-omonia-nicosia-kairat-almaty',
    fixture_context: { home_team: 'Омония Никосия', away_team: 'Кайрат', starts_at: '2026-07-22T17:00:00Z' },
  });

  assert.equal(payload.sstats_data.fixture_id, 2026);
});

test('SStats discovery leaves a wrong ordered team pair unresolved', { concurrency: false }, async (t) => {
  withSstatsStub(t, { games: [fixture({ id: 2026, home: 'Kairat Almaty', away: 'Omonia Nicosia' })] });
  const payload = await enrichPayloadWithSStatsData({
    ...basePayload,
    sstats_data: undefined,
    match_slug: 'omonia-nicosia-kairat-almaty-2026',
    fixture_context: { home_team: 'Omonia Nicosia', away_team: 'Kairat Almaty', starts_at: '2026-07-22T17:00:00Z' },
  });

  assert.equal(buildAnalyticsFirstPayload(payload).skip_reason, 'analytics_sstats_fixture_unresolved');
});

test('SStats discovery never auto-maps ambiguous ordered fixtures', { concurrency: false }, async (t) => {
  withSstatsStub(t, {
    games: [fixture({ id: 1 }), fixture({ id: 2, date: '2026-07-22T17:05:00Z' })],
  });
  const payload = await enrichPayloadWithSStatsData({
    ...basePayload,
    sstats_data: undefined,
    match_slug: 'omonia-nicosia-kairat-almaty-2026',
    fixture_context: { home_team: 'Omonia Nicosia', away_team: 'Kairat Almaty', starts_at: '2026-07-22T17:00:00Z' },
  });

  assert.equal(payload.sstats_fixture_resolution, 'ambiguous');
  assert.equal(buildAnalyticsFirstPayload(payload).skip_reason, 'analytics_sstats_fixture_ambiguous');
});

test('analytics payload is skipped with the daily-pick three-outcomes reason when the catalog cannot lock three bets', () => {
  const payload = buildAnalyticsFirstPayload({
    ...basePayload,
    market_catalog: {
      ...basePayload.market_catalog,
      markets: [{ market_key: 'one_x_two:w1', type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72 }],
    },
  });

  assert.equal(payload.source_mode, 'skip');
  assert.equal(payload.skip_reason, 'daily_pick_requires_three_outcomes');
  assert.deepEqual(payload.market_fit.selected_bets, []);
});

test('reusable daily-pick snapshots exclude legacy incomplete analyses but retain one valid current analysis per match', () => {
  const ids = reusableSnapshotMatchIds([
    { source_match_id: 'legacy-one', recommended_bets: [{ type: 'one_x_two', outcome: 'w1' }] },
    {
      source_match_id: 'current',
      recommended_bets: [
        { type: 'one_x_two', outcome: 'w1' },
        { type: 'total_over', outcome: '2_5' },
        { type: 'both_to_score', outcome: 'yes' },
      ],
    },
    {
      source_match_id: 'conflicting',
      recommended_bets: [
        { type: 'one_x_two', outcome: 'w1' },
        { type: 'double_chance', outcome: 'x1' },
        { type: 'total_over', outcome: '2_5' },
      ],
    },
  ]);

  assert.deepEqual([...ids], ['current']);
});

test('generation report retains a per-match terminal outcome and aggregates skip reasons', () => {
  const report = buildGenerationReport([
    { match_id: 'existing', status: 'existing_snapshot', slot_dates: ['2026-07-29'] },
    { match_id: 'no-sstats', status: 'skipped', reason: 'analytics_sstats_fixture_unresolved', slot_dates: ['2026-07-29'] },
    { match_id: 'no-markets', status: 'skipped', reason: 'daily_pick_requires_three_outcomes', slot_dates: ['2026-07-30'] },
    { match_id: 'created', status: 'created', slot_dates: ['2026-07-30'] },
  ]);

  assert.deepEqual(report.counts, {
    selected_matches: 4,
    created: 1,
    existing_snapshot: 1,
    skipped: 2,
    failed: 0,
  });
  assert.deepEqual(report.skip_reasons, {
    analytics_sstats_fixture_unresolved: 1,
    daily_pick_requires_three_outcomes: 1,
  });
  assert.equal(report.matches[1].reason, 'analytics_sstats_fixture_unresolved');
});
