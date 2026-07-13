'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreMatch } = require('../../webapp/services/matchAnalyticsScoringService');

const strongHomeFeatures = {
  version: 'analytics-features-v1',
  sport: 'soccer',
  coverage: {
    home_team_stats: true,
    away_team_stats: true,
    home_recent_form: true,
    away_recent_form: true,
    lineups_known: true,
  },
  home: {
    games_count: 25,
    form_points_per_game: 2.4,
    wins: 18,
    draws: 3,
    losses: 4,
    avg_scored: 2.1,
    avg_conceded: 0.8,
    xg_for: 1.95,
    xg_against: 0.75,
    shots_for: 15,
    shots_against: 8,
  },
  away: {
    games_count: 25,
    form_points_per_game: 0.8,
    wins: 6,
    draws: 4,
    losses: 15,
    avg_scored: 0.9,
    avg_conceded: 1.7,
    xg_for: 0.9,
    xg_against: 1.65,
    shots_for: 8,
    shots_against: 14,
  },
  lineup: { status: 'known', home_starting_xi_count: 11, away_starting_xi_count: 11 },
};

test('scoreMatch produces bounded deterministic analytics for a strong home favorite', () => {
  const analytics = scoreMatch(strongHomeFeatures);

  assert.equal(analytics.version, 'match-analytics-v1');
  assert.equal(analytics.model_version, 'deterministic-v1');
  assert.equal(analytics.eligibility.status, 'eligible');
  assert.ok(analytics.scores.home_strength > analytics.scores.away_strength);
  assert.ok(analytics.scores.home_win >= 65);
  assert.ok(analytics.scores.away_win <= 35);
  assert.ok(analytics.scores.goal_expectation > 2.5);
  assert.ok(analytics.confidence.score >= 65);

  for (const [key, value] of Object.entries(analytics.scores)) {
    if (key === 'goal_expectation') assert.ok(Number.isFinite(value));
    else assert.ok(value >= 0 && value <= 100, `${key} out of range`);
  }
});

test('scoreMatch lowers confidence but avoids NaN when data is thin', () => {
  const features = {
    ...strongHomeFeatures,
    coverage: { home_team_stats: true, away_team_stats: false, home_recent_form: false, away_recent_form: false, lineups_known: false },
    home: { avg_scored: 1.3 },
    away: {},
    lineup: { status: 'unknown', home_starting_xi_count: 0, away_starting_xi_count: 0 },
  };

  const analytics = scoreMatch(features);

  assert.equal(analytics.eligibility.status, 'ineligible');
  assert.ok(analytics.eligibility.reasons.includes('analytics_insufficient_data'));
  assert.ok(analytics.confidence.score < 65);
  for (const value of Object.values(analytics.scores)) {
    assert.ok(Number.isFinite(value));
  }
});
