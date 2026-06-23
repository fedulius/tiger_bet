// Task 3/13 service: recommendations feed for webApp.
// По умолчанию пытаемся взять живые матчи со stavka.tv, при ошибке используем fallback.

const { getLeaguesByCategory } = require('../../lib/stavkaMatches');
const request = require('request');
const { createClient } = require('redis');
const { extractEditorialForecast } = require('../../lib/forecastAnalyzer');

const FALLBACK_TOP_MATCHES = [
  {
    id: 'fallback-3',
    sport_id: 10,
    sport_name: 'КС:ГО',
    match: 'Fnatic vs G2',
    league: 'ESL Pro League',
    starts_at: '2026-04-22T20:00:00.000Z',
    main_thought: 'Победа G2 по текущей форме',
    confidence: 70,
    source_url: 'https://stavka.tv/matches/csgo',
  },
  {
    id: 'fallback-1',
    sport_id: 1,
    sport_name: 'Футбол',
    match: 'Arsenal vs Chelsea',
    league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z',
    main_thought: 'Обе забьют, но Arsenal выглядит сильнее',
    confidence: 68,
    source_url: 'https://stavka.tv/matches/soccer',
  },
  {
    id: 'fallback-4',
    sport_id: 11,
    sport_name: 'Дота2',
    match: 'NAVI vs Spirit',
    league: 'BLAST Premier',
    starts_at: '2026-04-22T22:15:00.000Z',
    main_thought: 'NAVI через плотный матч',
    confidence: 64,
    source_url: 'https://stavka.tv/matches/dota2',
  },
  {
    id: 'fallback-2',
    sport_id: 1,
    sport_name: 'Футбол',
    match: 'Real Madrid vs Sevilla',
    league: 'La Liga',
    starts_at: '2026-04-22T19:00:00.000Z',
    main_thought: 'Победа Real Madrid с контролем темпа',
    confidence: 74,
    source_url: 'https://stavka.tv/matches/soccer',
  },
];

const MONTHS_RU = {
  янв: 0,
  фев: 1,
  мар: 2,
  апр: 3,
  май: 4,
  июн: 5,
  июл: 6,
  авг: 7,
  сен: 8,
  окт: 9,
  ноя: 10,
  дек: 11,
};

const liveCache = {
  updatedAt: 0,
  items: [],
};

const LIVE_CACHE_TTL_MS = 3 * 60 * 1000;
const REDIS_TTL_SECONDS = 300;
const RECENT_PAST_RECHECK_WINDOW_MS = 6 * 60 * 60 * 1000;

let _defaultRedisClient = null;
let _defaultRedisInit = false;

async function resolveRedisClient(provided) {
  if (provided !== undefined) return provided;
  if (_defaultRedisInit) return _defaultRedisClient;
  _defaultRedisInit = true;
  try {
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    _defaultRedisClient = client;
  } catch {
    // Redis unavailable — run without cache
  }
  return _defaultRedisClient;
}

function resetLiveCache() {
  liveCache.updatedAt = 0;
  liveCache.items = [];
}

function buildCacheKey(favoriteSports) {
  if (!Array.isArray(favoriteSports) || favoriteSports.length === 0) {
    return 'recommendations:default';
  }
  const fingerprint = [...favoriteSports]
    .sort((a, b) => Number(a.sport_id) - Number(b.sport_id))
    .map((s) => {
      const leagues = [...(Array.isArray(s.leagues) ? s.leagues : [])].sort().join(',');
      return `${Number(s.sport_id)}:${leagues}`;
    })
    .join('|');
  return `recommendations:${fingerprint}`;
}

function toIsoDate(value) {
  return new Date(value).toISOString();
}

function pickTopByTime(items, limit = 3) {
  const sorted = [...items]
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  if (limit == null) {
    return sorted;
  }

  return sorted.slice(0, limit);
}

function selectUpcomingItems(items = [], { now = Date.now(), limit = null } = {}) {
  const upcoming = pickTopByTime(
    items.filter((item) => new Date(item?.starts_at).getTime() > now),
    null,
  );

  if (limit == null) {
    return upcoming;
  }

  return upcoming.slice(0, limit);
}

function normalizeLeagueName(value = '') {
  return String(value || '').trim().toLowerCase();
}

function buildFavoriteLeagueMap(favoriteSports = []) {
  const entries = new Map();

  for (const sport of Array.isArray(favoriteSports) ? favoriteSports : []) {
    const sportId = Number(sport?.sport_id);
    if (!Number.isFinite(sportId)) {
      continue;
    }

    const leagues = Array.isArray(sport?.leagues)
      ? sport.leagues.map(normalizeLeagueName).filter(Boolean)
      : [];

    entries.set(sportId, new Set(leagues));
  }

  return entries;
}

function filterItemsByFavoriteLeagues(items = [], favoriteSports = []) {
  const leagueMap = buildFavoriteLeagueMap(favoriteSports);

  return items.filter((item) => {
    const selectedLeagues = leagueMap.get(Number(item?.sport_id));
    if (!selectedLeagues || selectedLeagues.size === 0) {
      return true;
    }

    return selectedLeagues.has(normalizeLeagueName(item?.league));
  });
}

function markNewItems(items, nowIso) {
  const nowTs = new Date(nowIso).getTime();

  return items.map((item) => {
    const startTs = new Date(item.starts_at).getTime();
    const diffMinutes = Math.abs(startTs - nowTs) / (1000 * 60);

    return {
      ...item,
      is_new: diffMinutes <= 120,
    };
  });
}

function parseStartsAt({ dateText = '', timeText = '', index = 0, baseNow = new Date() }) {
  const parsed = new Date(baseNow);

  const timeMatch = String(timeText).match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    parsed.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  } else {
    parsed.setTime(parsed.getTime() + index * 30 * 60 * 1000);
  }

  const dateMatch = String(dateText).toLowerCase().match(/(\d{1,2})\s+([а-яё]{3,})/i);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const monthShort = dateMatch[2].slice(0, 3);
    const month = MONTHS_RU[monthShort];

    if (Number.isFinite(day) && Number.isInteger(month)) {
      parsed.setMonth(month, day);
    }
  }

  return parsed.toISOString();
}

function toAbsoluteStavkaUrl(link) {
  const clean = String(link || '').trim();
  if (!clean) {
    return 'https://stavka.tv/matches';
  }

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  return `https://stavka.tv${clean.startsWith('/') ? '' : '/'}${clean}`;
}

function normalizeMatchTitle(team = '') {
  return String(team || '')
    .replace(/\s+-\s+/g, ' vs ')
    .replace(/\s+/g, ' ')
    .trim();
}

function recommendationIdFromLink(link = '', index = 0) {
  const slug = String(link || '').split('/').filter(Boolean).pop();
  if (!slug) {
    return `stavka-match-${index + 1}`;
  }

  return `stavka-${slug.replace(/[^a-zA-Z0-9-_]+/g, '-')}`;
}

function dedupeById(items = []) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item?.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toCoeff(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Number(parsed.toFixed(2));
}

function buildBetLineup(item = {}) {
  const confidence = clamp(Number(item.confidence) || 0, 35, 90);
  const thought = String(item.main_thought || 'Ставка по текущей форме и контексту матча').trim();

  const bet1Coeff = toCoeff(1.5 + (confidence % 40) / 100, 1.65);
  const bet2Coeff = toCoeff(1.7 + ((confidence + 7) % 50) / 100, 1.95);
  const exactHome = confidence >= 66 ? 2 : 1;
  const exactAway = confidence >= 66 ? 1 : 0;

  return [
    {
      type: 'primary',
      forecast: thought,
      coeff: bet1Coeff,
      probability: clamp(Math.round((1 / bet1Coeff) * 100), 45, 70),
      confidence: confidence >= 66 ? 'высокая' : 'средняя',
      description: 'Базовый сценарий с умеренным риском.',
    },
    {
      type: 'value',
      forecast: `Альтернативный value-сценарий по матчу ${item.match || ''}`.trim(),
      coeff: bet2Coeff,
      probability: clamp(Math.round((1 / bet2Coeff) * 100), 40, 60),
      confidence: confidence >= 60 ? 'средняя' : 'ниже средней',
      description: 'Повышенный коэффициент при контролируемом риске.',
    },
    {
      type: 'exact-score',
      forecast: `Точный счет ${exactHome}:${exactAway}`,
      coeff: 6.8,
      probability: 14,
      confidence: 'высокий риск',
      description: 'Сценарная ставка на точный счет.',
    },
  ];
}

function withBetLineup(item = {}) {
  return {
    ...item,
    bets: buildBetLineup(item),
  };
}

function flattenLiveLeagues(leagues = [], baseNow = new Date(), sportMeta = {}) {
  const flat = [];

  for (const leagueRow of leagues) {
    const leagueName = String(leagueRow?.league || '').trim() || 'Ставка ТВ';
    const matches = Array.isArray(leagueRow?.matches) ? leagueRow.matches : [];

    for (const match of matches) {
      if (!match?.team || !match?.link) {
        continue;
      }

      flat.push({
        id: recommendationIdFromLink(match.link, flat.length),
        sport_id: sportMeta.sport_id,
        sport_name: sportMeta.sport_name,
        match: normalizeMatchTitle(match.team),
        league: leagueName,
        starts_at: parseStartsAt({
          dateText: match.date,
          timeText: match.time,
          index: flat.length,
          baseNow,
        }),
        main_thought: 'Основной прогноз доступен на странице матча',
        confidence: 0,
        source_url: toAbsoluteStavkaUrl(match.link),
      });
    }
  }

  return flat;
}

function requestMatchPage(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('match url is required'));
      return;
    }

    request.get({
      headers: { 'content-type': 'text/html;charset=utf-8' },
      url,
    }, (error, response, body) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(body || ''));
    });
  });
}

function extractMatchPageStartsAt(html, item = {}) {
  const source = String(html || '');
  if (!source) {
    return null;
  }

  const faqTime = source.match(/пройд[её]т\s+(\d{1,2}\s+[а-яё]{3,}\s+\d{4}\s+года)\s+в\s+(\d{1,2}:\d{2})\s+по\s+московскому\s+времени/i);
  if (faqTime) {
    try {
      return parseStartsAt({
        dateText: faqTime[1],
        timeText: faqTime[2],
        baseNow: new Date(item.starts_at || Date.now()),
      });
    } catch {
      // Fall through to header parsing.
    }
  }

  const matchHeader = source.match(/<div class="text-h1 info-top"[^>]*>\s*([^<]+?)\s*<\/div>\s*<div class="info-bottom"[^>]*>\s*([^<]+?)\s*<\/div>/i);
  if (!matchHeader) {
    return null;
  }

  const timeText = String(matchHeader[1] || '').trim();
  const dateText = String(matchHeader[2] || '').trim();
  if (!timeText || !dateText) {
    return null;
  }

  try {
    return parseStartsAt({
      dateText,
      timeText,
      baseNow: new Date(item.starts_at || Date.now()),
    });
  } catch {
    return null;
  }
}

async function enrichFromMatchPages(items, { matchPageLoader, correctStartsAtIds = null } = {}) {
  const loader = matchPageLoader || requestMatchPage;

  const enriched = await Promise.all(items.map(async (item) => {
    try {
      const html = await loader(item.source_url);
      const editorial = extractEditorialForecast(html, { matchName: item.match });
      const correctedStartsAt = extractMatchPageStartsAt(html, item);
      const shouldCorrectStartsAt = !correctStartsAtIds || correctStartsAtIds.has(item.id);

      if (!editorial?.mainThought && !(shouldCorrectStartsAt && correctedStartsAt)) {
        return item;
      }

      return {
        ...item,
        starts_at: shouldCorrectStartsAt && correctedStartsAt ? correctedStartsAt : item.starts_at,
        main_thought: editorial?.mainThought || item.main_thought,
        confidence: Number.isFinite(editorial?.probabilityPercent)
          ? editorial.probabilityPercent
          : item.confidence,
      };
    } catch {
      return item;
    }
  }));

  return enriched;
}

async function loadLiveRecommendations({ liveLoader, matchPageLoader, favoriteSports = [], limit = 6, upcomingOnly = true, now = Date.now() } = {}) {
  const sports = Array.isArray(favoriteSports) && favoriteSports.length > 0
    ? favoriteSports
    : [{ sport_id: 1, sport_name: 'Футбол' }];

  const aggregated = [];
  const baseNow = new Date(now);
  for (const sport of sports) {
    const categoryId = Number(sport?.sport_id);
    if (!Number.isFinite(categoryId)) {
      continue;
    }

    const loader = liveLoader || (async () => getLeaguesByCategory(categoryId));
    const leagues = await loader(categoryId);
    if (!Array.isArray(leagues) || leagues.length === 0) {
      continue;
    }

    const filteredLeagues = filterItemsByFavoriteLeagues(
      flattenLiveLeagues(leagues, baseNow, sport),
      [sport],
    );

    aggregated.push(...filteredLeagues);
  }

  if (aggregated.length === 0) {
    return [];
  }

  const upcomingSeed = upcomingOnly
    ? selectUpcomingItems(aggregated, { now, limit })
    : [];
  const recentPastCandidates = upcomingOnly
    ? pickTopByTime(
      aggregated.filter((item) => {
        const startTs = new Date(item?.starts_at).getTime();
        return Number.isFinite(startTs) && startTs <= now && startTs >= (now - RECENT_PAST_RECHECK_WINDOW_MS);
      }),
      limit,
    )
    : [];
  const metadataCandidates = dedupeById([...upcomingSeed, ...recentPastCandidates]);
  const recentPastCandidateIds = new Set(recentPastCandidates.map((item) => item.id));

  let enrichedAggregated = aggregated;
  if (metadataCandidates.length > 0) {
    const correctedItems = await enrichFromMatchPages(metadataCandidates, {
      matchPageLoader,
      correctStartsAtIds: recentPastCandidateIds,
    });
    const correctedById = new Map(correctedItems.map((item) => [item.id, item]));
    enrichedAggregated = aggregated.map((item) => correctedById.get(item.id) || item);
  }

  const selected = upcomingOnly
    ? selectUpcomingItems(enrichedAggregated, { now, limit })
    : pickTopByTime(enrichedAggregated, limit);

  const itemsForEnrichment = selected.length > 0
    ? selected
    : pickTopByTime(enrichedAggregated, limit);

  return await enrichFromMatchPages(itemsForEnrichment, {
    matchPageLoader,
    correctStartsAtIds: new Set(),
  });
}

function filterFallbackByFavoriteSports(favoriteSports = []) {
  const ids = new Set((Array.isArray(favoriteSports) ? favoriteSports : [])
    .map((item) => Number(item?.sport_id))
    .filter(Number.isFinite));

  if (ids.size === 0) {
    return [];
  }

  return filterItemsByFavoriteLeagues(
    FALLBACK_TOP_MATCHES.filter((item) => ids.has(Number(item.sport_id))),
    favoriteSports,
  );
}

function buildPayload({ source, items, updatedAt }) {
  const top3 = markNewItems(pickTopByTime(items, 3), updatedAt).map(withBetLineup);
  return {
    items: top3,
    source,
    updated_at: toIsoDate(updatedAt),
  };
}

async function invalidateRecommendationsCache(options = {}) {
  const favoriteSportsSets = Array.isArray(options.favoriteSportsSets)
    ? options.favoriteSportsSets
    : [options.favoriteSports || []];
  const keys = [...new Set(favoriteSportsSets.map((item) => buildCacheKey(item)).filter(Boolean))];

  if (keys.includes('recommendations:default')) {
    resetLiveCache();
  }

  const redis = await resolveRedisClient(options.redisClient);
  if (!redis || keys.length === 0 || typeof redis.del !== 'function') {
    return { invalidated_keys: keys, redis: false };
  }

  try {
    await redis.del(...keys);
    return { invalidated_keys: keys, redis: true };
  } catch {
    return { invalidated_keys: keys, redis: false };
  }
}

async function getRecommendations(options = {}) {
  const source = options.source || null;
  const sourceItems = Array.isArray(options.items) ? options.items : [];
  const favoriteSports = Array.isArray(options.favoriteSports) ? options.favoriteSports : [];
  const hasFavoriteSports = favoriteSports.length > 0;
  const enableLive = options.enableLive ?? process.env.NODE_ENV !== 'test';
  const disableCache = options.disableCache === true;
  const nowTs = Date.now();

  if (source) {
    const updatedAt = new Date(nowTs).toISOString();
    if (sourceItems.length > 0) {
      return buildPayload({ source, items: sourceItems, updatedAt });
    }
    return buildPayload({ source: 'fallback-top', items: FALLBACK_TOP_MATCHES, updatedAt });
  }

  const favoriteFallback = filterFallbackByFavoriteSports(favoriteSports);

  // Redis cache check (covers both default and favoriteSports requests)
  const redis = !disableCache && enableLive
    ? await resolveRedisClient(options.redisClient)
    : null;
  const cacheKey = buildCacheKey(favoriteSports);

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis unavailable — continue without cache
    }
  }

  // In-memory cache (secondary layer for non-favorites when Redis is down)
  if (enableLive && !hasFavoriteSports && !disableCache && liveCache.items.length > 0 && (nowTs - liveCache.updatedAt) < LIVE_CACHE_TTL_MS) {
    return buildPayload({ source: 'stavka-live', items: liveCache.items, updatedAt: new Date(liveCache.updatedAt).toISOString() });
  }

  if (enableLive) {
    try {
      const liveItems = await loadLiveRecommendations({
        liveLoader: options.liveLoader,
        matchPageLoader: options.matchPageLoader,
        favoriteSports,
      });

      if (liveItems.length > 0) {
        const liveUpdatedAt = new Date(nowTs).toISOString();
        if (!hasFavoriteSports) {
          liveCache.items = liveItems;
          liveCache.updatedAt = nowTs;
        }
        const result = buildPayload({
          source: hasFavoriteSports ? 'favorites' : 'stavka-live',
          items: liveItems,
          updatedAt: liveUpdatedAt,
        });
        if (redis) {
          try {
            await redis.set(cacheKey, JSON.stringify(result), { EX: REDIS_TTL_SECONDS });
          } catch {
            // Non-fatal — result is returned regardless of cache write failure
          }
        }
        return result;
      }
    } catch {
      // Молча переключаемся на fallback, чтобы UI всегда оставался рабочим.
    }
  }

  const updatedAt = new Date().toISOString();

  if (favoriteFallback.length > 0) {
    return buildPayload({ source: 'favorites', items: favoriteFallback, updatedAt });
  }

  if (hasFavoriteSports) {
    return buildPayload({ source: 'favorites', items: [], updatedAt });
  }

  return buildPayload({ source: 'fallback-top', items: FALLBACK_TOP_MATCHES, updatedAt });
}

module.exports = {
  FALLBACK_TOP_MATCHES,
  getRecommendations,
  invalidateRecommendationsCache,
  loadLiveRecommendations,
};
