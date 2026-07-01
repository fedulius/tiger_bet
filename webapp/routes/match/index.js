const SSTATS_BASE = 'https://api.sstats.net';
const { resolveLeague, resolveRound, resolveTeamName, resolveTeamCode } = require('../../services/locale');

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

async function fetchSstatsMatch(gameId) {
  const url = `${SSTATS_BASE}/Games/${gameId}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const json = await resp.json();
  const full = json.data || null;
  if (!full) return null;
  return {
    game: full.game || null,
    statistics: full.statistics || {},
    events: full.events || [],
  };
}

const MOCK_MATCHES = {
  'fallback-1': {
    id: 'fallback-1', match: 'Arsenal vs Chelsea', league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z', main_thought: 'Обе забьют',
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
        status: match.status,
        statusName: match.statusName,
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
