'use strict';

const WINNER_TYPES = new Set(['one_x_two', 'winner', 'match_result', 'match_qualify', 'double_chance']);

function category(type) {
  const t = String(type || '').toLowerCase();
  if (WINNER_TYPES.has(t)) return 'winner';
  if (t.includes('total')) return 'total';
  if (t.includes('both') || t === 'btts' || t === 'both_to_score') return 'btts';
  if (t.includes('handicap')) return 'handicap';
  if (t === 'correct_score') return 'correct_score';
  return t || 'other';
}

function isTechnicalLabel(label) {
  const text = String(label || '').trim();
  if (!text) return true;
  if (/^(w1|w2|x|1x|x2|12)$/i.test(text)) return true;
  return /^(one_x_two|winner|match_result|match_qualify|double_chance|total|correct_score|handicap)[_:0-9a-z.-]+$/i.test(text);
}

function keyFor(bet) {
  return bet.market_key || `${bet.type}:${bet.outcome}`;
}

function validateRecommendedBets({ recommendedBets = [], marketCatalog, marketFit } = {}) {
  if (!Array.isArray(recommendedBets)) return { valid: false, reason: 'recommended_bets_not_array' };
  if (recommendedBets.length > 3) return { valid: false, reason: 'too_many_recommended_bets' };

  const catalogMarkets = new Map();
  for (const m of marketCatalog && Array.isArray(marketCatalog.markets) ? marketCatalog.markets : []) {
    catalogMarkets.set(keyFor(m), m);
  }
  const selectedKeys = new Set((marketFit && Array.isArray(marketFit.selected_bets) ? marketFit.selected_bets : []).map(keyFor));
  const cats = new Set();

  for (const bet of recommendedBets) {
    if (!bet || typeof bet !== 'object') return { valid: false, reason: 'invalid_bet' };
    const key = keyFor(bet);
    const source = catalogMarkets.get(key);
    if (!source) return { valid: false, reason: 'market_not_in_catalog', market_key: key };
    if (selectedKeys.size && !selectedKeys.has(key)) return { valid: false, reason: 'market_not_selected_by_analytics', market_key: key };
    if (Math.abs(Number(source.rate) - Number(bet.rate)) > 0.001) return { valid: false, reason: 'odds_mismatch', market_key: key };
    if (isTechnicalLabel(bet.label)) return { valid: false, reason: 'technical_label', market_key: key };
    if (!['low', 'medium', 'high'].includes(bet.risk_label)) return { valid: false, reason: 'invalid_risk_label', market_key: key };
    const cat = category(bet.type);
    if (cats.has(cat)) return { valid: false, reason: cat === 'winner' ? 'winner_conflict' : 'duplicate_category', market_key: key };
    cats.add(cat);
  }
  return { valid: true };
}

module.exports = { validateRecommendedBets, category, isTechnicalLabel };
