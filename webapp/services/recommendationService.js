// Task 3/13 service: recommendations feed for webApp.
// По умолчанию пытаемся взять живые матчи со stavka.tv, при ошибке используем fallback.

const { getLeaguesByCategory } = require('../../lib/stavkaMatches');
const request = require('request');
const { extractEditorialForecast } = require('../../lib/forecastAnalyzer');

const FALLBACK_TOP_MATCHES = [
  {
    id: 'fallback-3',
    match: 'Fnatic vs G2',
    league: 'ESL Pro League',
    starts_at: '2026-04-22T20:00:00.000Z',
    main_thought: 'Победа G2 по текущей форме',
    confidence: 70,
    source_url: 'https://stavka.tv/matches/csgo',
  },
  {
    id: 'fallback-1',
    match: 'Arsenal vs Chelsea',
    league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z',
    main_thought: 'Обе забьют, но Arsenal выглядит сильнее',
    confidence: 68,
    source_url: 'https://stavka.tv/matches/soccer',
  },
  {
    id: 'fallback-4',
    match: 'NAVI vs Spirit',
    league: 'BLAST Premier',
    starts_at: '2026-04-22T22:15:00.000Z',
    main_thought: 'NAVI через плотный матч',
    confidence: 64,
    source_url: 'https://stavka.tv/matches/csgo',
  },
  {
    id: 'fallback-2',
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

function toIsoDate(value) {
  return new Date(value).toISOString();
}

function pickTopByTime(items, limit = 3) {
  return [...items]
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, limit);
}

function markNewItems(items, nowIso) {
  const nowTs = new Date(nowIso).getTime();

  return items.map((item) => {
    const startTs = new Date(item.starts_at).getTime();
    const diffMinutes = Math.abs(startTs - nowTs) / (1000 * 60);

    return {
      ...item,
      // В MVP считаем «новыми» ближайшие события в окне 120 минут.
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

function flattenLiveLeagues(leagues = [], baseNow = new Date()) {
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

async function enrichFromMatchPages(items, { matchPageLoader } = {}) {
  const loader = matchPageLoader || requestMatchPage;

  const enriched = await Promise.all(items.map(async (item) => {
    try {
      const html = await loader(item.source_url);
      const editorial = extractEditorialForecast(html, { matchName: item.match });

      if (!editorial || !editorial.mainThought) {
        return item;
      }

      return {
        ...item,
        main_thought: editorial.mainThought,
        confidence: Number.isFinite(editorial.probabilityPercent)
          ? editorial.probabilityPercent
          : item.confidence,
      };
    } catch {
      return item;
    }
  }));

  return enriched;
}

async function loadLiveRecommendations({ liveLoader, matchPageLoader, categoryId } = {}) {
  const loader = liveLoader || (async () => getLeaguesByCategory(categoryId || 1));
  const leagues = await loader();

  if (!Array.isArray(leagues) || leagues.length === 0) {
    return [];
  }

  const rawItems = flattenLiveLeagues(leagues, new Date());
  if (rawItems.length === 0) {
    return [];
  }

  return await enrichFromMatchPages(rawItems.slice(0, 3), { matchPageLoader });
}

function buildPayload({ source, items, updatedAt }) {
  const top3 = markNewItems(pickTopByTime(items, 3), updatedAt);
  return {
    items: top3,
    source,
    updated_at: toIsoDate(updatedAt),
  };
}

async function getRecommendations(options = {}) {
  const updatedAt = new Date().toISOString();
  const source = options.source || null;
  const sourceItems = Array.isArray(options.items) ? options.items : [];

  if (source) {
    if (sourceItems.length > 0) {
      return buildPayload({ source, items: sourceItems, updatedAt });
    }

    return buildPayload({ source: 'fallback-top', items: FALLBACK_TOP_MATCHES, updatedAt });
  }

  const enableLive = options.enableLive ?? process.env.NODE_ENV !== 'test';
  const disableCache = options.disableCache === true;
  const nowTs = Date.now();

  if (enableLive && !disableCache && liveCache.items.length > 0 && (nowTs - liveCache.updatedAt) < LIVE_CACHE_TTL_MS) {
    return buildPayload({ source: 'stavka-live', items: liveCache.items, updatedAt });
  }

  if (enableLive) {
    try {
      const liveItems = await loadLiveRecommendations({
        liveLoader: options.liveLoader,
        matchPageLoader: options.matchPageLoader,
        categoryId: options.categoryId,
      });

      if (liveItems.length > 0) {
        liveCache.items = liveItems;
        liveCache.updatedAt = nowTs;
        return buildPayload({ source: 'stavka-live', items: liveItems, updatedAt });
      }
    } catch {
      // Молча переключаемся на fallback, чтобы UI всегда оставался рабочим.
    }
  }

  return buildPayload({ source: 'fallback-top', items: FALLBACK_TOP_MATCHES, updatedAt });
}

module.exports = {
  getRecommendations,
};
