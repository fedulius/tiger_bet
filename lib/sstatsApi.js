'use strict';

// SStats API client (api.sstats.net)
// Free with API key: https://sstats.net/login → profile
// Docs: https://sstats.net/api-docs/index.html

const API_BASE = 'https://api.sstats.net';
const REQUEST_TIMEOUT_MS = 10000;
const RATE_LIMIT_MS = 500;

let _lastRequestAt = 0;

function getApiKey() {
  return String(process.env.SSTATS_API_KEY || '').trim();
}

function hasApiKey() {
  return getApiKey().length > 0;
}

async function apiGet(path, params = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  _lastRequestAt = Date.now();

  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data || data;
  } catch {
    return null;
  }
}

// ── Find game by teams and date ────────────────────────────
async function findGameByTeams(homeTeamName, awayTeamName, date) {
  const params = { limit: 500, TimeZone: '3' };
  if (date) {
    params.from = `${date}T00:00:00+03:00`;
    params.to = `${date}T23:59:59+03:00`;
  }

  const list = await apiGet('/Games/list', params);
  if (!list?.length) return null;

  // Try exact match first
  for (const g of list) {
    const home = (g.homeTeam?.name || '').toLowerCase();
    const away = (g.awayTeam?.name || '').toLowerCase();
    const searchHome = homeTeamName.toLowerCase();
    const searchAway = awayTeamName.toLowerCase();

    if ((home === searchHome || home.includes(searchHome) || searchHome.includes(home)) &&
        (away === searchAway || away.includes(searchAway) || searchAway.includes(away))) {
      return g;
    }
  }

  // If date-filtered search failed, try without date filter (recent games)
  if (date && !list.find(g => {
    const h = (g.homeTeam?.name || '').toLowerCase();
    const a = (g.awayTeam?.name || '').toLowerCase();
    return h.includes(homeTeamName.toLowerCase()) && a.includes(awayTeamName.toLowerCase());
  })) {
    // Try broader search - last 7 days
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = weekAgo.toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const broaderList = await apiGet('/Games/list', {
      from: `${from}T00:00:00+03:00`,
      to: `${to}T23:59:59+03:00`,
      limit: '500',
      TimeZone: '3',
    });
    if (broaderList?.length) {
      for (const g of broaderList) {
        const home = (g.homeTeam?.name || '').toLowerCase();
        const away = (g.awayTeam?.name || '').toLowerCase();
        if (home.includes(homeTeamName.toLowerCase()) && away.includes(awayTeamName.toLowerCase())) {
          return g;
        }
      }
    }
  }

  return null;
}

// ── Find game by ID ────────────────────────────────────────
async function getGame(gameId) {
  return apiGet('/Games/' + gameId);
}

// ── Get lineups ────────────────────────────────────────────
function getLineups(gameData) {
  const players = gameData?.lineupPlayers || [];
  const homeTeamId = gameData?.game?.homeTeam?.id;
  const awayTeamId = gameData?.game?.awayTeam?.id;

  const formatPlayer = (p) => ({
    id: p.playerId,
    name: p.playerName,
    number: p.number,
    position: p.position,
    startXI: p.startXI,
  });

  return {
    home_formation: null, // Not in old API, can be derived from grid
    away_formation: null,
    home_xi: players.filter(p => p.teamId === homeTeamId && p.startXI).map(formatPlayer),
    away_xi: players.filter(p => p.teamId === awayTeamId && p.startXI).map(formatPlayer),
    home_substitutes: players.filter(p => p.teamId === homeTeamId && !p.startXI).map(formatPlayer),
    away_substitutes: players.filter(p => p.teamId === awayTeamId && !p.startXI).map(formatPlayer),
  };
}

// ── Get events ─────────────────────────────────────────────
function getEvents(gameData) {
  const events = gameData?.events || [];
  return events.map(e => ({
    type: e.type, // 1=goal, 2=yellow, 3=substitution, 4=red, etc.
    type_name: e.name,
    minute: e.elapsed,
    extra: e.extra,
    player: e.player?.name || '',
    assist: e.assistPlayer?.name || '',
    team_id: e.teamId,
  }));
}

// ── Get statistics ─────────────────────────────────────────
function getStatistics(gameData) {
  const s = gameData?.statistics;
  if (!s) return null;

  return {
    shots_on: { home: s.shotsOnGoalHome, away: s.shotsOnGoalAway },
    shots_off: { home: s.shotsOffGoalHome, away: s.shotsOffGoalAway },
    total_shots: { home: s.totalShotsHome, away: s.totalShotsAway },
    possession: { home: s.ballPossessionHome, away: s.ballPossessionAway },
    corners: { home: s.cornerKicksHome, away: s.cornerKicksAway },
    fouls: { home: s.foulsHome, away: s.foulsAway },
    yellow_cards: { home: s.yellowCardsHome, away: s.yellowCardsAway },
    goalkeeper_saves: { home: s.goalkeeperSavesHome, away: s.goalkeeperSavesAway },
    passes: { home: s.totalPassesHome, away: s.totalPassesAway },
    passes_accurate: { home: s.totalPassesAccurateHome, away: s.totalPassesAccurateAway },
  };
}

// ── Get recent form for a team ─────────────────────────────
async function getTeamForm(teamId, leagueId, count = 5) {
  const from = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const params = {
    from: `${from}T00:00:00+03:00`,
    to: `${to}T23:59:59+03:00`,
    limit: '500',
    TimeZone: '3',
    ended: 'true',
  };
  if (leagueId) params.LeagueId = leagueId;

  const list = await apiGet('/Games/list', params);
  if (!list?.length) return [];

  const teamGames = list.filter(g =>
    (g.homeTeam?.id === teamId || g.awayTeam?.id === teamId) && g.status === 8
  );

  teamGames.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return teamGames.slice(0, count).map(g => {
    const isHome = g.homeTeam?.id === teamId;
    const goalsFor = isHome ? g.homeResult : g.awayResult;
    const goalsAgainst = isHome ? g.awayResult : g.homeResult;
    return {
      date: g.date?.substring(0, 10),
      opponent: isHome ? g.awayTeam?.name : g.homeTeam?.name,
      score: `${goalsFor}:${goalsAgainst}`,
      result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
      league: g.season?.league?.name || '',
    };
  });
}

// ── Get last-games-stats (xG, shots, cards, etc.) ──────────
async function getLastGamesStats(gameId) {
  return apiGet('/Games/last-games-stats', { gameId });
}

// ── Build comprehensive match payload ──────────────────────
async function buildMatchPayload(gameId) {
  const gameData = await getGame(gameId);
  if (!gameData?.game) return null;

  const game = gameData.game;
  const homeTeamId = game.homeTeam?.id;
  const awayTeamId = game.awayTeam?.id;
  const leagueId = game.season?.league?.id;

  // Parallel fetch
  const [homeForm, awayForm, lastStats] = await Promise.all([
    homeTeamId ? getTeamForm(homeTeamId, leagueId, 5) : null,
    awayTeamId ? getTeamForm(awayTeamId, leagueId, 5) : null,
    getLastGamesStats(gameId),
  ]);

  return {
    fixture_id: gameId,
    date: game.date,
    league: game.season?.league?.name || '',
    league_id: leagueId,
    season: game.season?.year,
    home: { id: homeTeamId, name: game.homeTeam?.name || '' },
    away: { id: awayTeamId, name: game.awayTeam?.name || '' },
    score: { home: game.homeResult, away: game.awayResult },
    status: game.statusName,
    round: game.roundName,
    referee: gameData.refereeName,
    lineups: getLineups(gameData),
    events: getEvents(gameData),
    statistics: getStatistics(gameData),
    recent_form: { home: homeForm, away: awayForm },
    last_games_stats: lastStats,
    odds: game.odds || [],
  };
}

module.exports = {
  hasApiKey,
  findGameByTeams,
  getGame,
  getLineups,
  getEvents,
  getStatistics,
  getTeamForm,
  getLastGamesStats,
  buildMatchPayload,
};
