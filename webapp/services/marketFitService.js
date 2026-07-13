'use strict';

const RISK_ORDER = ['low', 'medium', 'high'];
const WINNER_TYPES = new Set(['one_x_two', 'winner', 'match_result', 'match_qualify', 'double_chance']);

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeOutcome(outcome) {
  return String(outcome || '').trim();
}

function normalizeLine(outcome) {
  return normalizeOutcome(outcome).replace('.', '_');
}

function marketKey(type, outcome) {
  return `${type}:${normalizeOutcome(outcome)}`;
}

function humanLabel(type, outcome) {
  const o = normalizeOutcome(outcome);
  const line = o.replace('_', '.');
  if (type === 'one_x_two') {
    if (o === 'w1') return 'Победа хозяев';
    if (o === 'w2') return 'Победа гостей';
    if (o === 'x') return 'Ничья';
  }
  if (type === 'double_chance') {
    if (o === 'x1' || o === '1x') return '1X (хозяева не проиграют)';
    if (o === 'x2') return 'X2 (гости не проиграют)';
    if (o === 'w12' || o === '12') return '12 (будет победитель)';
  }
  if (type === 'both_to_score') return o === 'no' ? 'Обе забьют — нет' : 'Обе забьют — да';
  if (type === 'total_over') return `Тотал больше ${line}`;
  if (type === 'total_under') return `Тотал меньше ${line}`;
  if (type === 'handicap1') return `Фора хозяев (${line})`;
  if (type === 'handicap2') return `Фора гостей (${line})`;
  if (type === 'correct_score') return `Точный счёт ${line}`;
  return null;
}

function categoryFor(type) {
  if (WINNER_TYPES.has(type)) return 'winner';
  if (type === 'total_over' || type === 'total_under') return 'total';
  if (type === 'both_to_score') return 'btts';
  if (type === 'correct_score') return 'correct_score';
  if (type === 'handicap1' || type === 'handicap2') return 'handicap';
  return type || 'other';
}

function normalizeMarket(raw, source) {
  if (!raw || !raw.type || raw.outcome == null) return null;
  const rate = finite(raw.rate);
  if (!(rate > 1)) return null;
  const type = String(raw.type);
  const outcome = normalizeOutcome(raw.outcome);
  const label = raw.label || humanLabel(type, outcome);
  if (!label) return null;
  return {
    market_key: marketKey(type, outcome),
    type,
    outcome,
    label,
    rate,
    market_category: categoryFor(type),
    source,
    count: raw.count != null ? finite(raw.count, 0) : null,
    percent: raw.percent != null ? finite(raw.percent, null) : null,
  };
}

function buildPartialMarketCatalog({ popularBetsData, match } = {}) {
  const markets = [];
  const seen = new Set();

  function add(raw, source) {
    const market = normalizeMarket(raw, source);
    if (!market || seen.has(market.market_key)) return;
    seen.add(market.market_key);
    markets.push(market);
  }

  const oneXTwo = match && match.odds && match.odds.one_x_two;
  if (oneXTwo && typeof oneXTwo === 'object') {
    for (const outcome of ['w1', 'x', 'w2']) {
      if (oneXTwo[outcome] != null) add({ type: 'one_x_two', outcome, rate: oneXTwo[outcome] }, 'stavka_listing_1x2');
    }
  }

  const data = popularBetsData && Array.isArray(popularBetsData.data) ? popularBetsData.data : [];
  for (const bet of data) add(bet, 'stavka_popular_bets_raw');

  return {
    version: 'stavka-market-catalog-v1',
    catalog_coverage: 'partial',
    markets,
  };
}

function signalForMarket(market, analytics) {
  const scores = (analytics && analytics.scores) || {};
  const type = market.type;
  const outcome = normalizeLine(market.outcome);

  if (type === 'one_x_two') {
    if (outcome === 'w1') return ['home_win', finite(scores.home_win, 0), 'home_strength_edge'];
    if (outcome === 'w2') return ['away_win', finite(scores.away_win, 0), 'away_strength_edge'];
    if (outcome === 'x') return ['draw', finite(scores.draw, 0), 'draw_signal'];
  }
  if (type === 'double_chance') {
    if (outcome === 'x1' || outcome === '1x') return ['home_non_loss', finite(scores.home_non_loss, Math.max(finite(scores.home_win, 0), finite(scores.draw, 0))), 'home_non_loss'];
    if (outcome === 'x2') return ['away_non_loss', finite(scores.away_non_loss, Math.max(finite(scores.away_win, 0), finite(scores.draw, 0))), 'away_non_loss'];
  }
  if (type === 'total_over' && outcome === '2_5') return ['over_2_5', finite(scores.over_2_5, 0), 'goal_expectation_over'];
  if (type === 'total_under' && outcome === '2_5') return ['under_2_5', finite(scores.under_2_5, 0), 'goal_expectation_under'];
  if (type === 'both_to_score') {
    if (outcome === 'yes') return ['btts_yes', finite(scores.btts_yes, 0), 'both_attacks_score'];
    if (outcome === 'no') return ['btts_no', finite(scores.btts_no, 0), 'one_attack_limited'];
  }
  if (type === 'correct_score') {
    if (outcome === '2:1') return ['exact_home_2_1', finite(scores.exact_home_2_1, 0), 'exact_score_analytics_basis'];
    if (outcome === '1:2') return ['exact_away_1_2', finite(scores.exact_away_1_2, 0), 'exact_score_analytics_basis'];
    return ['exact_score', 0, 'exact_score_unsupported_pattern'];
  }
  return [null, 0, 'unsupported_market'];
}

function marketSuitability(market, signalScore) {
  if (market.type === 'double_chance') return signalScore >= 65 ? 82 : 70;
  if (market.type === 'one_x_two') return 78;
  if (market.type === 'total_over' || market.type === 'total_under') return 75;
  if (market.type === 'both_to_score') return 70;
  if (market.type === 'correct_score') return 38;
  if (market.type === 'handicap1' || market.type === 'handicap2') return 55;
  return 30;
}

function riskForCandidate(market, fitScore, confidence) {
  if (market.type === 'correct_score') return 'high';
  if (fitScore >= 78 && confidence >= 70 && market.rate <= 1.85) return 'low';
  if (fitScore >= 70 && market.rate <= 2.4) return 'medium';
  if (fitScore >= 65) return 'high';
  return null;
}

function targetRank(risk) {
  return RISK_ORDER.indexOf(risk);
}

function selectMarketFits({ analytics, marketCatalog, minConfidence = 65, minFit = 65 } = {}) {
  const confidence = finite(analytics && analytics.confidence && analytics.confidence.score, 0);
  const selected = [];
  const rejected = [];
  const markets = marketCatalog && Array.isArray(marketCatalog.markets) ? marketCatalog.markets : [];

  if (!analytics || analytics.eligibility?.status === 'ineligible' || confidence < minConfidence) {
    return {
      version: 'market-fit-v1',
      catalog_coverage: marketCatalog?.catalog_coverage || 'partial',
      selected_bets: [],
      rejected: markets.map(m => ({ market_key: m.market_key, reason_code: 'analytics_insufficient_data' })),
    };
  }

  const candidates = [];
  for (const market of markets) {
    const [signalKey, signalScore, reasonCode] = signalForMarket(market, analytics);
    if (!signalKey) {
      rejected.push({ market_key: market.market_key, reason_code: reasonCode });
      continue;
    }
    if (market.type === 'correct_score' && signalScore < 80) {
      rejected.push({ market_key: market.market_key, reason_code: 'exact_score_insufficient_analytics_basis' });
      continue;
    }
    const suitability = marketSuitability(market, signalScore);
    const fitScore = Math.round(clamp(signalScore * 0.60 + confidence * 0.25 + suitability * 0.15));
    if (fitScore < minFit) {
      rejected.push({ market_key: market.market_key, reason_code: 'market_fit_below_threshold' });
      continue;
    }
    const riskLabel = riskForCandidate(market, fitScore, confidence);
    if (!riskLabel) {
      rejected.push({ market_key: market.market_key, reason_code: 'risk_classification_failed' });
      continue;
    }
    candidates.push({
      ...market,
      signal_key: signalKey,
      signal_score: Math.round(signalScore),
      market_fit_score: fitScore,
      confidence,
      risk_label: riskLabel,
      selection_reason_code: reasonCode,
    });
  }

  candidates.sort((a, b) => {
    const riskDiff = targetRank(a.risk_label) - targetRank(b.risk_label);
    if (riskDiff !== 0) return riskDiff;
    return b.market_fit_score - a.market_fit_score;
  });

  const usedCategories = new Set();
  const usedWinner = false;
  for (const desiredRisk of RISK_ORDER) {
    let best = null;
    for (const c of candidates) {
      if (selected.some(s => s.market_key === c.market_key)) continue;
      if (usedCategories.has(c.market_category)) continue;
      if (c.market_category === 'winner' && selected.some(s => s.market_category === 'winner')) continue;
      if (c.risk_label !== desiredRisk && desiredRisk !== 'high') continue;
      if (!best || c.market_fit_score > best.market_fit_score) best = c;
    }
    if (best) {
      selected.push(best);
      usedCategories.add(best.market_category);
      continue;
    }
  }

  // If exact score is strongly justified, prefer it as high-risk slot.
  const exact = candidates.find(c => c.type === 'correct_score' && c.risk_label === 'high' && !selected.some(s => s.market_category === c.market_category));
  if (exact && !selected.some(s => s.risk_label === 'high')) {
    selected.push(exact);
  }

  selected.sort((a, b) => targetRank(a.risk_label) - targetRank(b.risk_label));

  return {
    version: 'market-fit-v1',
    catalog_coverage: marketCatalog?.catalog_coverage || 'partial',
    selected_bets: selected.slice(0, 3).map((b, idx) => ({ ...b, risk_order: idx + 1 })),
    rejected,
  };
}

module.exports = {
  WINNER_TYPES,
  buildPartialMarketCatalog,
  selectMarketFits,
  marketKey,
  categoryFor,
  __private: { normalizeMarket, signalForMarket, riskForCandidate },
};
