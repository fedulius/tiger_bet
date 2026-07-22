'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeRecommendedPickMatch,
  buildAnalystPrompts,
} = require('../../webapp/services/recommendedPickAnalystService');

function analystInput(overrides = {}) {
  return {
    match_ref: 42,
    match: {
      sport: 'football',
      starts_at: '2026-07-22T18:00:00.000Z',
      league: 'Champions League',
      home_team: 'Home FC',
      away_team: 'Away FC',
    },
    analytics_features: {
      home: { avg_scored: 1.8 },
      away: { avg_scored: 1.1 },
      coverage: { home_team_stats: true, away_team_stats: true },
    },
    sstats_data: { fixture: { status: 'scheduled' } },
    data_quality: { team_stats: 'complete', overall_coverage: 0.8 },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    match_ref: 42,
    match_assessment: 'Home FC has the stronger recent scoring profile.',
    market_estimates: [
      {
        market_key: 'one_x_two:home',
        estimated_probability: 0.58,
        confidence: 72,
        rationale: 'Home scoring average is higher in the supplied analytics.',
        evidence: [
          {
            path: 'analytics_features.home.avg_scored',
            value: 1.8,
            interpretation: 'The supplied home scoring average is higher.',
          },
        ],
      },
      {
        market_key: 'both_to_score:yes',
        estimated_probability: 0.54,
        confidence: 61,
        rationale: 'Both supplied averages are above one goal.',
        evidence: [
          {
            path: 'analytics_features.away.avg_scored',
            value: 1.1,
            interpretation: 'The supplied away scoring average is above one.',
          },
        ],
      },
    ],
    uncertainty: null,
    data_quality: { team_stats: 'complete', overall_coverage: 0.8 },
    analyst_version: 'recommended-pick-analyst-v1',
    ...overrides,
  };
}

test('analyst prompt contains only the whitelisted SStats payload and never leaks odds inputs', () => {
  const prompts = buildAnalystPrompts(analystInput({
    odds: { one_x_two: { w1: 1.9 } },
    available_odds: [{ odds_id: 'secret-odd' }],
    odds_id: 'secret-id',
    sstats_data: { odds: { home: 1.7 }, fixture: { status: 'scheduled' } },
  }));

  assert.match(prompts.userPrompt, /recommended-pick-analyst-v1/);
  assert.doesNotMatch(prompts.userPrompt, /secret-odd|secret-id|1\.9|1\.7|available_odds|odds_id/);
  assert.match(prompts.systemPrompt, /never a bet recommendation or a published bet/i);
  assert.match(prompts.systemPrompt, /untrusted/i);
});

test('analyst strict response schema closes the data-quality object for the provider', () => {
  const schema = buildAnalystPrompts(analystInput()).responseFormat.json_schema.schema;
  assert.equal(schema.properties.data_quality.additionalProperties, false);
  assert.deepEqual(schema.properties.data_quality.required, ['team_stats', 'recent_form', 'lineups', 'h2h', 'ratings', 'overall_coverage']);
});

test('analyst accepts only exact snapshot schema with exact scalar evidence paths', async () => {
  const result = await analyzeRecommendedPickMatch(analystInput(), {
    provider: async () => ({ text: JSON.stringify(snapshot()) }),
  });

  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.market_estimates), true);
  assert.equal(result.trace.prompt_version, 'recommended-pick-analyst-v1');
});

test('analyst rejects missing snapshot fields and invented evidence paths', async () => {
  let calls = 0;
  const result = await analyzeRecommendedPickMatch(analystInput(), {
    provider: async () => {
      calls += 1;
      return {
        text: JSON.stringify(calls === 1
          ? (() => { const value = snapshot(); delete value.uncertainty; return value; })()
          : snapshot({ market_estimates: [{ ...snapshot().market_estimates[0], evidence: [{ path: 'analytics_features.home.invented', value: 1.8, interpretation: 'not sourced' }] }, snapshot().market_estimates[1]] })),
      };
    },
  });

  assert.equal(result.snapshot, null);
  assert.deepEqual(result.trace.validation_errors, [
    'missing required field: uncertainty',
    'evidence path must reference an exact scalar analyst input value: analytics_features.home.invented',
  ]);
});

test('analyst retries once with the concrete validation error then returns valid snapshot', async () => {
  const calls = [];
  const result = await analyzeRecommendedPickMatch(analystInput(), {
    provider: async (request) => {
      calls.push(request);
      return { text: JSON.stringify(calls.length === 1 ? snapshot({ extra: true }) : snapshot()) };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].userPrompt, /Previous response was rejected: unexpected field: extra/);
  assert.deepEqual(result.snapshot, snapshot());
  assert.deepEqual(result.trace.validation_errors, ['unexpected field: extra']);
});

test('analyst returns no snapshot after malformed and then invalid output without code forecasts', async () => {
  let calls = 0;
  const result = await analyzeRecommendedPickMatch(analystInput(), {
    provider: async () => {
      calls += 1;
      return calls === 1
        ? { text: 'not json' }
        : { text: JSON.stringify(snapshot({ market_estimates: [{ ...snapshot().market_estimates[0], evidence: [{ path: 'analytics_features.home.made_up', value: 99, interpretation: 'invented' }] }] })) };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.snapshot, null);
  assert.equal(result.reason, 'analyst_snapshot_invalid');
  assert.equal(result.forecast, undefined);
  assert.equal(result.trace.validation_errors.length, 2);
});
