'use strict';

// API-Football v3 client
// Docs: https://www.api-football.com/documentation-v3
// Free tier: 100 requests/day, seasons 2022-2024
// Paid tier: all seasons including current

const API_BASE = 'https://v3.football.api-sports.io';
const REQUEST_TIMEOUT_MS = 10000;
const RATE_LIMIT_MS = 3000; // 10 req/min on free tier

let _lastRequestAt = 0;

async function rateLimitWait() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  _lastRequestAt = Date.now();
}

function getApiKey() {
  return String(process.env.API_FOOTBALL_KEY || '').trim();
}

function hasApiKey() {
  return getApiKey().length > 0;
}

// Season config: change DEFAULT_SEASON when subscription is purchased
// Free tier: 2024 (latest available)
// Paid tier: 2025 or current
const DEFAULT_SEASON = parseInt(process.env.API_FOOTBALL_SEASON || '2024', 10);

async function apiGet(path, params = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  await rateLimitWait();

  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'x-apisports-key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (resp.status === 429) {
      // Rate limited — wait and retry once
      await new Promise(r => setTimeout(r, 5000));
      const retry = await fetch(url.toString(), {
        headers: { 'x-apisports-key': apiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!retry.ok) return null;
      const retryData = await retry.json();
      return retryData?.response || null;
    }

    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.response || null;
  } catch {
    return null;
  }
}

// ── Fixtures by date + league ──────────────────────────────
async function fetchFixturesByDate(date, leagueId, season) {
  return apiGet('/fixtures', { from: date, to: date, league: leagueId, season: season || DEFAULT_SEASON }) || [];
}

// ── Fixtures by team (last N) ──────────────────────────────
async function fetchTeamLastFixtures(teamId, last = 5, season) {
  return apiGet('/fixtures', { team: teamId, last, season: season || DEFAULT_SEASON }) || [];
}

// ── Fixtures by team (next N) ──────────────────────────────
async function fetchTeamNextFixtures(teamId, next = 5, season) {
  return apiGet('/fixtures', { team: teamId, next, season: season || DEFAULT_SEASON }) || [];
}

// ── Match statistics ───────────────────────────────────────
async function fetchFixtureStatistics(fixtureId) {
  const data = await apiGet('/fixtures/statistics', { fixture: fixtureId });
  if (!data || !Array.isArray(data)) return null;
  const result = {};
  for (const entry of data) {
    const team = entry.team?.name || 'unknown';
    for (const stat of entry.statistics || []) {
      const key = stat.type?.toLowerCase().replace(/\s+/g, '_') || '';
      if (!key) continue;
      if (!result[key]) result[key] = {};
      result[key][team] = stat.value;
    }
  }
  return result;
}

// ── Lineups ────────────────────────────────────────────────
async function fetchFixtureLineups(fixtureId) {
  const data = await apiGet('/fixtures/lineups', { fixture: fixtureId });
  if (!data || !Array.isArray(data)) return null;
  return data.map((entry) => ({
    team: entry.team?.name || '',
    formation: entry.formation || '',
    startXI: (entry.startXI || []).map((p) => ({
      player: p.player?.name || '',
      number: p.player?.number || null,
      pos: p.player?.pos || '',
    })),
    substitutes: (entry.substitutes || []).map((p) => ({
      player: p.player?.name || '',
      number: p.player?.number || null,
      pos: p.player?.pos || '',
    })),
    injuries: (entry.injuries || []).map((p) => ({
      player: p.player?.name || '',
      reason: p.player?.reason || '',
    })),
  }));
}

// ── Head to head ───────────────────────────────────────────
async function fetchH2H(homeTeamId, awayTeamId) {
  const data = await apiGet('/fixtures/headtohead', { h2h: `${homeTeamId}-${awayTeamId}`, last: 5 });
  if (!data || !Array.isArray(data)) return [];
  return data.map((f) => ({
    date: f.fixture?.date,
    homeTeam: f.teams?.home?.name || '',
    awayTeam: f.teams?.away?.name || '',
    homeGoals: f.goals?.home,
    awayGoals: f.goals?.away,
    league: f.league?.name || '',
  }));
}

// ── Team statistics (league) ───────────────────────────────
async function fetchTeamStatistics(teamId, leagueId, season) {
  return apiGet('/teams/statistics', { team: teamId, league: leagueId, season: season || DEFAULT_SEASON }) || null;
}

// ── Predictions ────────────────────────────────────────────
async function fetchFixturePredictions(fixtureId) {
  const data = await apiGet('/predictions', { fixture: fixtureId });
  if (!data || !Array.isArray(data) || !data[0]) return null;
  const p = data[0];
  return {
    homeTeam: p.teams?.home?.name || '',
    awayTeam: p.teams?.away?.name || '',
    comparison: p.comparison || {},
    prediction: p.prediction?.comment || '',
    advice: p.prediction?.advice || '',
    goals: p.prediction?.goals || null,
  };
}

// ── Resolve team ID by name ────────────────────────────────
async function searchTeam(name) {
  const data = await apiGet('/teams/search', { search: name });
  if (!data || !Array.isArray(data) || !data[0]) return null;
  const team = data[0].team;
  return { id: team.id, name: team.name, country: team.country, logo: team.logo };
}

// ── Build comprehensive match data ────────────────────────
async function buildMatchPayload(fixture, matchDetail, season) {
  const homeTeam = fixture.teams?.home || {};
  const awayTeam = fixture.teams?.away || {};
  const homeId = homeTeam.id;
  const awayId = awayTeam.id;
  const leagueId = fixture.league?.id;
  const fixtureId = fixture.fixture?.id;

  // Parallel fetch all available data
  const [statistics, lineups, h2h, predictions, homeLast, awayLast] = await Promise.all([
    fixtureId ? fetchFixtureStatistics(fixtureId) : null,
    fixtureId ? fetchFixtureLineups(fixtureId) : null,
    homeId && awayId ? fetchH2H(homeId, awayId) : null,
    fixtureId ? fetchFixturePredictions(fixtureId) : null,
    homeId ? fetchTeamLastFixtures(homeId, 5, season) : null,
    awayId ? fetchTeamLastFixtures(awayId, 5, season) : null,
  ]);

  function formatRecentForm(fixtures) {
    if (!fixtures || !fixtures.length) return [];
    return fixtures.map((f) => ({
      date: f.fixture?.date?.substring(0, 10),
      home: f.teams?.home?.name || '',
      away: f.teams?.away?.name || '',
      score: `${f.goals?.home ?? '?'}:${f.goals?.away ?? '?'}`,
      result: f.teams?.home?.winner === true ? 'W' : f.teams?.away?.winner === true ? 'L' : 'D',
    }));
  }

  return {
    fixture_id: fixtureId,
    date: fixture.fixture?.date,
    league: fixture.league?.name || '',
    league_id: leagueId,
    season: season || DEFAULT_SEASON,
    home: { id: homeId, name: homeTeam.name || '' },
    away: { id: awayId, name: awayTeam.name || '' },
    statistics,
    lineups,
    h2h,
    predictions,
    recent_form: {
      home: formatRecentForm(homeLast),
      away: formatRecentForm(awayLast),
    },
    stavka_prediction: matchDetail?.predictionSummary || null,
  };
}

module.exports = {
  hasApiKey,
  DEFAULT_SEASON,
  fetchFixturesByDate,
  fetchTeamLastFixtures,
  fetchTeamNextFixtures,
  fetchFixtureStatistics,
  fetchFixtureLineups,
  fetchH2H,
  fetchTeamStatistics,
  fetchFixturePredictions,
  searchTeam,
  buildMatchPayload,
};
