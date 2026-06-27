// lib/stavkaApi.js
// Stavka.tv JSON API client — 2-tier architecture.
// Tier 1: GET /api/v2/matches (all matches, one request)
// Tier 2: GET /api/v2/matches/{slug}/popular-bets (per-match detail)

const request = require('request');

const API_BASE = 'https://stavka.tv/api/v2';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 1;
const RATE_LIMIT_MS = 200; // 5 req/sec

// --- Rate limiter ---

let _lastRequestAt = 0;

function rateLimitWait() {
  const now = Date.now();
  const elapsed = now - _lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    return RATE_LIMIT_MS - elapsed;
  }
  return 0;
}

function markRequestSent() {
  _lastRequestAt = Date.now();
}

// --- HTTP helpers ---

function httpGet(url) {
  return new Promise((resolve, reject) => {
    request.get(
      {
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        url,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }
        if (response && response.statusCode >= 500) {
          reject(new Error('HTTP ' + response.statusCode + ' from ' + url));
          return;
        }
        resolve(body);
      },
    );
  });
}

async function fetchWithRetry(url, opts) {
  const retries = (opts && opts.retries != null) ? opts.retries : MAX_RETRIES;
  const delay = rateLimitWait();
  if (delay > 0) {
    await new Promise(function (r) { setTimeout(r, delay); });
  }
  markRequestSent();

  var lastError;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var body = await httpGet(url);
      return typeof body === 'string' ? JSON.parse(body) : body;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
      }
    }
  }
  throw lastError;
}

// --- Cache layer (Redis, optional) ---

var _redisClient = null;
var _redisInit = false;

async function resolveRedis(provided) {
  if (provided !== undefined) return provided;
  if (_redisInit) return _redisClient;
  _redisInit = true;
  try {
    var createClient = require('redis').createClient;
    var client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    _redisClient = client;
  } catch (_e) {
    // Redis unavailable — run without cache
  }
  return _redisClient;
}

async function cacheGet(redis, key) {
  if (!redis) return null;
  try {
    var raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

async function cacheSet(redis, key, value, ttlSeconds) {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (_e) {
    // non-fatal
  }
}

// --- Sport mapping ---

var SPORT_MAP = {
  soccer:              { sport_id: 1,  sport_name: 'Футбол' },
  'ice-hockey':        { sport_id: 2,  sport_name: 'Хоккей' },
  tennis:              { sport_id: 3,  sport_name: 'Теннис' },
  basketball:          { sport_id: 4,  sport_name: 'Баскетбол' },
  volleyball:          { sport_id: 5,  sport_name: 'Волейбол' },
  baseball:            { sport_id: 6,  sport_name: 'Бейсбол' },
  handball:            { sport_id: 7,  sport_name: 'Гандбол' },
  futsal:              { sport_id: 8,  sport_name: 'Футзал' },
  snooker:             { sport_id: 9,  sport_name: 'Снукер' },
  csgo:                { sport_id: 10, sport_name: 'КС:ГО' },
  dota2:               { sport_id: 11, sport_name: 'Дота2' },
  'american-football': { sport_id: 12, sport_name: 'Американский футбол' },
  mma:                 { sport_id: 13, sport_name: 'MMA' },
  boxing:              { sport_id: 14, sport_name: 'Бокс' },
};

function resolveSport(sportSlug) {
  return SPORT_MAP[sportSlug] || { sport_id: null, sport_name: sportSlug || '' };
}

// --- Market labels ---

var MARKET_LABELS = {
  one_x_two: {
    w1: 'Победа хозяев',
    w2: 'Победа гостей',
    x: 'Ничья',
  },
  double_chance: {
    x1: '1X (хозяева не проиграют)',
    x2: 'X2 (гости не проиграют)',
    w12: '12 (будет победитель)',
  },
  both_to_score: {
    yes: 'Обе забьют — да',
    no: 'Обе забьют — нет',
  },
  correct_score: function (v) { return 'Точный счёт ' + v; },
  handicap1: function (v) { return 'Фора хозяев (' + v + ')'; },
  handicap2: function (v) { return 'Фора гостей (' + v + ')'; },
  total_over: function (v) { return 'Тотал больше ' + String(v).replace('_', '.'); },
  total_under: function (v) { return 'Тотал меньше ' + String(v).replace('_', '.'); },
  total_t1_over: function (v) { return 'Тотал хозяев больше ' + String(v).replace('_', '.'); },
  total_t1_under: function (v) { return 'Тотал хозяев меньше ' + String(v).replace('_', '.'); },
  total_t2_over: function (v) { return 'Тотал гостей больше ' + String(v).replace('_', '.'); },
  total_t2_under: function (v) { return 'Тотал гостей меньше ' + String(v).replace('_', '.'); },
  total_over_half1: function (v) { return 'Тотал 1-й тайм больше ' + String(v).replace('_', '.'); },
  total_under_half1: function (v) { return 'Тотал 1-й тайм меньше ' + String(v).replace('_', '.'); },
  total_over_half2: function (v) { return 'Тотал 2-й тайм больше ' + String(v).replace('_', '.'); },
  total_under_half2: function (v) { return 'Тотал 2-й тайм меньше ' + String(v).replace('_', '.'); },
  corners_total_over: function (v) { return 'Угловые больше ' + String(v).replace('_', '.'); },
  corners_total_under: function (v) { return 'Угловые меньше ' + String(v).replace('_', '.'); },
  corners_total_t1_over: function (v) { return 'Угловые хозяев больше ' + String(v).replace('_', '.'); },
  corners_total_t1_under: function (v) { return 'Угловые хозяев меньше ' + String(v).replace('_', '.'); },
  corners_total_t2_over: function (v) { return 'Угловые гостей больше ' + String(v).replace('_', '.'); },
  corners_total_t2_under: function (v) { return 'Угловые гостей меньше ' + String(v).replace('_', '.'); },
  yellow_cards_1x2: {
    w1: 'Больше жёлтых — хозяева',
    w2: 'Больше жёлтых — гости',
  },
  yellow_cards_one_x_two: {
    w1: 'Больше жёлтых — хозяева',
    w2: 'Больше жёлтых — гости',
    x: 'Равно жёлтых',
  },
  corners_one_x_two: {
    w1: 'Больше угловых — хозяева',
    w2: 'Больше угловых — гости',
    x: 'Равно угловых',
  },
  yellow_cards_total_over: function (v) { return 'Жёлтые карточки больше ' + String(v).replace('_', '.'); },
  yellow_cards_total_under: function (v) { return 'Жёлтые карточки меньше ' + String(v).replace('_', '.'); },
  yellow_cards_total_t1_over: function (v) { return 'Жёлтые хозяев больше ' + String(v).replace('_', '.'); },
  yellow_cards_total_t1_under: function (v) { return 'Жёлтые хозяев меньше ' + String(v).replace('_', '.'); },
  yellow_cards_total_t2_over: function (v) { return 'Жёлтые гостей больше ' + String(v).replace('_', '.'); },
  yellow_cards_total_t2_under: function (v) { return 'Жёлтые гостей меньше ' + String(v).replace('_', '.'); },
};

function humanReadable(type, outcome) {
  if (!type || !outcome) return null;
  var map = MARKET_LABELS[type];
  if (!map) return null;
  var normalized = String(outcome).replace(/_/g, '.');
  if (typeof map === 'function') return map(normalized);
  return map[outcome] || null;
}

// --- API functions ---

/**
 * Tier 1: Fetch all matches in one request.
 * Returns array of match objects with odds.one_x_two.
 */
async function fetchAllMatches(opts) {
  var redisClient = opts && opts.redisClient;
  var cacheKey = 'stavka:api:matches';
  var redis = await resolveRedis(redisClient);
  var cached = await cacheGet(redis, cacheKey);
  if (cached) return cached;

  try {
    var data = await fetchWithRetry(API_BASE + '/matches');
    var matches = (data && data.data) || data || [];
    if (Array.isArray(matches) && matches.length > 0) {
      await cacheSet(redis, cacheKey, matches, 120); // 2 min
    }
    return matches;
  } catch (_e) {
    return null;
  }
}

/**
 * Tier 2: Fetch match detail (teams, predictionSummary, pastMatches).
 */
async function fetchMatchDetail(slug, opts) {
  if (!slug) return null;
  var redisClient = opts && opts.redisClient;
  var cacheKey = 'stavka:api:match:' + slug;
  var redis = await resolveRedis(redisClient);
  var cached = await cacheGet(redis, cacheKey);
  if (cached) return cached;

  try {
    var data = await fetchWithRetry(API_BASE + '/matches/' + encodeURIComponent(slug));
    var match = (data && data.data) || data || null;
    if (match) {
      await cacheSet(redis, cacheKey, match, 600); // 10 min
    }
    return match;
  } catch (_e) {
    return null;
  }
}

/**
 * Tier 2: Fetch popular bets for a match.
 * Returns { meta: { total }, data: [{ type, outcome, count, rate, percent }] }
 */
async function fetchPopularBets(slug, opts) {
  if (!slug) return null;
  var redisClient = opts && opts.redisClient;
  var cacheKey = 'stavka:api:popular:' + slug;
  var redis = await resolveRedis(redisClient);
  var cached = await cacheGet(redis, cacheKey);
  if (cached) return cached;

  try {
    var data = await fetchWithRetry(API_BASE + '/matches/' + encodeURIComponent(slug) + '/popular-bets');
    if (data) {
      await cacheSet(redis, cacheKey, data, 60); // 1 min
    }
    return data;
  } catch (_e) {
    return null;
  }
}

/**
 * Fetch aggregated bets grouped by market type.
 */
async function fetchAggregatedBets(slug, opts) {
  if (!slug) return null;
  var redisClient = opts && opts.redisClient;
  var cacheKey = 'stavka:api:agg:' + slug;
  var redis = await resolveRedis(redisClient);
  var cached = await cacheGet(redis, cacheKey);
  if (cached) return cached;

  try {
    var data = await fetchWithRetry(API_BASE + '/matches/' + encodeURIComponent(slug) + '/aggregated-bets');
    if (data) {
      await cacheSet(redis, cacheKey, data, 60);
    }
    return data;
  } catch (_e) {
    return null;
  }
}

/**
 * Fetch tennis surface stats.
 */
async function fetchSurfaceStats(slug, opts) {
  if (!slug) return null;
  var redisClient = opts && opts.redisClient;
  var cacheKey = 'stavka:api:surface:' + slug;
  var redis = await resolveRedis(redisClient);
  var cached = await cacheGet(redis, cacheKey);
  if (cached) return cached;

  try {
    var data = await fetchWithRetry(API_BASE + '/matches/' + encodeURIComponent(slug) + '/statistics/surface');
    if (data) {
      await cacheSet(redis, cacheKey, data, 86400); // 24h
    }
    return data;
  } catch (_e) {
    return null;
  }
}

/**
 * Group popular bets by market type, pick top bet per type.
 * Returns sorted by count DESC: [{ type, outcome, count, rate, percent, label }]
 */
function groupBetsByType(popularBetsData) {
  if (!popularBetsData || !Array.isArray(popularBetsData.data)) return [];

  var groups = new Map();

  for (var i = 0; i < popularBetsData.data.length; i++) {
    var bet = popularBetsData.data[i];
    var type = bet.type;
    var outcome = bet.outcome;
    if (!type || !outcome) continue;

    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type).push({
      type: type,
      outcome: outcome,
      count: bet.count || 0,
      rate: bet.rate,
      percent: bet.percent,
    });
  }

  var result = [];
  groups.forEach(function (bets, type) {
    bets.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    var top = bets[0];
    result.push({
      type: top.type,
      outcome: top.outcome,
      count: top.count,
      rate: top.rate,
      percent: top.percent,
      label: humanReadable(top.type, top.outcome),
    label: humanReadable(top.type, top.outcome),
    });
    });
    result.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    return result;
    }
    /**
    * Select 3 bets with different market types, sorted by risk (rate ASC).
    * Enforces minimum gap (default 1.2) between adjacent picks.
    */
    function selectRiskBets(popularBetsData, opts) {
      opts = opts || {};
      var minGap = opts.minGap || 1.2;
      var minCount = opts.minCount || 10;
      var grouped = groupBetsByType(popularBetsData);
      if (grouped.length === 0) return [];

      // Filter out low-confidence bets (too few people bet on it)
      var viable = grouped.filter(function (b) { return (b.count || 0) >= minCount && b.rate > 1; });
      if (viable.length === 0) viable = grouped;

      var byRate = viable.slice().sort(function (a, b) { return (a.rate || 999) - (b.rate || 999); });
    var selected = [];
    var usedTypes = new Set();

    for (var i = 0; i < byRate.length && selected.length < 3; i++) {
    var candidate = byRate[i];
    if (usedTypes.has(candidate.type)) continue;
    if (selected.length === 0) {
    selected.push(candidate);
    usedTypes.add(candidate.type);
    } else {
    var lastRate = selected[selected.length - 1].rate || 0;
    if (candidate.rate >= lastRate + minGap) {
      selected.push(candidate);
      usedTypes.add(candidate.type);
    }
    }
    }

    if (selected.length < 3) {
    // Fill remaining slots ensuring ascending rates
    var remaining = byRate.filter(function (b) { return !usedTypes.has(b.type); });
    for (var j = 0; j < remaining.length && selected.length < 3; j++) {
      var lastR = selected.length > 0 ? selected[selected.length - 1].rate || 0 : 0;
      if (remaining[j].rate > lastR) {
        selected.push(remaining[j]);
        usedTypes.add(remaining[j].type);
      }
    }
    // If still < 3, pick highest rate that maintains order
    if (selected.length < 3) {
      var lastRateFinal = selected[selected.length - 1] ? selected[selected.length - 1].rate || 0 : 0;
      var candidates = remaining.filter(function (b) { return !usedTypes.has(b.type) && b.rate > lastRateFinal; });
      if (candidates.length > 0) {
        candidates.sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); });
        selected.push(candidates[0]);
        usedTypes.add(candidates[0].type);
      }
    }
    // Final fallback: pick highest available even if rate breaks order
    if (selected.length < 3) {
      var fallback = remaining.filter(function (b) { return !usedTypes.has(b.type); });
      fallback.sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); });
      if (fallback.length > 0) {
        selected.push(fallback[0]);
        usedTypes.add(fallback[0].type);
      }
    }
  }

    var riskLabels = ['low', 'medium', 'high'];
    var riskNames = ['Низкий риск', 'Средний риск', 'Высокий риск'];

    // Final sort by rate ASC to ensure correct risk ordering
    selected.sort(function (a, b) { return (a.rate || 999) - (b.rate || 999); });

    return selected.map(function (bet, idx) {
    return {
    type: bet.type,
    outcome: bet.outcome,
    rate: bet.rate,
    count: bet.count,
    percent: bet.percent,
    label: bet.label,
    risk_order: idx + 1,
    risk_label: riskLabels[idx] || 'high',
    risk_name: riskNames[idx] || 'Высокий риск',
    };
    });
    }

    /**\n * Extract a short, meaningful snippet from predictionSummary HTML.
/**
 * Extract a short, meaningful snippet from predictionSummary HTML.
 * Strategy: find the conclusion/recommendation section (📊, "Вывод", "Рекомендация"),
 * fall back to the first team section, and truncate at sentence boundary.
 */
function extractSummarySnippet(predictionSummary, maxLen) {
  maxLen = maxLen || 160;
  if (!predictionSummary) return '';

  var text = String(predictionSummary)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // Try to find conclusion section: 📊, "Вывод", "Рекомендация", "Прогноз на матч"
  var conclusionPatterns = [
    /📊\s*(?:Вывод|Прогноз|Рекомендация|Итог)[:\s]*(.+)/i,
    /(?:📊|☑️|✅)\s*(.+)/i,
    /Вывод[:\s]+(.+)/i,
    /Рекомендуемая ставка[:\s]+(.+)/i,
  ];

  for (var i = 0; i < conclusionPatterns.length; i++) {
    var match = text.match(conclusionPatterns[i]);
    if (match && match[1] && match[1].trim().length > 20) {
      return truncateSentence(match[1].trim(), maxLen);
    }
  }

  // Fallback: first meaningful sentence from the first section
  // Skip very short fragments (emoji-only, single chars)
  var sentences = text.split(/(?<=[.!?])\s+/);
  for (var j = 0; j < sentences.length; j++) {
    var s = sentences[j].trim();
    if (s.length > 30 && !/^[🔵🔴💡📊✅☑️🎯\s]+$/.test(s)) {
      return truncateSentence(s, maxLen);
    }
  }

  return truncateSentence(text, maxLen);
}

function truncateSentence(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  // Cut at last sentence boundary within maxLen
  var cut = text.substring(0, maxLen);
  var lastPeriod = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (lastPeriod > maxLen * 0.4) {
    return cut.substring(0, lastPeriod + 1).trim();
  }
  // No sentence boundary found — cut at last space
  var lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.5) {
    return cut.substring(0, lastSpace) + '...';
  }
  return cut + '...';
}

module.exports = {
  fetchAllMatches: fetchAllMatches,
  fetchMatchDetail: fetchMatchDetail,
  fetchPopularBets: fetchPopularBets,
  fetchAggregatedBets: fetchAggregatedBets,
  fetchSurfaceStats: fetchSurfaceStats,
  groupBetsByType: groupBetsByType,
  extractSummarySnippet: extractSummarySnippet,
  selectRiskBets: selectRiskBets,
  humanReadable: humanReadable,
  resolveSport: resolveSport,
  SPORT_MAP: SPORT_MAP,
  MARKET_LABELS: MARKET_LABELS,
  _resetRateLimiter: function () { _lastRequestAt = 0; },
};
