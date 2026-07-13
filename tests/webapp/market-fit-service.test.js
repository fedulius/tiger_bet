'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPartialMarketCatalog, selectMarketFits } = require('../../webapp/services/marketFitService');

const analytics = {
  version: 'match-analytics-v1',
  model_version: 'deterministic-v1',
  eligibility: { status: 'eligible', reasons: [] },
  scores: {
    home_win: 72,
    away_win: 18,
    draw: 22,
    home_non_loss: 82,
    away_non_loss: 28,
    over_2_5: 68,
    under_2_5: 32,
    btts_yes: 63,
    btts_no: 37,
    exact_home_2_1: 44,
  },
  confidence: { score: 74, tier: 'medium' },
};

const popularBets = {
  data: [
    { type: 'total_over', outcome: '2_5', rate: 1.91, count: 18, percent: 22 },
    { type: 'both_to_score', outcome: 'yes', rate: 1.86, count: 14, percent: 17 },
    { type: 'correct_score', outcome: '2:1', rate: 8.5, count: 20, percent: 30 },
    { type: 'double_chance', outcome: 'x1', rate: 1.25, count: 9, percent: 11 },
  ],
};

const match = {
  odds: { one_x_two: { w1: 1.72, x: 3.5, w2: 5.1 } },
};

test('buildPartialMarketCatalog combines raw popular bets and 1X2 listing odds', () => {
  const catalog = buildPartialMarketCatalog({ popularBetsData: popularBets, match });

  assert.equal(catalog.version, 'stavka-market-catalog-v1');
  assert.equal(catalog.catalog_coverage, 'partial');
  assert.ok(catalog.markets.some(m => m.market_key === 'one_x_two:w1' && m.rate === 1.72));
  assert.ok(catalog.markets.some(m => m.market_key === 'total_over:2_5' && m.rate === 1.91));
});

test('selectMarketFits tries to return low medium high without winner conflicts', () => {
  const catalog = buildPartialMarketCatalog({ popularBetsData: popularBets, match });
  const fit = selectMarketFits({ analytics, marketCatalog: catalog });

  assert.equal(fit.version, 'market-fit-v1');
  assert.equal(fit.selected_bets.length, 3);
  assert.deepEqual(fit.selected_bets.map(b => b.risk_label), ['low', 'medium', 'high']);
  assert.equal(fit.selected_bets.filter(b => b.market_category === 'winner').length, 1);
  assert.ok(fit.selected_bets.every(b => catalog.markets.some(m => m.market_key === b.market_key && m.rate === b.rate)));
  assert.ok(!fit.selected_bets.some(b => b.type === 'correct_score'));
  assert.ok(fit.rejected.some(r => r.market_key === 'correct_score:2:1' && r.reason_code === 'exact_score_insufficient_analytics_basis'));
});

test('selectMarketFits can choose correct_score when exact-score basis is strong', () => {
  const catalog = buildPartialMarketCatalog({ popularBetsData: popularBets, match });
  const fit = selectMarketFits({
    analytics: { ...analytics, scores: { ...analytics.scores, exact_home_2_1: 82 }, confidence: { score: 82, tier: 'high' } },
    marketCatalog: catalog,
  });

  assert.ok(fit.selected_bets.some(b => b.type === 'correct_score' && b.outcome === '2:1' && b.risk_label === 'high'));
});
