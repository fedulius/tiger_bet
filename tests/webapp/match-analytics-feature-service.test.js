'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractAnalyticsFeatures } = require('../../webapp/services/matchAnalyticsFeatureService');
const { scoreMatch } = require('../../webapp/services/matchAnalyticsScoringService');

const sstatsData = {
  lineups: {
    home_xi: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, startXI: true })),
    away_xi: Array.from({ length: 10 }, (_, i) => ({ id: i + 20, startXI: true })),
  },
  recent_form: {
    home: [{ result: 'W' }, { result: 'W' }, { result: 'D' }, { result: 'L' }, { result: 'W' }],
    away: [{ result: 'L' }, { result: 'D' }, { result: 'L' }, { result: 'W' }, { result: 'L' }],
  },
  team_stats: {
    home: {
      games_count: 25,
      record: '17W 4D 4L',
      avg_scored: 1.84,
      avg_conceded: 0.91,
      xG: 1.73,
      xGA: 0.86,
      avg_shots: 14.2,
      avg_shots_opponent: 8.9,
    },
    away: {
      games_count: 25,
      record: '8W 6D 11L',
      avg_scored: 1.12,
      avg_conceded: 1.61,
      xG: 1.05,
      xGA: 1.57,
      avg_shots: 9.8,
      avg_shots_opponent: 13.1,
    },
  },
};

test('extractAnalyticsFeatures normalizes SStats fields and extension points', () => {
  const features = extractAnalyticsFeatures({ sport: 'soccer', sstatsData });

  assert.equal(features.version, 'analytics-features-v1');
  assert.equal(features.sport, 'soccer');
  assert.equal(features.coverage.home_team_stats, true);
  assert.equal(features.coverage.away_team_stats, true);
  assert.equal(features.coverage.home_recent_form, true);
  assert.equal(features.coverage.away_recent_form, true);
  assert.equal(features.coverage.lineups_known, true);
  assert.equal(features.coverage.h2h_available, false);
  assert.equal(features.h2h, null);
  assert.equal(features.ratings, null);
  assert.deepEqual(features.availability, { confirmed_absences: [] });

  assert.equal(features.home.games_count, 25);
  assert.equal(features.home.form_points_per_game, 2);
  assert.equal(features.home.xg_for, 1.73);
  assert.equal(features.home.xg_against, 0.86);
  assert.equal(features.away.form_points_per_game, 0.8);
  assert.equal(features.lineup.home_starting_xi_count, 11);
  assert.equal(features.lineup.away_starting_xi_count, 10);
});

test('extractAnalyticsFeatures handles missing optional fields without NaN', () => {
  const features = extractAnalyticsFeatures({
    sport: 'soccer',
    sstatsData: {
      recent_form: { home: [{ result: 'W' }], away: [] },
      team_stats: { home: { avg_scored: 1.2 }, away: null },
    },
  });

  assert.equal(features.coverage.away_team_stats, false);
  assert.equal(features.coverage.away_recent_form, false);
  assert.equal(features.away.games_count, null);
  assert.equal(features.away.form_points_per_game, null);
  assert.ok(Object.values(features.home).every(v => v === null || Number.isFinite(v)));
  assert.ok(Object.values(features.away).every(v => v === null || Number.isFinite(v)));
});

test('sparse null SStats payload is not eligible and does not create strong null-derived signals', () => {
  const features = extractAnalyticsFeatures({
    sport: 'soccer',
    sstatsData: {
      team_stats: { home: { avg_scored: null, xG: null }, away: {} },
      recent_form: { home: [], away: [] },
    },
  });
  const analytics = scoreMatch(features);

  assert.equal(analytics.eligibility.status, 'ineligible');
  assert.ok(analytics.confidence.score < 65);
  assert.ok(analytics.scores.under_2_5 < 100);
  assert.ok(analytics.scores.btts_no < 100);
});
