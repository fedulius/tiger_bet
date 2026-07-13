'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRecommendedBets } = require('../../webapp/services/recommendedBetQualityGate');

const marketCatalog = {
  version: 'stavka-market-catalog-v1',
  catalog_coverage: 'partial',
  markets: [
    { market_key: 'one_x_two:w1', type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72 },
    { market_key: 'total_over:2_5', type: 'total_over', outcome: '2_5', label: 'Тотал больше 2.5', rate: 1.91 },
    { market_key: 'both_to_score:yes', type: 'both_to_score', outcome: 'yes', label: 'Обе забьют — да', rate: 1.86 },
  ],
};
const marketFit = { selected_bets: marketCatalog.markets.map((m, idx) => ({ ...m, risk_label: ['low', 'medium', 'high'][idx] })) };

test('validateRecommendedBets accepts source-backed analytics-selected bets', () => {
  const result = validateRecommendedBets({
    marketCatalog,
    marketFit,
    recommendedBets: [
      { type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, reason: 'R', risk_label: 'low' },
      { type: 'total_over', outcome: '2_5', label: 'Тотал больше 2.5', rate: 1.91, reason: 'R', risk_label: 'medium' },
      { type: 'both_to_score', outcome: 'yes', label: 'Обе забьют — да', rate: 1.86, reason: 'R', risk_label: 'high' },
    ],
  });
  assert.deepEqual(result, { valid: true });
});

test('validateRecommendedBets rejects LLM-mutated odds and duplicate winner categories', () => {
  assert.equal(validateRecommendedBets({
    marketCatalog,
    marketFit,
    recommendedBets: [{ type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.8, reason: 'R', risk_label: 'low' }],
  }).reason, 'odds_mismatch');

  assert.equal(validateRecommendedBets({
    marketCatalog: { ...marketCatalog, markets: [...marketCatalog.markets, { market_key: 'double_chance:x1', type: 'double_chance', outcome: 'x1', label: '1X (хозяева не проиграют)', rate: 1.25 }] },
    marketFit: { selected_bets: [{ market_key: 'one_x_two:w1' }, { market_key: 'double_chance:x1' }] },
    recommendedBets: [
      { type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, reason: 'R', risk_label: 'low' },
      { type: 'double_chance', outcome: 'x1', label: '1X (хозяева не проиграют)', rate: 1.25, reason: 'R', risk_label: 'medium' },
    ],
  }).reason, 'winner_conflict');
});
