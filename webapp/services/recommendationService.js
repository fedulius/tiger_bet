// Task 3/13 service: recommendations feed for webApp.
// По умолчанию пытаемся взять живые матчи со stavka.tv, при ошибке используем fallback.

const { createClient } = require('redis');

const FALLBACK_TOP_MATCHES = [
  {
    id: 'fallback-3',
    match_id: null,
    match_slug: null,
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
    match_id: null,
    match_slug: null,
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
    match_id: null,
    match_slug: null,
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
    match_id: null,
    match_slug: null,
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

function getRecommendationsCurrentVersionKey(cacheKey) {
  return `${cacheKey}:current_version`;
}

function getRecommendationsMetaKey(cacheKey, version) {
  return `${cacheKey}:meta:${version}`;
}

function getRecommendationsPayloadKey(cacheKey, version) {
  return `${cacheKey}:payload:${version}`;
}

async function readRecommendationsSnapshotByVersion(redis, cacheKey, version) {
  const normalizedVersion = String(version || '').trim();
  if (!redis || !cacheKey || !normalizedVersion) return null;

  try {
    const [metaRaw, payloadRaw] = await Promise.all([
      redis.get(getRecommendationsMetaKey(cacheKey, normalizedVersion)),
      redis.get(getRecommendationsPayloadKey(cacheKey, normalizedVersion)),
    ]);

    if (!metaRaw || !payloadRaw) {
      return null;
    }

    const meta = JSON.parse(metaRaw);
    const payload = JSON.parse(payloadRaw);
    if (!payload || !Array.isArray(payload.items)) {
      return null;
    }

    return {
      ...payload,
      recommendations_version: String(meta.recommendations_version || normalizedVersion),
      updated_at: String(meta.updated_at || payload.updated_at || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

async function publishRecommendationsSnapshot(redis, cacheKey, payload) {
  if (!redis || !cacheKey || !payload || !Array.isArray(payload.items)) {
    return payload;
  }

  const updatedAt = String(payload.updated_at || new Date().toISOString());
  const version = `r${Date.parse(updatedAt) || Date.now()}`;
  const result = {
    ...payload,
    recommendations_version: version,
  };

  await Promise.all([
    redis.set(getRecommendationsMetaKey(cacheKey, version), JSON.stringify({
      recommendations_version: version,
      updated_at: updatedAt,
    }), { EX: REDIS_TTL_SECONDS }),
    redis.set(getRecommendationsPayloadKey(cacheKey, version), JSON.stringify(result), { EX: REDIS_TTL_SECONDS }),
    redis.set(getRecommendationsCurrentVersionKey(cacheKey), version, { EX: REDIS_TTL_SECONDS }),
    redis.set(cacheKey, JSON.stringify(result), { EX: REDIS_TTL_SECONDS }),
  ]);

  return result;
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

function parseStartsAt({ dateText = '', timeText = '', index = 0, baseNow = new Date(), displayTimeZone = 'utc' }) {
  const parsed = new Date(baseNow);

  const yearMatch = String(dateText).match(/(20\d{2})/);
  const dateMatch = String(dateText).toLowerCase().match(/(\d{1,2})\s+([а-яё]{3,})/i);
  const day = dateMatch ? Number(dateMatch[1]) : parsed.getUTCDate();
  const monthShort = dateMatch ? dateMatch[2].slice(0, 3) : null;
  const month = monthShort ? MONTHS_RU[monthShort] : parsed.getUTCMonth();
  const year = yearMatch ? Number(yearMatch[1]) : parsed.getUTCFullYear();

  if (Number.isFinite(day) && Number.isInteger(month) && Number.isFinite(year)) {
    parsed.setUTCFullYear(year, month, day);
  }

  const timeMatch = String(timeText).match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const utcHours = displayTimeZone === 'msk' ? hours - 3 : hours;
    parsed.setUTCHours(utcHours, minutes, 0, 0);
  } else {
    parsed.setTime(parsed.getTime() + index * 30 * 60 * 1000);
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

const SPORT_META_BY_SLUG = {
  soccer: { sport_id: 1, sport_name: 'Футбол' },
  'ice-hockey': { sport_id: 2, sport_name: 'Хоккей' },
  tennis: { sport_id: 3, sport_name: 'Теннис' },
  basketball: { sport_id: 4, sport_name: 'Баскетбол' },
  volleyball: { sport_id: 5, sport_name: 'Волейбол' },
  baseball: { sport_id: 6, sport_name: 'Бейсбол' },
  handball: { sport_id: 7, sport_name: 'Гандбол' },
  futsal: { sport_id: 8, sport_name: 'Футзал' },
  snooker: { sport_id: 9, sport_name: 'Снукер' },
  csgo: { sport_id: 10, sport_name: 'КС:ГО' },
  dota2: { sport_id: 11, sport_name: 'Дота2' },
  'american-football': { sport_id: 12, sport_name: 'Американский футбол' },
  mma: { sport_id: 13, sport_name: 'MMA' },
  boxing: { sport_id: 14, sport_name: 'Бокс' },
};

function normalizeMatchTitle(team = '') {
  return String(team || '')
    .replace(/\s+-\s+/g, ' vs ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSportMetaFromLink(link = '', fallback = {}) {
  const match = String(link || '').match(/\/matches\/([^/?#]+)/i);
  const slug = match ? String(match[1] || '').trim().toLowerCase() : '';
  const inferred = SPORT_META_BY_SLUG[slug] || null;

  return {
    sport_id: Number.isFinite(Number(fallback?.sport_id))
      ? Number(fallback.sport_id)
      : (inferred?.sport_id ?? null),
    sport_name: String(fallback?.sport_name || inferred?.sport_name || '').trim(),
  };
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

// Confidence label from social-proof signals + risk position.
// Special rule: coeff < 1.4 → высокая regardless of social proof or risk_label (implied short odds).
// low-risk bets are always at least средняя; strong signals (count>=30 or percent>=15) give высокая.
// medium: needs count>=20 or percent>=10 to reach средняя.
// high: always ниже средней.
function betConfidenceFromSocialProof(count, percent, risk_label, coeff) {
  const c = Number(count) || 0;
  const p = Number(percent) || 0;
  const coef = Number(coeff);

  if (Number.isFinite(coef) && coef < 1.4) return 'высокая';

  if (risk_label === 'low') {
    if (c >= 30 || p >= 15) return 'высокая';
    return 'средняя';
  }
  if (risk_label === 'medium') {
    if (c >= 50 || p >= 25) return 'высокая';
    if (c >= 20 || p >= 10) return 'средняя';
    return 'ниже средней';
  }
  return 'ниже средней';
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
  const sourceCoeff = Number(item.source_coeff);

  const bet1Coeff = Number.isFinite(sourceCoeff)
    ? toCoeff(clamp(sourceCoeff, 1.5, 1.9), 1.65)
    : toCoeff(1.5 + (confidence % 40) / 100, 1.65);
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

function rankCandidatesForLineup(candidates = []) {
  const zoneRank = (sourceZone) => {
    if (sourceZone === 'mainForecastZone') return 0;
    if (sourceZone === 'editorChoiceZone') return 1;
    if (sourceZone === 'articleZone') return 2;
    return 3;
  };

  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const priorityA = Number(a?.candidate?.sourcePriority) || Number.POSITIVE_INFINITY;
      const priorityB = Number(b?.candidate?.sourcePriority) || Number.POSITIVE_INFINITY;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      const zoneA = zoneRank(a?.candidate?.sourceZone);
      const zoneB = zoneRank(b?.candidate?.sourceZone);
      if (zoneA !== zoneB) {
        return zoneA - zoneB;
      }

      const coeffA = Number.isFinite(Number(a?.candidate?.coeff)) ? Number(a.candidate.coeff) : Number.POSITIVE_INFINITY;
      const coeffB = Number.isFinite(Number(b?.candidate?.coeff)) ? Number(b.candidate.coeff) : Number.POSITIVE_INFINITY;
      if (coeffA !== coeffB) {
        return coeffA - coeffB;
      }

      const forecastA = String(a?.candidate?.canonicalForecast || a?.candidate?.rawForecast || '').trim();
      const forecastB = String(b?.candidate?.canonicalForecast || b?.candidate?.rawForecast || '').trim();
      const forecastCompare = forecastA.localeCompare(forecastB, 'ru');
      if (forecastCompare !== 0) {
        return forecastCompare;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

function buildStructuredBetsFromCandidates(item = {}, candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const orderedCandidates = rankCandidatesForLineup(candidates);
  const confidence = clamp(Number(item.confidence) || 0, 35, 90);
  const primary = orderedCandidates[0];
  const primaryMarketType = String(primary?.marketType || '').trim();
  const secondaryPool = orderedCandidates.slice(1);
  const seenMarketTypes = new Set(primaryMarketType ? [primaryMarketType] : []);
  const selectedSecondaryCandidates = [];

  for (const candidate of secondaryPool) {
    const marketType = String(candidate?.marketType || '').trim();
    if (marketType && !seenMarketTypes.has(marketType)) {
      selectedSecondaryCandidates.push(candidate);
      seenMarketTypes.add(marketType);
    }
    if (selectedSecondaryCandidates.length >= 2) {
      break;
    }
  }

  if (selectedSecondaryCandidates.length < 2) {
    for (const candidate of secondaryPool) {
      if (selectedSecondaryCandidates.includes(candidate)) {
        continue;
      }
      selectedSecondaryCandidates.push(candidate);
      if (selectedSecondaryCandidates.length >= 2) {
        break;
      }
    }
  }

  selectedSecondaryCandidates.sort((a, b) => {
    const zoneRank = (sourceZone) => {
      if (sourceZone === 'editorChoiceZone') return 0;
      if (sourceZone === 'mainForecastZone') return 1;
      if (sourceZone === 'articleZone') return 2;
      return 3;
    };

    const zoneA = zoneRank(a?.sourceZone);
    const zoneB = zoneRank(b?.sourceZone);
    if (zoneA !== zoneB) {
      return zoneA - zoneB;
    }

    const coeffA = Number.isFinite(Number(a?.coeff)) ? Number(a.coeff) : Number.POSITIVE_INFINITY;
    const coeffB = Number.isFinite(Number(b?.coeff)) ? Number(b.coeff) : Number.POSITIVE_INFINITY;
    if (coeffA !== coeffB) {
      return coeffA - coeffB;
    }

    const forecastA = String(a?.canonicalForecast || a?.rawForecast || '').trim();
    const forecastB = String(b?.canonicalForecast || b?.rawForecast || '').trim();
    return forecastA.localeCompare(forecastB, 'ru');
  });

  const primaryCoeff = Number(primary?.coeff);
  const resolvedPrimaryCoeff = Number.isFinite(primaryCoeff)
    ? toCoeff(clamp(primaryCoeff, 1.5, 1.9), 1.65)
    : toCoeff(1.5 + (confidence % 40) / 100, 1.65);

  const primaryBet = {
    type: 'primary',
    risk_order: 1,
    risk_label: 'low',
    forecast: String(primary?.canonicalForecast || primary?.rawForecast || item.main_thought || 'Основной прогноз').trim(),
    coeff: resolvedPrimaryCoeff,
    probability: clamp(Math.round((1 / resolvedPrimaryCoeff) * 100), 45, 70),
    confidence: confidence >= 66 ? 'высокая' : 'средняя',
    description: String(primary?.description || 'Основной сценарий из редакционного прогноза.').trim(),
  };

  const lineup = [primaryBet];
  for (const candidate of selectedSecondaryCandidates.slice(0, 2)) {
    const coeff = Number(candidate?.coeff);
    const resolvedCoeff = Number.isFinite(coeff)
      ? toCoeff(clamp(coeff, 1.6, 2.3), 1.95)
      : toCoeff(1.7 + ((confidence + lineup.length * 7) % 50) / 100, 1.95);

    lineup.push({
      type: lineup.length === 1 ? 'value' : 'additional',
      risk_order: lineup.length + 1,
      risk_label: lineup.length === 1 ? 'medium' : 'high',
      forecast: String(candidate?.canonicalForecast || candidate?.rawForecast || 'Альтернативный сценарий').trim(),
      coeff: resolvedCoeff,
      probability: clamp(Math.round((1 / resolvedCoeff) * 100), 40, 65),
      confidence: confidence >= 60 ? 'средняя' : 'ниже средней',
      description: String(candidate?.description || 'Альтернативный сценарий из редакционного прогноза.').trim(),
    });
  }

  return lineup.slice(0, 3);
}

function withBetLineup(item = {}) {
  return {
    ...item,
    bets: Array.isArray(item.bets) && item.bets.length > 0 ? item.bets : buildBetLineup(item),
  };
}

async function loadRecommendationsFromApi({ apiLoader, popularBetsLoader, riskBetsSelector, favoriteSports, limit, now }) {
  const allMatches = await apiLoader();
  if (!Array.isArray(allMatches) || allMatches.length === 0) return [];

  const baseNow = new Date(now).getTime();
  const sports = Array.isArray(favoriteSports) && favoriteSports.length > 0
    ? favoriteSports
    : [{ sport_id: 1, sport_name: 'Футбол' }];
  const sportIds = new Set(sports.map((s) => Number(s?.sport_id)).filter(Number.isFinite));

  const upcoming = allMatches.filter((m) => {
    if (!m || !m.matchDate || !m.odds || !m.odds.one_x_two) return false;
    const ts = new Date(m.matchDate).getTime();
    if (!Number.isFinite(ts) || ts <= baseNow) return false;
    const sportId = (require('../../lib/stavkaApi').resolveSport(m.sportSlug)).sport_id;
    return sportIds.size === 0 || sportIds.has(sportId);
  });

  upcoming.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
  const topMatches = upcoming.slice(0, limit);
  if (topMatches.length === 0) return [];

  const results = await Promise.allSettled(
    topMatches.map(async (m) => {
      const popularBets = await popularBetsLoader(m.slug);
      const riskBets = riskBetsSelector(popularBets);
      if (riskBets.length === 0) return null;

      const homeName = (m.teams && m.teams.home && m.teams.home.name) || '';
      const awayName = (m.teams && m.teams.away && m.teams.away.name) || '';
      const leagueName = m.league ? (m.league.name || '') : '';
      const countryName = (m.league && m.league.country) ? (m.league.country.name || '') : '';
      const sportInfo = (require('../../lib/stavkaApi').resolveSport(m.sportSlug));

      const bets = riskBets.map((rb) => ({
        type: rb.risk_label === 'low' ? 'primary' : rb.risk_label === 'medium' ? 'value' : 'additional',
        risk_order: rb.risk_order,
        risk_label: rb.risk_label,
        forecast: rb.label,
        coeff: rb.rate,
        probability: Math.round((1 / rb.rate) * 100),
        confidence: betConfidenceFromSocialProof(rb.count, rb.percent, rb.risk_label, rb.rate),
        description: rb.risk_name,
        count: rb.count,
        percent: rb.percent,
        market_type: rb.type,
      }));

      return {
        id: m.id || m.slug,
        match_id: m.id,
        match_slug: m.slug,
        slug: m.slug,
        sport_id: sportInfo.sport_id,
        sport_name: sportInfo.sport_name,
        sportSlug: m.sportSlug,
        match: homeName + ' — ' + awayName,
        league: countryName ? (countryName + ': ' + leagueName) : leagueName,
        starts_at: new Date(m.matchDate).toISOString(),
        main_thought: bets[0] ? bets[0].forecast : 'Прогноз',
        source_coeff: bets[0] ? bets[0].coeff : null,
        confidence: 0,
        bets,
        source_url: 'https://stavka.tv/matches/' + (m.sportSlug || 'soccer') + '/' + m.slug,
      };
    }),
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

async function loadLiveRecommendations({ apiLoader, popularBetsLoader, riskBetsSelector, favoriteSports = [], limit = 6, now = Date.now() } = {}) {
  if (!apiLoader || !popularBetsLoader || !riskBetsSelector) {
    return [];
  }
  return loadRecommendationsFromApi({ apiLoader, popularBetsLoader, riskBetsSelector, favoriteSports, limit, now });
}
async function loadWideFeedRecommendations({ apiLoader, now = Date.now(), horizonMs = 2 * 60 * 60 * 1000 } = {}) {
  if (!apiLoader) {
    return [];
  }
  return loadFeedFromApi({ apiLoader, now, horizonMs });
}
async function loadFeedFromApi({ apiLoader, now, horizonMs }) {
  const allMatches = await apiLoader();
  if (!Array.isArray(allMatches) || allMatches.length === 0) return [];

  const baseNow = new Date(now).getTime();
  const horizon = baseNow + horizonMs;

  // Filter: upcoming, within horizon, has one_x_two odds
  const upcoming = allMatches.filter((m) => {
    if (!m || !m.matchDate || !m.odds || !m.odds.one_x_two) return false;
    const ts = new Date(m.matchDate).getTime();
    return Number.isFinite(ts) && ts > baseNow && ts <= horizon;
  });

  // Sort by matchDate ASC
  upcoming.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));

  // Transform to feed items
  return upcoming.map((m) => {
    const homeName = (m.teams && m.teams.home && m.teams.home.name) || '';
    const awayName = (m.teams && m.teams.away && m.teams.away.name) || '';
    const leagueName = m.league ? (m.league.name || '') : '';
    const countryName = (m.league && m.league.country) ? (m.league.country.name || '') : '';

    // Pick best one_x_two outcome (lowest odds = favorite)
    const odds = m.odds.one_x_two;
    let bestOutcome = 'w2';
    let bestRate = Infinity;
    for (const key of Object.keys(odds)) {
      const val = odds[key];
      if (val && typeof val === 'object' && typeof val.value === 'number' && val.value < bestRate) {
        bestRate = val.value;
        bestOutcome = key;
      }
    }

    const outcomeLabels = { w1: 'Победа хозяев', w2: 'Победа гостей', x: 'Ничья' };

    const sportLabel = (require('../../lib/stavkaApi').resolveSport(m.sportSlug)).sport_name || '';
    const leagueLabel = countryName ? (countryName + ': ' + leagueName) : leagueName;
    const summaryParts = [sportLabel, leagueLabel].filter(Boolean);

    return {
      id: m.id || m.slug,
      slug: m.slug,
      sport_id: (require('../../lib/stavkaApi').resolveSport(m.sportSlug)).sport_id,
      sport_name: (require('../../lib/stavkaApi').resolveSport(m.sportSlug)).sport_name,
      sportSlug: m.sportSlug,
      match: homeName + ' — ' + awayName,
      league: countryName ? (countryName + ': ' + leagueName) : leagueName,
      starts_at: new Date(m.matchDate).toISOString(),
      main_thought: outcomeLabels[bestOutcome] || 'Прогноз',
      summary: summaryParts.join(' · '),
      source_coeff: bestRate,
      confidence: 0,
      source_url: 'https://stavka.tv/matches/' + (m.sportSlug || 'soccer') + '/' + m.slug,
    };
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
    const currentVersionKeys = keys.map(getRecommendationsCurrentVersionKey);
    await redis.del(...keys, ...currentVersionKeys);
    return { invalidated_keys: [...keys, ...currentVersionKeys], redis: true };
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
  const requestedVersion = String(options.recommendationsVersion || '').trim();
  const cacheKey = buildCacheKey(favoriteSports);

  if (source) {
    const updatedAt = new Date(nowTs).toISOString();
    return buildPayload({ source, items: sourceItems, updatedAt });
  }

  const redis = !disableCache
    ? await resolveRedisClient(options.redisClient)
    : null;

  if (requestedVersion && redis) {
    const exactSnapshot = await readRecommendationsSnapshotByVersion(redis, cacheKey, requestedVersion);
    if (exactSnapshot) {
      return exactSnapshot;
    }

    let currentVersion = '';
    try {
      currentVersion = String(await redis.get(getRecommendationsCurrentVersionKey(cacheKey)) || '').trim();
    } catch {
      currentVersion = '';
    }

    return {
      stale_version: true,
      recommendations_version: requestedVersion,
      current_recommendations_version: currentVersion,
    };
  }

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

  if (enableLive && !hasFavoriteSports && !disableCache && liveCache.items.length > 0 && (nowTs - liveCache.updatedAt) < LIVE_CACHE_TTL_MS) {
    return buildPayload({ source: 'stavka-live', items: liveCache.items, updatedAt: new Date(liveCache.updatedAt).toISOString() });
  }

  if (enableLive) {
    try {
      const liveItems = await loadLiveRecommendations({
        liveLoader: options.liveLoader,
        matchPageLoader: options.matchPageLoader,
        apiLoader: options.apiLoader,
        popularBetsLoader: options.popularBetsLoader,
        riskBetsSelector: options.riskBetsSelector,
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
            return await publishRecommendationsSnapshot(redis, cacheKey, result);
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

  if (hasFavoriteSports) {
    const result = buildPayload({ source: 'favorites', items: [], updatedAt });
    if (redis) {
      try {
        return await publishRecommendationsSnapshot(redis, cacheKey, result);
      } catch {
        return result;
      }
    }
    return result;
  }

  const result = buildPayload({ source: 'fallback-top', items: [], updatedAt });
  if (redis) {
    try {
      return await publishRecommendationsSnapshot(redis, cacheKey, result);
    } catch {
      return result;
    }
  }
  return result;
}

module.exports = {
  FALLBACK_TOP_MATCHES,
  betConfidenceFromSocialProof,
  getRecommendations,
  invalidateRecommendationsCache,
  loadLiveRecommendations,
  loadWideFeedRecommendations,
};
