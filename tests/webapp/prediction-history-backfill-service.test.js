const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRecommendedBet,
  parseLineValue,
  parseCorrectScore,
} = require('../../webapp/services/predictionHistoryBackfillService');

test('normalizeRecommendedBet maps double chance x2 to structured bet', () => {
  const result = normalizeRecommendedBet({
    type: 'double_chance',
    outcome: 'x2',
    label: 'X2 (гости не проиграют)',
    rate: 1.62,
    risk_label: 'low',
    confidence: 84,
    reason: 'Испания не проигрывала.',
  }, 1);

  assert.equal(result.market_type_code, 'double_chance');
  assert.equal(result.selection_code, 'away_or_draw');
  assert.equal(result.period_code, 'full_time');
  assert.equal(result.participant_scope, 'match');
  assert.equal(result.odds_decimal, 1.62);
  assert.equal(result.risk_level_code, 'low');
  assert.equal(result.confidence, 84);
});

test('normalizeRecommendedBet maps total_over outcome to total over line', () => {
  const result = normalizeRecommendedBet({
    type: 'total_over',
    outcome: '2_5',
    label: 'Тотал больше 2.5',
    rate: 1.9,
  }, 2);

  assert.equal(result.market_type_code, 'total');
  assert.equal(result.selection_code, 'over');
  assert.equal(result.line_value, 2.5);
  assert.equal(result.market_key, 'total|full_time|match|over|2.5||');
});

test('normalizeRecommendedBet maps team total and handicap participant scopes', () => {
  const teamTotal = normalizeRecommendedBet({ type: 'total_t2_over', outcome: '1_5', label: 'ИТБ2 1.5' }, 1);
  const handicap = normalizeRecommendedBet({ type: 'handicap1', outcome: '-1_5', label: 'Фора 1 (-1.5)' }, 2);

  assert.equal(teamTotal.market_type_code, 'team_total');
  assert.equal(teamTotal.participant_scope, 'away_team');
  assert.equal(teamTotal.selection_code, 'over');
  assert.equal(teamTotal.line_value, 1.5);

  assert.equal(handicap.market_type_code, 'handicap');
  assert.equal(handicap.participant_scope, 'home_team');
  assert.equal(handicap.selection_code, 'home_team');
  assert.equal(handicap.line_value, -1.5);
});

test('normalizeRecommendedBet maps correct score', () => {
  const result = normalizeRecommendedBet({ type: 'correct_score', outcome: '1:2', label: 'Точный счёт 1:2' }, 3);

  assert.equal(result.market_type_code, 'correct_score');
  assert.equal(result.selection_code, 'exact');
  assert.equal(result.score_home, 1);
  assert.equal(result.score_away, 2);
});

test('normalizer returns null for unsupported markets', () => {
  assert.equal(normalizeRecommendedBet({ type: 'corners_over', outcome: '8_5' }, 1), null);
});

test('parsers handle decimal and score variants', () => {
  assert.equal(parseLineValue('-1_5'), -1.5);
  assert.equal(parseLineValue('ТБ 2,5'), 2.5);
  assert.deepEqual(parseCorrectScore('1-2'), { score_home: 1, score_away: 2 });
});
