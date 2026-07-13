'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAnalyticsFirstPayload } = require('../../scheduler/DailyPicks');

const basePayload = {
  source_mode: 'full',
  source_hash: 'stavka-hash',
  sport_slug: 'soccer',
  market_catalog: {
    version: 'catalog-v1',
    catalog_coverage: 'partial',
    markets: [
      { market_key: 'one_x_two:w1', type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72 },
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

  assert.equal(first.skip_reason, 'analytics_no_market_fit');
  assert.equal(second.skip_reason, 'analytics_no_market_fit');
  assert.notEqual(first.source_hash, second.source_hash);
});
