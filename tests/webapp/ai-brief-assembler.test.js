'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assembleAiBrief } = require('../../webapp/services/aiBriefAssembler');

test('assembleAiBrief attaches LLM explanations by market_key only', () => {
  const selectedBets = [
    { market_key: 'one_x_two:w1', type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, risk_label: 'low', confidence: 74 },
    { market_key: 'total_over:2_5', type: 'total_over', outcome: '2_5', label: 'Тотал больше 2.5', rate: 1.91, risk_label: 'medium', confidence: 74 },
  ];

  const assembled = assembleAiBrief({
    selectedBets,
    llmOutput: {
      headline: 'Хозяева сильнее по форме',
      brief: 'Tiger Bet видит преимущество хозяев и верховой голевой профиль на основе статистики.',
      risk_note: 'Риск связан с обновлением составов ближе к старту.',
      bet_explanations: [
        { market_key: 'one_x_two:w1', reason: 'Форма и xG поддерживают победу хозяев.' },
        { market_key: 'one_x_two:w2', reason: 'Этого рынка нет в selected bets.' },
      ],
    },
  });

  assert.equal(assembled.recommended_bets.length, 2);
  assert.equal(assembled.recommended_bets[0].reason, 'Форма и xG поддерживают победу хозяев.');
  assert.match(assembled.recommended_bets[1].reason, /аналитическим слоем Tiger Bet/);
  assert.equal(assembled.recommended_bets[0].rate, 1.72);
  assert.equal(assembled.recommended_bets[0].risk_label, 'low');
});
