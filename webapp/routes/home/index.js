const SSTATS_BASE = 'https://api.sstats.net';
const { resolveLeague, resolveRound, resolveTeamName, resolveTeamCode } = require('../../services/locale');
const { getDailyPicksFeed } = require('../../services/dailyPickReadService');
const { logUserEvent } = require('../../services/eventLogService');

// ── Cache ──────────────────────────────────────────────────
// In-memory cache, shared across ALL users.
// Key = dayType + sorted league IDs → different favorites get separate cache entries.
// Yesterday/tomorrow: 24h (data won't change)
// Today: 15s (live elapsed time / scores must refresh frequently)
const CACHE_TTL = {
  yesterday: 24 * 60 * 60 * 1000,
  today: 15 * 1000,
  tomorrow: 24 * 60 * 60 * 1000,
};
const _cache = new Map(); // key: "dayType:1,2,235", value: { data, expiresAt }

function makeCacheKey(dayType, leagueIds, dateStr) {
  return `${dayType}:${dateStr}:${[...leagueIds].sort((a, b) => a - b).join(',')}`;
}

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, dayType) {
  _cache.set(key, {
    data,
    expiresAt: Date.now() + (CACHE_TTL[dayType] || CACHE_TTL.today),
  });
}

// ── SStats helpers ─────────────────────────────────────────
function moscowOffset() {
  return 3;
}

function getDayRange(dateStr) {
  const tz = `+${String(moscowOffset()).padStart(2, '0')}:00`;
  const from = `${dateStr}T00:00:00${tz}`;
  const to = `${dateStr}T23:59:59${tz}`;
  return { from, to };
}

function getMoscowDate(daysOffset = 0) {
  const now = new Date();
  // Get Moscow time as a formatted string
  const mskStr = now.toLocaleString('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // mskStr = "2026-07-01"
  const [y, m, d] = mskStr.split('-').map(Number);
  const mskDate = new Date(Date.UTC(y, m - 1, d + daysOffset));
  return mskDate.toISOString().slice(0, 10);
}

async function fetchSstatsLeagueMatches(leagueId, from, to, ended) {
  const params = new URLSearchParams({
    leagueid: String(leagueId),
    from,
    to,
    limit: '500',
    TimeZone: String(moscowOffset()),
  });
  if (ended) params.set('ended', 'true');

  const url = `${SSTATS_BASE}/Games/list?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.data || [];
}

function formatMatch(m) {
  return {
    id: m.id,
    home: { name: m.homeTeam?.name, id: m.homeTeam?.id, country: m.homeTeam?.country },
    away: { name: m.awayTeam?.name, id: m.awayTeam?.id, country: m.awayTeam?.country },
    score: {
      home: m.homeResult,
      away: m.awayResult,
    },
    halftime: {
      home: m.homeHTResult,
      away: m.awayHTResult,
    },
    status: m.status,
    statusName: m.statusName,
    elapsed: Number.isFinite(Number(m.elapsed)) ? Number(m.elapsed) : null,
    date: m.date,
    league: resolveLeague(m.season?.league?.name),
    leagueId: m.season?.league?.id,
    season: m.season?.year,
    round: resolveRound(m.roundName),
    isLive: [3, 4, 5, 6, 7, 11, 18, 19].includes(m.status),
    isFinished: [8, 9, 10, 17, 18].includes(m.status),
    isPenalty: m.status === 10,
    odds: (m.odds || []).slice(0, 1),
  };
}

function groupByLeague(matches) {
  const groups = new Map();
  for (const m of matches) {
    const key = m.league || 'Unknown';
    if (!groups.has(key)) {
      groups.set(key, { league: m.league, leagueId: m.leagueId, matches: [] });
    }
    groups.get(key).matches.push(m);
  }
  return [...groups.values()];
}

// ── Fetch + cache per day ──────────────────────────────────
async function fetchDay(dayType, leagueIds, dateStr, ended) {
  const key = makeCacheKey(dayType, leagueIds, dateStr);
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const { from, to } = getDayRange(dateStr);
  const allMatches = [];

  const batches = leagueIds.map((id) =>
    fetchSstatsLeagueMatches(id, from, to, ended).catch(() => []),
  );
  const results = await Promise.all(batches);
  for (const matches of results) {
    allMatches.push(...matches.map(formatMatch));
  }

  const grouped = groupByLeague(allMatches);
  cacheSet(key, grouped, dayType);
  return grouped;
}

const { loadResolvedFavoriteSports } = require('../../services/favoritesStore');

async function loadFavoriteSports(fastify, userId) {
  return loadResolvedFavoriteSports(fastify.pg, userId);
}

// ── Route ──────────────────────────────────────────────────
async function homeRoutes(fastify) {
  fastify.get('/daily-picks', async (request) => {
    const userId = Number(request.user?.userId);
    const favoriteSports = Number.isFinite(userId)
      ? await loadFavoriteSports(fastify, userId)
      : [];

    const payload = await getDailyPicksFeed(fastify.pg, { favoriteSports });
    await logUserEvent(fastify, request, {
      eventName: 'screen.daily_picks_open',
      statusCode: 200,
      entityId: 'daily_picks',
      meta: {
        screen: 'daily_picks',
        today_exists: Boolean(payload?.today),
        tomorrow_exists: Boolean(payload?.tomorrow),
      },
    });

    return payload;
  });

  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    if (!Number.isFinite(userId)) {
      return { yesterday: [], today: [], tomorrow: [] };
    }

    const leagueRows = await fastify.pg.connection(
      'SELECT * FROM public.get_sstats_league_ids($1)',
      [userId],
    );

    if (!leagueRows.length) {
      return { yesterday: [], today: [], tomorrow: [], leagues: [] };
    }

    const leagueIds = leagueRows
      .map((r) => Number(r.sstats_league_id))
      .filter(Number.isFinite);

    const yesterday = getMoscowDate(-1);
    const today = getMoscowDate(0);
    const tomorrow = getMoscowDate(1);

    const [yLeagues, tLeagues, twLeagues] = await Promise.all([
      fetchDay('yesterday', leagueIds, yesterday, true),
      fetchDay('today', leagueIds, today, false),
      fetchDay('tomorrow', leagueIds, tomorrow, false),
    ]);

    // Enrich penalty matches with shootout results
    const allLeagues = [...yLeagues, ...tLeagues, ...twLeagues];
    const penaltyMatchIds = [];
    for (const league of allLeagues) {
      for (const match of league.matches) {
        if (match.isPenalty && !match.penaltyResult) {
          penaltyMatchIds.push(match.id);
        }
      }
    }

    if (penaltyMatchIds.length > 0) {
      const penaltyDetails = await Promise.all(
        penaltyMatchIds.map((id) =>
          fetch(`${SSTATS_BASE}/Games/${id}`)
            .then((r) => r.json())
            .then((d) => {
              const game = d.data?.game;
              const events = d.data?.events || [];
              const homeTeamId = game?.homeTeam?.id;
              let homeScored = 0, awayScored = 0;
              for (const e of events) {
                if (e.name === 'Penalty') {
                  if (e.teamId === homeTeamId) homeScored++;
                  else awayScored++;
                }
              }
              return { id, penaltyResult: { home: homeScored, away: awayScored } };
            })
            .catch(() => null),
        ),
      );

      const penaltyMap = new Map(penaltyDetails.filter(Boolean).map((p) => [p.id, p.penaltyResult]));
      for (const league of allLeagues) {
        for (const match of league.matches) {
          if (penaltyMap.has(match.id)) {
            match.penaltyResult = penaltyMap.get(match.id);
          }
        }
      }
    }

    const response = {
      yesterday: yLeagues,
      today: tLeagues,
      tomorrow: twLeagues,
      leagues: leagueRows.map((r) => ({
        sstats_id: r.sstats_league_id,
        tournament_name: r.tournament_name,
        tournament_name_en: r.tournament_name_en,
        country: r.country_name_en,
      })),
    };

    await logUserEvent(fastify, request, {
      eventName: 'screen.home_open',
      statusCode: 200,
      entityId: 'home',
      meta: {
        screen: 'home',
        leagues_count: response.leagues.length,
      },
    });

    return response;
  });
}

module.exports = homeRoutes;
module.exports.__private = {
  makeCacheKey,
  getDayRange,
  getMoscowDate,
};
