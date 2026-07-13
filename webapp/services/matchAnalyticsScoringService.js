'use strict';

const MODEL_VERSION = 'deterministic-v1';
const MIN_CONFIDENCE = 65;
const HOME_ADVANTAGE = 3;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function pairScore(value, other, inverse = false) {
  const a = finite(value, null);
  const b = finite(other, null);
  if (a == null && b == null) return 50;
  if (a == null) return 45;
  if (b == null) return 55;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (max === min) return 50;
  const raw = ((a - min) / (max - min)) * 100;
  return inverse ? 100 - raw : raw;
}

function formScore(ppg) {
  const v = finite(ppg, null);
  return v == null ? 50 : clamp((v / 3) * 100);
}

function recordScore(team) {
  const wins = finite(team.wins, null);
  const draws = finite(team.draws, null);
  const losses = finite(team.losses, null);
  if (wins == null || draws == null || losses == null) return 50;
  const games = wins + draws + losses;
  if (!games) return 50;
  return clamp(((wins * 3 + draws) / (games * 3)) * 100);
}

function attackScore(team, other) {
  return clamp(
    pairScore(team.xg_for, other.xg_for) * 0.45
    + pairScore(team.avg_scored, other.avg_scored) * 0.35
    + pairScore(team.shots_for, other.shots_for) * 0.20,
  );
}

function defenceScore(team, other) {
  return clamp(
    pairScore(team.xg_against, other.xg_against, true) * 0.55
    + pairScore(team.avg_conceded, other.avg_conceded, true) * 0.30
    + pairScore(team.shots_against, other.shots_against, true) * 0.15,
  );
}

function teamStrength(team, other) {
  return clamp(
    formScore(team.form_points_per_game) * 0.35
    + attackScore(team, other) * 0.30
    + defenceScore(team, other) * 0.25
    + recordScore(team) * 0.10,
  );
}

function dataCompleteness(features) {
  const coverage = features.coverage || {};
  const bools = [
    coverage.home_team_stats,
    coverage.away_team_stats,
    coverage.home_recent_form,
    coverage.away_recent_form,
  ];
  let score = bools.filter(Boolean).length / bools.length;
  const home = features.home || {};
  const away = features.away || {};
  const needed = ['avg_scored', 'avg_conceded', 'xg_for', 'xg_against'];
  const present = needed.reduce((acc, key) => acc + (Number.isFinite(Number(home[key])) ? 1 : 0) + (Number.isFinite(Number(away[key])) ? 1 : 0), 0);
  score = (score * 0.45) + ((present / (needed.length * 2)) * 0.55);
  return clamp(score, 0, 1);
}

function signalAgreement(home, away) {
  const strengthSide = home.strength >= away.strength ? 'home' : 'away';
  const formSide = finite(home.form, 50) >= finite(away.form, 50) ? 'home' : 'away';
  const attackSide = finite(home.attack, 50) >= finite(away.attack, 50) ? 'home' : 'away';
  const defenceSide = finite(home.defence, 50) >= finite(away.defence, 50) ? 'home' : 'away';
  const agrees = [formSide, attackSide, defenceSide].filter(side => side === strengthSide).length;
  return clamp(0.45 + agrees * 0.18, 0, 1);
}

function lineupCertainty(features) {
  const lineup = features.lineup || {};
  const home = finite(lineup.home_starting_xi_count, 0);
  const away = finite(lineup.away_starting_xi_count, 0);
  if (home >= 11 && away >= 11) return 1;
  if (home > 0 || away > 0) return 0.6;
  return 0.5;
}

function tier(score) {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function scoreMatch(features = {}) {
  const home = features.home || {};
  const away = features.away || {};

  const homeAttack = attackScore(home, away);
  const awayAttack = attackScore(away, home);
  const homeDefence = defenceScore(home, away);
  const awayDefence = defenceScore(away, home);
  const homeStrength = teamStrength(home, away) + HOME_ADVANTAGE;
  const awayStrength = teamStrength(away, home);
  const strengthEdge = homeStrength - awayStrength;

  const homeGoalSignal = (finite(home.xg_for, finite(home.avg_scored, 1.1)) + finite(away.xg_against, finite(away.avg_conceded, 1.1))) / 2;
  const awayGoalSignal = (finite(away.xg_for, finite(away.avg_scored, 1.1)) + finite(home.xg_against, finite(home.avg_conceded, 1.1))) / 2;
  const goalExpectation = round(homeGoalSignal + awayGoalSignal, 2);

  const completeness = dataCompleteness(features);
  const agreement = signalAgreement(
    { strength: homeStrength, form: formScore(home.form_points_per_game), attack: homeAttack, defence: homeDefence },
    { strength: awayStrength, form: formScore(away.form_points_per_game), attack: awayAttack, defence: awayDefence },
  );
  const lineup = lineupCertainty(features);
  const confidenceScore = Math.round((completeness * 0.50 + agreement * 0.30 + lineup * 0.20) * 100);

  const homeWin = clamp(50 + strengthEdge * 0.75);
  const awayWin = clamp(50 - strengthEdge * 0.75);
  const draw = clamp(30 - Math.abs(strengthEdge) * 0.25 + (100 - confidenceScore) * 0.05, 10, 45);
  const over = clamp(50 + (goalExpectation - 2.5) * 32 + ((homeAttack + awayAttack) / 2 - 50) * 0.2);
  const under = clamp(100 - over);
  const bttsYes = clamp(50 + (Math.min(homeGoalSignal, awayGoalSignal) - 1.05) * 35 + (goalExpectation - 2.4) * 10);
  const bttsNo = clamp(100 - bttsYes);

  const reasons = [];
  if (confidenceScore < MIN_CONFIDENCE) reasons.push('analytics_insufficient_data');

  return {
    version: 'match-analytics-v1',
    model_version: MODEL_VERSION,
    eligibility: { status: reasons.length ? 'ineligible' : 'eligible', reasons },
    scores: {
      home_strength: Math.round(clamp(homeStrength)),
      away_strength: Math.round(clamp(awayStrength)),
      strength_edge: Math.round(strengthEdge),
      home_non_loss: Math.round(clamp(homeWin + draw * 0.45)),
      away_non_loss: Math.round(clamp(awayWin + draw * 0.45)),
      home_win: Math.round(homeWin),
      draw: Math.round(draw),
      away_win: Math.round(awayWin),
      goal_expectation: goalExpectation,
      over_2_5: Math.round(over),
      under_2_5: Math.round(under),
      btts_yes: Math.round(bttsYes),
      btts_no: Math.round(bttsNo),
      exact_home_2_1: Math.round(clamp(homeWin * 0.45 + over * 0.25 + confidenceScore * 0.30 - 25)),
      exact_away_1_2: Math.round(clamp(awayWin * 0.45 + over * 0.25 + confidenceScore * 0.30 - 25)),
    },
    confidence: {
      score: confidenceScore,
      tier: tier(confidenceScore),
      data_completeness: round(completeness, 2),
      signal_agreement: round(agreement, 2),
      lineup_certainty: round(lineup, 2),
    },
    feature_contributions: {},
  };
}

module.exports = { scoreMatch, __private: { attackScore, defenceScore, teamStrength, dataCompleteness } };
