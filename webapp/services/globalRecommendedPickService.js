'use strict';

const crypto = require('crypto');
const { fetchAllMatches, resolveSport } = require('../../lib/stavkaApi');
const sstatsApi = require('../../lib/sstatsApi');
const { extractAnalyticsFeatures } = require('./matchAnalyticsFeatureService');
const { aiBriefLlmProvider } = require('./aiBriefLlmProvider');
const { resolveDbContextForCandidate } = require('./dailyPickMappingService');
const {
  persistBundleSnapshot,
  persistAnalysisSnapshot,
} = require('./dailyPickPersistenceService');
const { backfillPredictionHistory } = require('./predictionHistoryBackfillService');

const MIN_ODDS = 1.6;
const MAX_ODDS = 2.3;
const STRONG_SCORE_THRESHOLD = 70;
const SOURCE_SYSTEM_NAME = 'stavka';
const ANALYSIS_TYPE_CODE = 'global_recommended_pick';
const CARD_TYPE_CODE = 'recommended_pick';
const sstatsListCache = new Map();

const ALLOWED_MARKETS = new Set([
  'one_x_two',
  'double_chance',
  'total',
  'both_to_score',
  'handicap',
  'team_total',
]);

const MAJOR_FOOTBALL_LEAGUES = [
  'премьер-лига',
  'premier league',
  'ла лига',
  'la liga',
  'серия а',
  'serie a',
  'бундеслига',
  'bundesliga',
  'лига 1',
  'ligue 1',
  'лига чемпионов',
  'champions league',
  'uefa champions league',
  'лига европы',
  'europa league',
  'чемпионат мира',
  'world cup',
  'евро',
  'euro',
  'copa america',
];

function getMoscowDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function parseCandidateDate(candidate) {
  const raw = candidate?.starts_at || candidate?.date || candidate?.match_start_at || candidate?.matchDate || candidate?.startTime;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasOdds(candidate) {
  if (!candidate?.odds) return false;
  if (Array.isArray(candidate.odds)) return candidate.odds.length > 0;
  if (typeof candidate.odds === 'object') return Object.keys(candidate.odds).length > 0;
  return false;
}

function isFootballCandidate(candidate) {
  const slug = String(candidate?.sport_slug || candidate?.sportSlug || candidate?.sport || '').toLowerCase();
  if (slug === 'football' || slug === 'soccer' || slug === 'футбол') return true;
  return resolveSport(slug) === 1;
}

function isTerminalOrLiveStatus(candidate) {
  const status = String(candidate?.status || candidate?.status_name || candidate?.statusName || '').toLowerCase();
  return /live|finished|ended|cancelled|canceled|in.?play|перерыв|заверш/.test(status);
}

function filterGlobalFootballCandidates(matches, { now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const todayKey = getMoscowDateKey(nowDate);
  return (matches || []).filter((candidate) => {
    const startsAt = parseCandidateDate(candidate);
    return isFootballCandidate(candidate)
      && startsAt
      && startsAt.getTime() > nowDate.getTime()
      && getMoscowDateKey(startsAt) === todayKey
      && !isTerminalOrLiveStatus(candidate)
      && hasOdds(candidate);
  });
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function isMeaningfulFootballLeague(candidate) {
  const parts = [
    candidate?.league_label,
    candidate?.league,
    candidate?.league_name,
    candidate?.league?.name,
    candidate?.league?.slug,
    candidate?.league?.country?.name,
    candidate?.tournament_name,
    candidate?.tournament_name_en,
    candidate?.country,
  ].map(normalizeText).filter(Boolean);
  const haystack = parts.join(' ');
  if (!haystack) return false;
  return MAJOR_FOOTBALL_LEAGUES.some((needle) => haystack.includes(normalizeText(needle)));
}

function toNumber(value) {
  const raw = value && typeof value === 'object' && value.value != null ? value.value : value;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizeRisk(value) {
  const risk = normalizeText(value || 'medium');
  if (risk.includes('high') || risk.includes('выс')) return 'high';
  if (risk.includes('low') || risk.includes('низ')) return 'low';
  return 'medium';
}

function inferMarket(rawType) {
  const type = normalizeText(rawType);
  if (['one_x_two', '1x2', 'home_win', 'draw', 'away_win'].includes(type)) return 'one_x_two';
  if (type.includes('double_chance') || ['1x', 'x2', '12'].includes(type)) return 'double_chance';
  if (type === 'total' || type.includes('total_over') || type.includes('total_under')) return 'total';
  if (type.includes('both_to_score') || type.includes('btts')) return 'both_to_score';
  if (type.includes('handicap') || type.includes('фора')) return 'handicap';
  if (type.includes('team_total') || type.includes('total_t1') || type.includes('total_t2')) return 'team_total';
  if (type.includes('correct_score')) return 'correct_score';
  return type;
}

function normalizeBet(rawBet, candidate) {
  if (!rawBet || typeof rawBet !== 'object') return null;
  const market = inferMarket(rawBet.market || rawBet.market_type || rawBet.type || rawBet.bet_type || rawBet.key);
  if (!ALLOWED_MARKETS.has(market)) return null;

  const odds = toNumber(rawBet.rate ?? rawBet.odds ?? rawBet.coefficient ?? rawBet.price);
  if (odds == null || odds < MIN_ODDS || odds > MAX_ODDS) return null;

  const risk = normalizeRisk(rawBet.risk ?? rawBet.risk_level ?? rawBet.riskLevel ?? rawBet.risk_label ?? rawBet.risk_name);
  if (risk === 'high') return null;

  return {
    type: rawBet.type || rawBet.market || market,
    market,
    outcome: rawBet.outcome ?? rawBet.selection ?? rawBet.selection_code ?? null,
    selection_code: rawBet.selection_code ?? rawBet.selection ?? rawBet.outcome ?? null,
    participant_scope: rawBet.participant_scope ?? rawBet.scope ?? null,
    line: rawBet.line ?? rawBet.line_value ?? null,
    line_value: rawBet.line_value ?? rawBet.line ?? null,
    label: rawBet.label || rawBet.title || rawBet.name || market,
    rate: odds,
    odds_decimal: odds,
    risk,
    risk_label: risk === 'low' ? 'низкий' : 'средний',
    reason: rawBet.reason || rawBet.description || `Глобальная ставка дня по матчу ${getHomeTeamName(candidate)} — ${getAwayTeamName(candidate)}`.trim(),
  };
}

function makeAnalyticalBet({ market, label, selectionCode, participantScope = null, line = null, odds, confidence = 70, reason }) {
  const rate = toNumber(odds);
  if (rate == null || rate < MIN_ODDS || rate > MAX_ODDS) return null;
  return {
    type: market,
    market,
    outcome: selectionCode,
    selection_code: selectionCode,
    participant_scope: participantScope,
    line,
    line_value: line,
    label,
    rate,
    odds_decimal: rate,
    risk: confidence >= 72 ? 'low' : 'medium',
    risk_label: confidence >= 72 ? 'низкий' : 'средний',
    confidence,
    source: 'analytics_odds',
    reason,
  };
}

function readOddObject(odds, keys) {
  for (const key of keys) {
    const value = odds?.[key];
    if (value != null) return value;
  }
  return null;
}

function getAnalyticsFeatures(candidate) {
  return candidate?.analytics_features || candidate?.features || candidate?.sstats_features || {};
}

function analyticsCoverageScore(features) {
  const coverage = features?.coverage || {};
  const keys = ['home_team_stats', 'away_team_stats', 'home_recent_form', 'away_recent_form', 'glicko_available', 'h2h_available'];
  return keys.reduce((sum, key) => sum + (coverage[key] ? 1 : 0), 0);
}

function teamAttackSignal(team = {}) {
  return [team.avg_scored, team.xg_for, team.form_points_per_game]
    .map(toNumber)
    .filter((value) => value != null)
    .reduce((sum, value) => sum + value, 0);
}

function buildOddsBackedAnalyticalBets(candidate) {
  const odds = candidate?.odds || {};
  const features = getAnalyticsFeatures(candidate);
  const homeSignal = teamAttackSignal(features.home);
  const awaySignal = teamAttackSignal(features.away);
  const totalSignal = toNumber(features.home?.avg_scored) + toNumber(features.away?.avg_scored);
  const coverageScore = analyticsCoverageScore(features);
  const confidenceBase = Math.min(78, 58 + coverageScore * 4);
  const bets = [];

  const oneXTwo = readOddObject(odds, ['one_x_two', '1x2', 'winner']) || odds;
  if (homeSignal >= awaySignal + 1.0) {
    bets.push(makeAnalyticalBet({
      market: 'one_x_two',
      label: 'Победа хозяев',
      selectionCode: 'home',
      odds: oneXTwo.w1 ?? oneXTwo.home ?? oneXTwo.home_win,
      confidence: confidenceBase,
      reason: 'Аналитический перевес хозяев по форме/атакующим метрикам; коэффициент взят с рынка.',
    }));
  } else if (awaySignal >= homeSignal + 1.0) {
    bets.push(makeAnalyticalBet({
      market: 'one_x_two',
      label: 'Победа гостей',
      selectionCode: 'away',
      odds: oneXTwo.w2 ?? oneXTwo.away ?? oneXTwo.away_win,
      confidence: confidenceBase,
      reason: 'Аналитический перевес гостей по форме/атакующим метрикам; коэффициент взят с рынка.',
    }));
  }

  const btts = readOddObject(odds, ['both_to_score', 'btts']);
  if (btts && homeSignal >= 3.5 && awaySignal >= 2.8) {
    bets.push(makeAnalyticalBet({
      market: 'both_to_score',
      label: 'Обе забьют — да',
      selectionCode: 'yes',
      odds: btts.yes ?? btts.YES,
      confidence: confidenceBase + 4,
      reason: 'Обе команды имеют достаточный атакующий профиль; коэффициент только валидирует рынок.',
    }));
  }

  const totals = Array.isArray(odds.totals) ? odds.totals : Array.isArray(odds.total) ? odds.total : [];
  for (const item of totals) {
    const line = toNumber(item.line ?? item.line_value ?? item.value);
    if (line == null) continue;
    if (totalSignal >= line + 0.5) {
      bets.push(makeAnalyticalBet({
        market: 'total',
        label: `Тотал больше ${line}`,
        selectionCode: 'over',
        line,
        odds: item.over ?? item.tb ?? item.more,
        confidence: confidenceBase,
        reason: 'Суммарный атакующий профиль выше линии тотала; коэффициент взят с рынка.',
      }));
    } else if (totalSignal > 0 && totalSignal <= line - 0.8) {
      bets.push(makeAnalyticalBet({
        market: 'total',
        label: `Тотал меньше ${line}`,
        selectionCode: 'under',
        line,
        odds: item.under ?? item.tm ?? item.less,
        confidence: confidenceBase,
        reason: 'Суммарный атакующий профиль ниже линии тотала; коэффициент взят с рынка.',
      }));
    }
  }

  const handicap = odds.handicap || odds.handicaps;
  const homeHandicaps = handicap?.home || handicap?.w1 || {};
  const awayHandicaps = handicap?.away || handicap?.w2 || {};
  if (homeSignal >= awaySignal + 1.0) {
    for (const [line, odd] of Object.entries(homeHandicaps)) {
      bets.push(makeAnalyticalBet({ market: 'handicap', label: `Ф1 ${line}`, selectionCode: 'home', participantScope: 'home', line: toNumber(line), odds: odd, confidence: confidenceBase - 4, reason: 'Фора выбрана аналитикой по разнице силы команд; коэффициент взят с рынка.' }));
    }
  }
  if (awaySignal >= homeSignal + 1.0) {
    for (const [line, odd] of Object.entries(awayHandicaps)) {
      bets.push(makeAnalyticalBet({ market: 'handicap', label: `Ф2 ${line}`, selectionCode: 'away', participantScope: 'away', line: toNumber(line), odds: odd, confidence: confidenceBase - 4, reason: 'Фора выбрана аналитикой по разнице силы команд; коэффициент взят с рынка.' }));
    }
  }

  return bets.filter(Boolean);
}

function extractRawBets(candidate) {
  return buildOddsBackedAnalyticalBets(candidate);
}

function collectEligibleBets(candidate) {
  return buildOddsBackedAnalyticalBets(candidate);
}

function marketScore(market) {
  if (['double_chance', 'total', 'both_to_score'].includes(market)) return 10;
  return 5;
}

function scoreBet(candidate, bet) {
  let score = 0;
  const reasons = [];
  if (bet.risk === 'low') { score += 30; reasons.push('низкий риск'); }
  if (bet.risk === 'medium') { score += 20; reasons.push('средний риск'); }
  if (bet.rate >= 1.75 && bet.rate <= 2.05) { score += 20; reasons.push('коэффициент в оптимальном диапазоне'); }
  else { score += 10; reasons.push('коэффициент в допустимом диапазоне'); }
  if (isMeaningfulFootballLeague(candidate)) { score += 20; reasons.push('достаточно крупный турнир'); }
  score += marketScore(bet.market);
  return { score, reasons };
}

function selectGlobalRecommendedPick(matches, { now = new Date() } = {}) {
  const candidates = filterGlobalFootballCandidates(matches, { now }).filter(isMeaningfulFootballLeague);
  const scored = [];
  for (const match of candidates) {
    for (const bet of collectEligibleBets(match)) {
      const scoredBet = scoreBet(match, bet);
      scored.push({ match, selectedBet: bet, ...scoredBet });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = parseCandidateDate(a.match)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseCandidateDate(b.match)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.match.id || a.match.match_id || '').localeCompare(String(b.match.id || b.match.match_id || ''));
  });

  const best = scored[0];
  if (!best) return null;
  const quality = best.score >= STRONG_SCORE_THRESHOLD ? 'strong' : 'low_confidence';
  const warnings = quality === 'low_confidence'
    ? ['Сегодня сильной ставки нет — выбран наиболее приемлемый вариант с повышенной осторожностью.']
    : [];
  return { ...best, quality, warnings };
}

function buildAvailableOddsOptions(match) {
  const odds = match?.odds || {};
  const options = [];
  const push = ({ market, selection_code, participant_scope = null, line = null, label, odd }) => {
    const value = toNumber(odd);
    if (value == null || value < MIN_ODDS || value > MAX_ODDS) return;
    options.push({ market, selection_code, participant_scope, line, label, odds_decimal: value });
  };
  const oneXTwo = readOddObject(odds, ['one_x_two', '1x2', 'winner']) || odds;
  push({ market: 'one_x_two', selection_code: 'home', participant_scope: null, label: 'Победа хозяев', odd: oneXTwo.w1 ?? oneXTwo.home ?? oneXTwo.home_win });
  push({ market: 'one_x_two', selection_code: 'draw', participant_scope: null, label: 'Ничья', odd: oneXTwo.x ?? oneXTwo.draw });
  push({ market: 'one_x_two', selection_code: 'away', participant_scope: null, label: 'Победа гостей', odd: oneXTwo.w2 ?? oneXTwo.away ?? oneXTwo.away_win });
  const btts = readOddObject(odds, ['both_to_score', 'btts']);
  push({ market: 'both_to_score', selection_code: 'yes', label: 'Обе забьют — да', odd: btts?.yes ?? btts?.YES });
  push({ market: 'both_to_score', selection_code: 'no', label: 'Обе забьют — нет', odd: btts?.no ?? btts?.NO });
  const totals = Array.isArray(odds.totals) ? odds.totals : Array.isArray(odds.total) ? odds.total : [];
  for (const item of totals) {
    const line = toNumber(item.line ?? item.line_value ?? item.value);
    push({ market: 'total', selection_code: 'over', line, label: `Тотал больше ${line}`, odd: item.over ?? item.tb ?? item.more });
    push({ market: 'total', selection_code: 'under', line, label: `Тотал меньше ${line}`, odd: item.under ?? item.tm ?? item.less });
  }
  const handicap = odds.handicap || odds.handicaps;
  for (const [line, odd] of Object.entries(handicap?.home || handicap?.w1 || {})) {
    push({ market: 'handicap', selection_code: 'home', participant_scope: 'home', line: toNumber(line), label: `Ф1 ${line}`, odd });
  }
  for (const [line, odd] of Object.entries(handicap?.away || handicap?.w2 || {})) {
    push({ market: 'handicap', selection_code: 'away', participant_scope: 'away', line: toNumber(line), label: `Ф2 ${line}`, odd });
  }
  return options;
}

function sanitizeSstatsForLlm(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const { odds, ...rest } = payload;
  return rest;
}

function buildLlmCandidatePayload(match) {
  return {
    match_id: String(match.match_id || match.id || ''),
    slug: match.match_slug || match.slug || '',
    starts_at: parseCandidateDate(match)?.toISOString() || null,
    league: getLeagueName(match),
    home_team: getHomeTeamName(match),
    away_team: getAwayTeamName(match),
    available_odds: buildAvailableOddsOptions(match),
    raw_odds_note: 'Выбирай только из available_odds. SStats odds удалены из payload и не являются источником коэффициентов.',
    analytics_features: getAnalyticsFeatures(match),
    sstats_data: sanitizeSstatsForLlm(match.sstats_data),
  };
}

function buildLlmSelectionPrompts(candidates, { now = new Date() } = {}) {
  const payload = {
    task: 'choose_one_global_recommended_pick',
    product_rule: 'LLM делает прогноз. Код только валидирует, что выбранный рынок и коэффициент существуют в odds, а факты есть в SStats payload.',
    date_moscow: getMoscowDateKey(now),
    odds_provider: 'stavka_only_for_odds',
    analytics_source: 'sstats',
    constraints: {
      choose_exactly_one: true,
      allowed_markets: [...ALLOWED_MARKETS],
      odds_decimal_min: MIN_ODDS,
      odds_decimal_max: MAX_ODDS,
      use_only_available_odds: true,
      no_external_facts: true,
      no_popular_bets_as_reason: true,
    },
    candidates: candidates.map(buildLlmCandidatePayload),
  };
  return {
    systemPrompt: [
      'Ты — спортивный аналитик Tiger Bet. Твоя задача — выбрать один лучший прогноз дня из переданных футбольных матчей.',
      'SStats/team_stats/xG/форма — аналитическая база прогноза. Stavka odds — только список доступных коэффициентов, не источник выбора.',
      'Нельзя выдумывать рынки, коэффициенты, факты, травмы, составы или мотивацию. Выбирай только рынок/исход из candidate.available_odds и копируй odds_decimal точно.',
      'Если сильной ставки нет, всё равно выбери наиболее приемлемую low/medium risk ставку и явно укажи warning/low_confidence.',
      'Верни только JSON без markdown.',
    ].join('\n'),
    userPrompt: `Выбери одну Ставку дня.\n\nВерни JSON строго такого вида:\n{\n  "match_id": "...",\n  "market": "one_x_two|double_chance|total|both_to_score|handicap|team_total",\n  "selection_code": "home|away|draw|yes|no|over|under|...",\n  "participant_scope": "home|away|null",\n  "line": 2.5,\n  "label": "человекочитаемое название ставки",\n  "odds_decimal": 1.85,\n  "confidence": 0-100,\n  "risk": "low|medium",\n  "quality": "strong|low_confidence",\n  "headline": "короткий заголовок",\n  "brief": "аналитическое объяснение выбора",\n  "risk_note": "главный риск",\n  "reason": "почему выбран именно этот рынок"\n}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`,
  };
}

function parseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function oddsEqual(a, b) {
  const left = toNumber(a);
  const right = toNumber(b);
  return left != null && right != null && Math.abs(left - right) < 0.001;
}

function findAvailableOdd(candidate, selection) {
  const market = inferMarket(selection.market);
  const code = normalizeText(selection.selection_code || selection.outcome || '');
  const line = toNumber(selection.line ?? selection.line_value);
  const odds = candidate?.odds || {};
  if (market === 'one_x_two') {
    const oneXTwo = readOddObject(odds, ['one_x_two', '1x2', 'winner']) || odds;
    const map = { home: oneXTwo.w1 ?? oneXTwo.home ?? oneXTwo.home_win, away: oneXTwo.w2 ?? oneXTwo.away ?? oneXTwo.away_win, draw: oneXTwo.x ?? oneXTwo.draw };
    return map[code] ?? null;
  }
  if (market === 'both_to_score') {
    const btts = readOddObject(odds, ['both_to_score', 'btts']);
    return code === 'yes' ? (btts?.yes ?? btts?.YES) : code === 'no' ? (btts?.no ?? btts?.NO) : null;
  }
  if (market === 'total') {
    const totals = Array.isArray(odds.totals) ? odds.totals : Array.isArray(odds.total) ? odds.total : [];
    const item = totals.find((row) => line != null && toNumber(row.line ?? row.line_value ?? row.value) === line);
    if (!item) return null;
    return code === 'over' ? (item.over ?? item.tb ?? item.more) : code === 'under' ? (item.under ?? item.tm ?? item.less) : null;
  }
  if (market === 'handicap') {
    const handicap = odds.handicap || odds.handicaps;
    const scope = normalizeText(selection.participant_scope || code);
    const rows = scope === 'home' ? (handicap?.home || handicap?.w1 || {}) : scope === 'away' ? (handicap?.away || handicap?.w2 || {}) : {};
    return Object.entries(rows).find(([key]) => toNumber(key) === line)?.[1] ?? null;
  }
  return null;
}

function validateLlmSelection(selection, candidates) {
  if (!selection || typeof selection !== 'object') return null;
  const matchId = String(selection.match_id || selection.id || '');
  const match = candidates.find((candidate) => String(candidate.match_id || candidate.id || '') === matchId || String(candidate.id || '') === matchId);
  if (!match) return null;
  const market = inferMarket(selection.market);
  if (!ALLOWED_MARKETS.has(market)) return null;
  const odds = toNumber(selection.odds_decimal ?? selection.rate ?? selection.odds);
  if (odds == null || odds < MIN_ODDS || odds > MAX_ODDS) return null;
  const availableOdd = findAvailableOdd(match, { ...selection, market });
  if (!oddsEqual(availableOdd, odds)) return null;
  const confidence = Math.max(0, Math.min(100, Math.round(toNumber(selection.confidence) ?? 60)));
  const risk = normalizeRisk(selection.risk || (confidence >= 76 ? 'low' : 'medium'));
  if (risk === 'high') return null;
  const selectedBet = {
    type: market,
    market,
    outcome: selection.selection_code || selection.outcome || null,
    selection_code: selection.selection_code || selection.outcome || null,
    participant_scope: selection.participant_scope ?? null,
    line: selection.line ?? null,
    line_value: selection.line ?? null,
    label: selection.label || market,
    rate: odds,
    odds_decimal: odds,
    risk,
    risk_label: risk === 'low' ? 'низкий' : 'средний',
    confidence,
    source: 'llm_forecast',
    reason: selection.reason || selection.brief || 'LLM-прогноз по SStats analytics и доступным коэффициентам.',
  };
  const quality = selection.quality === 'strong' || confidence >= STRONG_SCORE_THRESHOLD ? 'strong' : 'low_confidence';
  const warnings = quality === 'low_confidence'
    ? [selection.risk_note || 'Сегодня сильной ставки нет — выбран наиболее приемлемый вариант с повышенной осторожностью.']
    : [];
  return {
    match,
    selectedBet,
    score: confidence,
    reasons: [selection.reason || 'LLM-прогноз по SStats analytics'],
    quality,
    warnings,
    llm: {
      headline: selection.headline || null,
      brief: selection.brief || null,
      risk_note: selection.risk_note || null,
    },
  };
}

async function defaultLlmSelector({ candidates, now, provider = aiBriefLlmProvider, modelName = process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', previousSelection = null, validationError = null }) {
  const prompts = buildLlmSelectionPrompts(candidates, { now });
  const userPrompt = validationError
    ? `${prompts.userPrompt}\n\nПредыдущий ответ был отклонён валидатором: ${validationError}.\nПредыдущий JSON: ${JSON.stringify(previousSelection)}\nВерни новый JSON. Скопируй odds_decimal ТОЧНО из payload odds, без округления и без пересчёта.`
    : prompts.userPrompt;
  const result = await provider({ systemPrompt: prompts.systemPrompt, userPrompt, modelName, fewShots: [] });
  return parseJsonObject(result?.text);
}

async function selectGlobalRecommendedPickWithLlm(candidates, { now = new Date(), llmSelector = defaultLlmSelector, modelName } = {}) {
  const selectableCandidates = candidates.filter((candidate) => buildAvailableOddsOptions(candidate).length > 0);
  if (!llmSelector || !selectableCandidates.length) return { selected: null, reason: !llmSelector ? 'no_llm_selector' : 'no_available_stavka_odds' };
  let raw = await llmSelector({ candidates: selectableCandidates.map(buildLlmCandidatePayload), rawCandidates: selectableCandidates, now, modelName });
  let selected = validateLlmSelection(raw, selectableCandidates);
  if (!selected && raw) {
    raw = await llmSelector({
      candidates: selectableCandidates.map(buildLlmCandidatePayload),
      rawCandidates: selectableCandidates,
      now,
      modelName,
      previousSelection: raw,
      validationError: 'selected market/selection must exist and odds_decimal must exactly match payload odds',
    });
    selected = validateLlmSelection(raw, selectableCandidates);
  }
  if (!selected) return { selected: null, reason: 'llm_selection_invalid', raw_selection: raw || null };
  return { selected, raw_selection: raw };
}

function getHomeTeamName(candidate) {
  return candidate?.home_team || candidate?.teams?.home?.name || candidate?.home?.name || '';
}

function getAwayTeamName(candidate) {
  return candidate?.away_team || candidate?.teams?.away?.name || candidate?.away?.name || '';
}

function getLeagueName(candidate) {
  return candidate?.league_label || candidate?.league?.name || candidate?.league_name || candidate?.tournament_name || '';
}

function toPersistenceCandidate(candidate) {
  const startsAt = parseCandidateDate(candidate);
  return {
    ...candidate,
    id: String(candidate?.match_id || candidate?.id || ''),
    match_id: String(candidate?.match_id || candidate?.id || ''),
    match_slug: candidate?.match_slug || candidate?.slug || '',
    sport_slug: candidate?.sport_slug || candidate?.sportSlug || 'soccer',
    external_league_id: candidate?.external_league_id || candidate?.league?.id || null,
    league_slug: candidate?.league_slug || candidate?.league?.slug || '',
    league_label: getLeagueName(candidate),
    home_team: getHomeTeamName(candidate),
    away_team: getAwayTeamName(candidate),
    starts_at: startsAt ? startsAt.toISOString() : null,
  };
}

function buildSourcePayload(selected) {
  const source = {
    source: 'global_recommended_pick',
    source_contract: 'sstats_analytics_plus_stavka_odds_v1',
    source_hash: crypto.createHash('sha256').update(JSON.stringify({
      match: selected.match.match_id || selected.match.id,
      sstats_match_id: selected.match.sstats_match_id || null,
      bet: selected.selectedBet,
      created_for_date: getMoscowDateKey(),
    })).digest('hex'),
    selected,
    sstats_data: selected.match.sstats_data || null,
    odds_provider: 'stavka',
    odds_snapshot: selected.match.odds || null,
  };
  return source;
}

function buildAnalysisSnapshot(selected) {
  const matchTitle = `${getHomeTeamName(selected.match) || 'Команда 1'} — ${getAwayTeamName(selected.match) || 'Команда 2'}`;
  const riskNote = selected.warnings[0] || `${selected.selectedBet.risk_label} риск, high-risk исключён.`;
  return {
    status: 'ready',
    analysis_type_code: ANALYSIS_TYPE_CODE,
    headline: selected.llm?.headline || `Ставка дня: ${selected.selectedBet.label}`,
    brief: selected.llm?.brief || `${matchTitle}. LLM выбрал одну prematch-ставку по всему футболу: ${selected.selectedBet.label} за ${selected.selectedBet.rate}.`,
    risk_note: selected.llm?.risk_note || riskNote,
    recommended_bets: [{
      ...selected.selectedBet,
      risk_level: selected.selectedBet.risk,
      reason: selected.selectedBet.reason,
    }],
    model_name: selected.model_name || 'llm-global-recommended-pick',
    prompt_version: 'global-recommended-pick-llm-v1',
  };
}

async function findExistingRecommendedPick(pg, now = new Date()) {
  if (!pg) return null;
  const todayKey = getMoscowDateKey(now);
  const [row] = await pg.connection(
    `SELECT prediction_card_id, home_team, away_team, match_start_at, headline
     FROM bet.v_prediction_card_history
     WHERE card_type_code = $1
       AND card_status_code = 'published'
       AND visibility_scope = 'public'
       AND (match_start_at AT TIME ZONE 'Europe/Moscow')::date = $2::date
     ORDER BY published_at DESC, prediction_card_id DESC
     LIMIT 1`,
    [CARD_TYPE_CODE, todayKey],
  );
  return row || null;
}

async function ensureGlobalPickDictionaries(pg) {
  const [analysisType] = await pg.connection(
    'SELECT analysis_type_id FROM public.analysis_type WHERE analysis_type_code = $1 AND is_active = true',
    [ANALYSIS_TYPE_CODE],
  );
  const [cardType] = await pg.connection(
    'SELECT card_type_id FROM bet.card_type WHERE card_type_code = $1 AND is_active = true',
    [CARD_TYPE_CODE],
  );
  const missing = [];
  if (!analysisType) missing.push(`public.analysis_type.${ANALYSIS_TYPE_CODE}`);
  if (!cardType) missing.push(`bet.card_type.${CARD_TYPE_CODE}`);
  if (missing.length) {
    throw new Error(`Missing global recommended pick dictionaries: ${missing.join(', ')}`);
  }
}

async function resolveFallbackTournamentId(pg, candidate) {
  if (!pg) return null;
  const names = [getLeagueName(candidate), candidate?.league_slug, candidate?.league?.slug]
    .map(normalizeText)
    .filter(Boolean);
  const haystack = names.join(' ');
  if (!haystack) return null;

  const preferred = [];
  if (haystack.includes('champions')) preferred.push('UEFA Champions League', 'Лига чемпионов УЕФА');
  if (haystack.includes('europa')) preferred.push('UEFA Europa League', 'Лига Европы');
  if (haystack.includes('premier')) preferred.push('Premier League', 'Премьер-лига');
  if (haystack.includes('liga') || haystack.includes('ла лига')) preferred.push('La Liga', 'Ла Лига');
  if (haystack.includes('serie')) preferred.push('Serie A', 'Серия А');
  if (haystack.includes('bundesliga')) preferred.push('Bundesliga', 'Бундеслига');

  for (const name of preferred) {
    const [row] = await pg.connection(
      `SELECT tournament_id
       FROM public.tournament
       WHERE lower(tournament_name) = lower($1)
          OR lower(tournament_name_en) = lower($1)
       ORDER BY tournament_id ASC
       LIMIT 1`,
      [name],
    );
    if (row?.tournament_id != null) return row.tournament_id;
  }

  const leagueName = getLeagueName(candidate);
  if (!leagueName) return null;
  const [row] = await pg.connection(
    `SELECT tournament_id
     FROM public.tournament
     WHERE lower(tournament_name) LIKE lower($1)
        OR lower(tournament_name_en) LIKE lower($1)
     ORDER BY tournament_id ASC
     LIMIT 1`,
    [`%${leagueName}%`],
  );
  return row?.tournament_id ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichWithSstatsAnalytics(match, { sstatsMatchLoader = defaultSstatsMatchLoader } = {}) {
  if (getAnalyticsFeatures(match)?.coverage) return match;
  if (!sstatsMatchLoader) return null;
  const startsAt = parseCandidateDate(match);
  const dateKey = startsAt ? getMoscowDateKey(startsAt) : null;
  const payload = await sstatsMatchLoader(match, { dateKey });
  if (!payload) return null;
  const features = extractAnalyticsFeatures({ sport: 'soccer', sstatsData: payload });
  if (analyticsCoverageScore(features) <= 0) return null;
  return {
    ...match,
    analytics_features: features,
    sstats_data: payload,
    sstats_match_id: payload.fixture_id || payload.game_id || payload.id || payload.game?.id || null,
  };
}

function normalizeLatinToken(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulNameTokens(value) {
  const stop = new Set(['fc', 'fk', 'cf', 'sc', 'ac', 'club', 'town', 'united', 'women', 'u17', 'u19', 'u21']);
  return normalizeLatinToken(value).split(/\s+/).filter((token) => token.length >= 3 && !stop.has(token));
}

function slugMatchesSstatsGame(match, game) {
  const slug = normalizeLatinToken(match?.slug || match?.match_slug || '');
  if (!slug) return false;
  const homeTokens = meaningfulNameTokens(game?.homeTeam?.name || '');
  const awayTokens = meaningfulNameTokens(game?.awayTeam?.name || '');
  const hasHome = homeTokens.some((token) => slug.includes(token));
  const hasAway = awayTokens.some((token) => slug.includes(token));
  return hasHome && hasAway;
}

async function loadSstatsDayList(dateKey) {
  if (!dateKey) return [];
  if (sstatsListCache.has(dateKey)) return sstatsListCache.get(dateKey);
  const list = await sstatsApi.apiGet('/Games/list', {
    from: `${dateKey}T00:00:00+03:00`,
    to: `${dateKey}T23:59:59+03:00`,
    limit: '500',
    TimeZone: '3',
  });
  const rows = Array.isArray(list) ? list : [];
  sstatsListCache.set(dateKey, rows);
  return rows;
}

async function defaultSstatsMatchLoader(match, { dateKey } = {}) {
  if (!sstatsApi.hasApiKey()) return null;
  const existingId = match.sstats_match_id || match.sstats_id || match.sstatsGameId;
  if (existingId) return sstatsApi.buildMatchPayload(existingId);

  const games = await loadSstatsDayList(dateKey);
  const slugMatch = games.find((game) => slugMatchesSstatsGame(match, game));
  if (slugMatch?.id) return sstatsApi.buildMatchPayload(slugMatch.id);

  const home = getHomeTeamName(match);
  const away = getAwayTeamName(match);
  if (!home || !away) return null;
  const found = await sstatsApi.findGameByTeams(home, away, dateKey);
  const gameId = found?.id || found?.gameId;
  if (!gameId) return null;
  return sstatsApi.buildMatchPayload(gameId);
}

async function runGlobalRecommendedPick({ pg, now = new Date(), dryRun = false, force = false, matches = null, sstatsMatchLoader = defaultSstatsMatchLoader, llmSelector = defaultLlmSelector, modelName = process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini' } = {}) {
  if (!dryRun && !force && pg) {
    const existing = await findExistingRecommendedPick(pg, now);
    if (existing) {
      return {
        candidates_scanned: 0,
        football_candidates: 0,
        eligible_candidates: 0,
        selected: null,
        analysis_created: false,
        card_created: false,
        prediction_card_id: existing.prediction_card_id,
        skipped: true,
        reason: 'already_exists_for_today',
        existing,
      };
    }
  }

  const allMatches = matches || await fetchAllMatches({ sport: 'football' });
  const footballCandidates = filterGlobalFootballCandidates(allMatches, { now });
  const meaningful = footballCandidates.filter(isMeaningfulFootballLeague);
  const analyticsCandidates = [];
  for (const match of meaningful.slice(0, 20)) {
    try {
      const enriched = await enrichWithSstatsAnalytics(match, { sstatsMatchLoader });
      if (enriched) analyticsCandidates.push(enriched);
      if (!matches) await sleep(900);
    } catch {
      // Skip candidates without reliable SStats analytics. Stavka odds alone are not enough.
    }
  }
  const llmResult = await selectGlobalRecommendedPickWithLlm(analyticsCandidates, { now, llmSelector, modelName });
  const selected = llmResult.selected;
  const summary = {
    candidates_scanned: allMatches.length,
    football_candidates: footballCandidates.length,
    eligible_candidates: meaningful.length,
    analytics_candidates: analyticsCandidates.length,
    selected,
    analysis_created: false,
    card_created: false,
    prediction_card_id: null,
    ...(selected ? {} : { reason: llmResult.reason, raw_selection: llmResult.raw_selection || null }),
  };

  if (!selected || dryRun) return summary;
  if (!pg) throw new Error('pg is required when dryRun=false');
  await ensureGlobalPickDictionaries(pg);

  const persistenceCandidate = toPersistenceCandidate(selected.match);
  const dbContext = await resolveDbContextForCandidate(pg, { systemName: SOURCE_SYSTEM_NAME, candidate: persistenceCandidate });
  if (dbContext.tournamentId == null) {
    dbContext.tournamentId = await resolveFallbackTournamentId(pg, persistenceCandidate);
  }
  const sourcePayload = buildSourcePayload(selected);
  const persistedSource = await persistBundleSnapshot(pg, {
    systemId: dbContext.systemId,
    sportId: dbContext.sportId,
    tournamentId: dbContext.tournamentId,
    candidate: persistenceCandidate,
    sourcePayload,
  });
  const analysisResult = await persistAnalysisSnapshot(pg, {
    matchSourceId: persistedSource.sourceId,
    snapshot: buildAnalysisSnapshot(selected),
  });
  summary.analysis_created = Boolean(analysisResult?.analysisId || analysisResult?.id);
  const matchAnalysisId = analysisResult?.analysisId || analysisResult?.id || analysisResult?.match_analysis_id;
  if (matchAnalysisId) {
    const publication = await backfillPredictionHistory(pg, { matchAnalysisId, limit: 1, cardTypeCode: CARD_TYPE_CODE });
    summary.card_created = publication.cards_created > 0;
    summary.prediction_card_id = publication.results?.[0]?.prediction_card_id ?? null;
  }
  return summary;
}

module.exports = {
  ANALYSIS_TYPE_CODE,
  CARD_TYPE_CODE,
  filterGlobalFootballCandidates,
  isMeaningfulFootballLeague,
  collectEligibleBets,
  selectGlobalRecommendedPick,
  runGlobalRecommendedPick,
  __private: {
    getMoscowDateKey,
    normalizeBet,
    buildAnalysisSnapshot,
    buildSourcePayload,
    buildLlmSelectionPrompts,
    validateLlmSelection,
    selectGlobalRecommendedPickWithLlm,
  },
};
