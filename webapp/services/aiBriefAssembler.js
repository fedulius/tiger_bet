'use strict';

function marketKey(bet) {
  return bet && bet.market_key ? String(bet.market_key) : `${bet.type}:${bet.outcome}`;
}

function defaultReason(bet) {
  if (bet.selection_reason_code === 'home_strength_edge') return 'Ставка выбрана аналитическим слоем Tiger Bet: преимущество хозяев подтверждено статистическими сигналами.';
  if (bet.selection_reason_code === 'away_strength_edge') return 'Ставка выбрана аналитическим слоем Tiger Bet: преимущество гостей подтверждено статистическими сигналами.';
  if (bet.selection_reason_code === 'goal_expectation_over') return 'Ставка выбрана аналитическим слоем Tiger Bet: голевой профиль матча поддерживает верховой сценарий.';
  if (bet.selection_reason_code === 'goal_expectation_under') return 'Ставка выбрана аналитическим слоем Tiger Bet: голевой профиль матча поддерживает низовой сценарий.';
  if (bet.selection_reason_code === 'both_attacks_score') return 'Ставка выбрана аналитическим слоем Tiger Bet: атакующие показатели обеих команд поддерживают этот рынок.';
  if (bet.selection_reason_code === 'exact_score_analytics_basis') return 'Точный счёт выбран только из-за сильного аналитического основания и реального рынка в линии.';
  return 'Ставка выбрана аналитическим слоем Tiger Bet и подтверждена доступным рынком букмекера.';
}

function assembleAiBrief({ llmOutput = {}, selectedBets = [] } = {}) {
  const explanations = new Map();
  for (const item of Array.isArray(llmOutput.bet_explanations) ? llmOutput.bet_explanations : []) {
    if (!item || !item.market_key || typeof item.reason !== 'string' || !item.reason.trim()) continue;
    explanations.set(String(item.market_key), item.reason.trim());
  }

  const recommendedBets = selectedBets.map((bet) => {
    const key = marketKey(bet);
    return {
      type: bet.type,
      outcome: bet.outcome,
      label: bet.label,
      rate: bet.rate,
      reason: explanations.get(key) || defaultReason(bet),
      risk_label: bet.risk_label,
      ...(typeof bet.confidence === 'number' ? { confidence: bet.confidence } : {}),
    };
  });

  return {
    headline: llmOutput.headline,
    brief: llmOutput.brief,
    risk_note: llmOutput.risk_note ?? null,
    recommended_bets: recommendedBets,
  };
}

module.exports = { assembleAiBrief, defaultReason };
