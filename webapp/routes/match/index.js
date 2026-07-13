const SSTATS_BASE = 'https://api.sstats.net';
const { resolveLeague, resolveRound, resolveTeamName, resolveTeamCode } = require('../../services/locale');
const { logUserEvent } = require('../../services/eventLogService');

// ── Cache ──────────────────────────────────────────────────
// Shared across all users. Live=60s, finished=24h.
const MATCH_CACHE_TTL = {
  live: 60 * 1000,
  finished: 24 * 60 * 60 * 1000,
  upcoming: 5 * 60 * 1000,
};
const _matchCache = new Map(); // key: matchId, value: { data, expiresAt }

function matchCacheGet(id) {
  const entry = _matchCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _matchCache.delete(id);
    return null;
  }
  return entry.data;
}

function matchCacheSet(id, data, ttl) {
  _matchCache.set(id, { data, expiresAt: Date.now() + ttl });
}

function moscowOffset() {
  return 3;
}

function isLive(status) {
  return [3, 4, 5, 6, 7, 11, 18, 19].includes(status);
}

function isFinished(status) {
  return [8, 9, 10, 17, 18].includes(status);
}

async function fetchSstatsMatch(gameId, retries = 2) {
  const url = `${SSTATS_BASE}/Games/${gameId}`;
  const resp = await fetchWithRetry(url, retries);
  if (!resp || !resp.ok) return null;
  const json = await resp.json();
  const full = json.data || null;
  if (!full) return null;
  return {
    game: full.game || null,
    statistics: full.statistics || {},
    events: full.events || [],
  };
}

// ── Analytics fetchers ──────────────────────────────────────
async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url);
    if (resp.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    return resp;
  }
  return null;
}

async function fetchH2H(homeTeamId, awayTeamId) {
  if (!homeTeamId || !awayTeamId) return [];
  try {
    // bothTeams searches across ALL leagues (cross-competition H2H)
    const from = '2010-01-01T00:00:00+03:00';
    const to = new Date().toISOString().slice(0, 10) + 'T23:59:59+03:00';
    const params = new URLSearchParams({
      ended: 'true',
      bothTeams: `${homeTeamId},${awayTeamId}`,
      from,
      to,
      limit: '1000',
      TimeZone: '3',
    });
    const url = `${SSTATS_BASE}/Games/list?${params.toString()}`;
    const resp = await fetchWithRetry(url);
    if (!resp || !resp.ok) return [];
    const json = await resp.json();
    const games = json.data || [];
    // Map, sort newest first, take 5
    const mapped = games.map((g) => ({
      id: g.id,
      date: g.date,
      homeTeam: resolveTeamName(g.homeTeam?.name || ''),
      awayTeam: resolveTeamName(g.awayTeam?.name || ''),
      homeResult: g.homeResult,
      awayResult: g.awayResult,
    }));
    mapped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return mapped.slice(0, 5);
  } catch {
    return [];
  }
}

async function fetchForm(gameId, homeTeamId, awayTeamId, leagueId) {
  try {
    const url = `${SSTATS_BASE}/Games/last-games-stats?gameId=${gameId}`;
    const resp = await fetchWithRetry(url);
    if (!resp || !resp.ok) return null;
    const json = await resp.json();
    const data = json;
    if (!data || !data.home) return null;
    const mapTeam = (t) => ({
      gamesCount: t.gamesCount || 0,
      wins: t.wins || 0,
      draws: t.draws || 0,
      losses: t.loses || 0,
      avgScore: t.avgScore != null ? Math.round(t.avgScore * 10) / 10 : null,
      avgConceded: t.avgConceded != null ? Math.round(t.avgConceded * 10) / 10 : null,
      avgShots: t.avgShots != null ? Math.round(t.avgShots * 10) / 10 : null,
      avgCards: t.avgCards != null ? Math.round(t.avgCards * 10) / 10 : null,
      avgCorners: t.avgCorners != null ? Math.round(t.avgCorners * 10) / 10 : null,
    });

    // Fetch last 5 individual match results per team
    // SStats API does NOT support teamId filtering — fetch by league + date range and filter client-side
    const fetchLast5 = async (teamId) => {
      if (!teamId) return [];
      try {
        // Fetch recent finished games from the same league (last 6 months)
        const now = new Date();
        const from = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const to = now.toISOString().slice(0, 10);
        const params = new URLSearchParams({
          ended: 'true',
          from: `${from}T00:00:00+03:00`,
          to: `${to}T23:59:59+03:00`,
          limit: '500',
          TimeZone: '3',
        });
        if (leagueId) params.set('leagueid', String(leagueId));
        const r = await fetchWithRetry(`${SSTATS_BASE}/Games/list?${params.toString()}`);
        if (!r || !r.ok) return [];
        const j = await r.json();
        // Filter to games where this team actually played
        const teamGames = (j.data || []).filter((gg) =>
          gg.id !== gameId &&
          (gg.homeTeam?.id === teamId || gg.awayTeam?.id === teamId)
        );
        // Sort by date descending (most recent first), take 5
        teamGames.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return teamGames.slice(0, 5).map((gg) => {
          const isHome = gg.homeTeam?.id === teamId;
          const goalsFor = isHome ? gg.homeResult : gg.awayResult;
          const goalsAgainst = isHome ? gg.awayResult : gg.homeResult;
          return {
            result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
            score: `${goalsFor}:${goalsAgainst}`,
            opponent: resolveTeamName(isHome ? (gg.awayTeam?.name || '') : (gg.homeTeam?.name || '')),
            date: gg.date || '',
          };
        });
      } catch {
        return [];
      }
    };

    const [homeRecent, awayRecent] = await Promise.all([
      fetchLast5(homeTeamId),
      fetchLast5(awayTeamId),
    ]);

    const home = mapTeam(data.home);
    const away = mapTeam(data.away);
    // Override aggregate stats with last-5 stats
    const applyRecentStats = (team, recent) => {
      if (recent.length === 0) return;
      team.recent = recent;
      team.gamesCount = recent.length;
      team.wins = recent.filter((m) => m.result === 'W').length;
      team.draws = recent.filter((m) => m.result === 'D').length;
      team.losses = recent.filter((m) => m.result === 'L').length;
      const goalsFor = recent.reduce((s, m) => s + parseInt(m.score.split(':')[0]) || 0, 0);
      const goalsAgainst = recent.reduce((s, m) => s + parseInt(m.score.split(':')[1]) || 0, 0);
      team.avgScore = recent.length ? Math.round(goalsFor / recent.length * 10) / 10 : null;
      team.avgConceded = recent.length ? Math.round(goalsAgainst / recent.length * 10) / 10 : null;
    };
    applyRecentStats(home, homeRecent);
    applyRecentStats(away, awayRecent);
    return { home, away };
  } catch {
    return null;
  }
}

const INJURY_LOCALE = {
  'Muscle bruise': 'Ушиб мышцы',
  'Knee injury': 'Травма колена',
  'Ankle injury': 'Травма лодыжки',
  'Hamstring strain': 'Растяжение задней поверхности бедра',
  'Thigh injury': 'Травма бедра',
  'Groin injury': 'Травма паха',
  'Calf injury': 'Травма икроножной мышцы',
  'Foot injury': 'Травма стопы',
  'Back injury': 'Травма спины',
  'Shoulder injury': 'Травма плеча',
  'Concussion': 'Сотрясение мозга',
  'Fracture': 'Перелом',
  'Sprain': 'Вывих/растяжение',
  'Strain': 'Растяжение',
  'Bruised ribs': 'Ушиб рёбер',
  'Muscle injury': 'Травма мышцы',
  'Leg injury': 'Травма ноги',
  'Cruciate ligament': 'Повреждение крестообразной связки',
  'ACL injury': 'Повреждение ACL',
  'Suspended': 'Дисквалификация',
  'Yellow cards': 'Жёлтые карточки',
};

async function fetchInjuries(gameId) {
  try {
    const url = `${SSTATS_BASE}/Games/injuries?gameId=${gameId}`;
    const resp = await fetchWithRetry(url);
    if (!resp || !resp.ok) return [];
    const json = await resp.json();
    const items = json.data || [];
    return items.map((item) => ({
      playerName: item.player?.name || '',
      teamId: item.teamId,
      reason: INJURY_LOCALE[item.reason] || item.reason || '',
    }));
  } catch {
    return [];
  }
}

async function fetchGlicko(gameId) {
  try {
    const url = `${SSTATS_BASE}/Games/glicko/${gameId}`;
    const resp = await fetchWithRetry(url);
    if (!resp || !resp.ok) return null;
    const json = await resp.json();
    const g = json.data?.glicko;
    if (!g || (g.homeWinProbability == null && g.awayWinProbability == null)) return null;
    return {
      homeRating: g.homeRating,
      awayRating: g.awayRating,
      homeWinProbability: g.homeWinProbability,
      awayWinProbability: g.awayWinProbability,
      drawProbability: g.drawProbability ?? (g.homeWinProbability != null && g.awayWinProbability != null
        ? Math.max(0, 1 - g.homeWinProbability - g.awayWinProbability)
        : null),
    };
  } catch {
    return null;
  }
}

const MOCK_MATCHES = {
  'fallback-1': {
    id: 'fallback-1', match: 'Arsenal vs Chelsea', league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z',
    main_thought: 'Обе забьют, но Arsenal выглядит сильнее',
    confidence: 68,
    basis: 'Последние 5 матчей, xG-тренд и преимущество домашнего поля Arsenal.',
    source_url: 'https://www.premierleague.com/match/arsenal-chelsea',
    bets: [
      { forecast: 'Обе забьют', coeff: 1.72, probability: 58, confidence: 'средняя', description: '' },
      { forecast: 'Победа Arsenal', coeff: 2.05, probability: 49, confidence: 'средняя', description: '' },
      { forecast: 'Точный счет 2:1', coeff: 7.2, probability: 14, confidence: 'высокий риск', description: '' },
    ],
  },
};

function getMockDetails(id) {
  return MOCK_MATCHES[id] || null;
}

async function matchRoutes(fastify) {
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    if (/^\d+$/.test(String(id))) {
      // Check cache first
      const cached = matchCacheGet(id);
      if (cached) return cached;

      const result = await fetchSstatsMatch(id).catch(() => null);
      if (!result || !result.game) {
        return reply.status(404).send({ error: 'Match not found' });
      }

      const match = result.game;
      const homeName = match.homeTeam?.name || 'Home';
      const awayName = match.awayTeam?.name || 'Away';
      const homeCode = resolveTeamCode(homeName, match.homeTeam?.country?.code);
      const awayCode = resolveTeamCode(awayName, match.awayTeam?.country?.code);

      const rawStats = result.statistics;
      const stats = {
        possession: { home: rawStats.ballPossessionHome, away: rawStats.ballPossessionAway },
        shots: { home: rawStats.totalShotsHome, away: rawStats.totalShotsAway },
        shotsOnTarget: { home: rawStats.shotsOnGoalHome, away: rawStats.shotsOnGoalAway },
        corners: { home: rawStats.cornerKicksHome, away: rawStats.cornerKicksAway },
        fouls: { home: rawStats.foulsHome, away: rawStats.foulsAway },
        offsides: { home: rawStats.offsidesHome, away: rawStats.offsidesAway },
        xg: { home: rawStats.expectedGoalsHome, away: rawStats.expectedGoalsAway },
        passes: { home: rawStats.totalPassesHome, away: rawStats.totalPassesAway },
        passesAccurate: { home: rawStats.passesAccurateHome, away: rawStats.passesAccurateAway },
        yellowCards: { home: rawStats.yellowCardsHome, away: rawStats.yellowCardsAway },
        redCards: { home: rawStats.redCardsHome, away: rawStats.redCardsAway },
        goalkeeperSaves: { home: rawStats.goalkeeperSavesHome, away: rawStats.goalkeeperSavesAway },
        bigChances: { home: rawStats.bigChancesHome, away: rawStats.bigChancesAway },
      };

      const rawEvents = result.events;
      const events = rawEvents.map((e) => ({
        id: e.id,
        minute: e.elapsed,
        extra: e.extra,
        type: e.type,
        name: e.name,
        player: e.player?.name || null,
        teamId: e.teamId,
      }));

      // Count penalties for shootout result
      const penalties = events.filter((e) => e.name === 'Penalty' || e.name === 'Missed Penalty');
      let penaltyResult = null;
      if (penalties.length > 0) {
        const homeTeamId = match.homeTeam?.id;
        let homeScored = 0, awayScored = 0;
        for (const p of penalties) {
          if (p.name === 'Penalty') {
            if (p.teamId === homeTeamId) homeScored++;
            else awayScored++;
          }
        }
        penaltyResult = { home: homeScored, away: awayScored };
      }

      const response = {
        id: match.id,
        match: `${resolveTeamName(homeName)} — ${resolveTeamName(awayName)}`,
        league: resolveLeague(match.season?.league?.name || ''),
        starts_at: match.date,
        score: (isFinished(match.status) || isLive(match.status))
          ? `${match.homeResult ?? '?'} : ${match.awayResult ?? '?'}` : null,
        team1_code: homeCode === 'WW' ? 'US' : homeCode,
        team2_code: awayCode === 'WW' ? 'US' : awayCode,
        team1_name_ru: resolveTeamName(homeName),
        team2_name_ru: resolveTeamName(awayName),
        homeTeamId: match.homeTeam?.id,
        awayTeamId: match.awayTeam?.id,
        status: match.status,
        statusName: match.statusName,
        elapsed: Number.isFinite(Number(match.elapsed)) ? Number(match.elapsed) : null,
        round: resolveRound(match.roundName),
        isLive: isLive(match.status),
        isFinished: isFinished(match.status),
        halftime: isFinished(match.status) || isLive(match.status)
          ? `${match.homeHTResult ?? '?'} : ${match.awayHTResult ?? '?'}`
          : null,
        stats,
        events,
        penaltyResult,
        source: 'sstats',
      };

      // Fetch analytics data in parallel
      const [h2h, form, injuries, glicko] = await Promise.all([
        fetchH2H(match.homeTeam?.id, match.awayTeam?.id),
        fetchForm(match.id, match.homeTeam?.id, match.awayTeam?.id, match.season?.league?.id),
        fetchInjuries(match.id),
        fetchGlicko(match.id),
      ]);

      if (h2h.length > 0) response.h2h = h2h;
      if (form) response.form = form;
      if (injuries.length > 0) response.injuries = injuries;
      if (glicko) response.glicko = glicko;

      response.hasAnalytics = !!(h2h.length > 0 || form || injuries.length > 0 || glicko);

      await logUserEvent(fastify, request, {
        eventName: 'match.open',
        statusCode: 200,
        entityId: String(match.id),
        meta: {
          match_id: match.id,
          sport_name: response.league ? 'Футбол' : '',
          league_name: response.league || '',
          is_live: response.isLive,
        },
      });

      // Cache with appropriate TTL
      const ttl = isLive(match.status)
        ? MATCH_CACHE_TTL.live
        : isFinished(match.status)
          ? MATCH_CACHE_TTL.finished
          : MATCH_CACHE_TTL.upcoming;
      matchCacheSet(id, response, ttl);

      return response;
    }

    const details = getMockDetails(id);
    if (details) return details;

    return reply.status(404).send({ error: 'Match not found' });
  });
}

module.exports = matchRoutes;
