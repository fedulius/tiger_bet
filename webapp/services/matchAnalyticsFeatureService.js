'use strict';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRecord(record) {
  const text = String(record || '');
  const wins = Number((text.match(/(\d+)W/i) || [])[1]);
  const draws = Number((text.match(/(\d+)D/i) || [])[1]);
  const losses = Number((text.match(/(\d+)L/i) || [])[1]);
  return {
    wins: Number.isFinite(wins) ? wins : null,
    draws: Number.isFinite(draws) ? draws : null,
    losses: Number.isFinite(losses) ? losses : null,
  };
}

function formPointsPerGame(form) {
  if (!Array.isArray(form) || form.length === 0) return null;
  let points = 0;
  let count = 0;
  for (const entry of form) {
    const result = String(entry && entry.result || '').toUpperCase();
    if (!result) continue;
    if (result === 'W') points += 3;
    else if (result === 'D') points += 1;
    else if (result !== 'L') continue;
    count++;
  }
  return count > 0 ? Math.round((points / count) * 100) / 100 : null;
}

function normalizeTeamStats(stats, form) {
  const record = parseRecord(stats && stats.record);
  return {
    games_count: num(stats && stats.games_count),
    form_points_per_game: formPointsPerGame(form),
    wins: record.wins,
    draws: record.draws,
    losses: record.losses,
    avg_scored: num(stats && stats.avg_scored),
    avg_conceded: num(stats && stats.avg_conceded),
    xg_for: num(stats && (stats.xG ?? stats.xg_for)),
    xg_against: num(stats && (stats.xGA ?? stats.xg_against)),
    shots_for: num(stats && (stats.avg_shots ?? stats.shots_for)),
    shots_against: num(stats && (stats.avg_shots_opponent ?? stats.shots_against)),
  };
}

function extractAnalyticsFeatures({ sport = 'soccer', sstatsData = {} } = {}) {
  const teamStats = sstatsData.team_stats || {};
  const recentForm = sstatsData.recent_form || {};
  const lineups = sstatsData.lineups || {};
  const homeXi = Array.isArray(lineups.home_xi) ? lineups.home_xi : [];
  const awayXi = Array.isArray(lineups.away_xi) ? lineups.away_xi : [];
  const homeForm = Array.isArray(recentForm.home) ? recentForm.home : [];
  const awayForm = Array.isArray(recentForm.away) ? recentForm.away : [];

  return {
    version: 'analytics-features-v1',
    sport,
    coverage: {
      home_team_stats: !!teamStats.home,
      away_team_stats: !!teamStats.away,
      home_recent_form: homeForm.length >= 3,
      away_recent_form: awayForm.length >= 3,
      lineups_known: homeXi.length > 0 || awayXi.length > 0,
      h2h_available: false,
      glicko_available: false,
      injuries_available: false,
    },
    home: normalizeTeamStats(teamStats.home || {}, homeForm),
    away: normalizeTeamStats(teamStats.away || {}, awayForm),
    lineup: {
      status: (homeXi.length > 0 || awayXi.length > 0) ? 'known' : 'unknown',
      home_starting_xi_count: homeXi.length,
      away_starting_xi_count: awayXi.length,
    },
    h2h: null,
    ratings: null,
    availability: { confirmed_absences: [] },
  };
}

module.exports = { extractAnalyticsFeatures, __private: { formPointsPerGame, normalizeTeamStats } };
