'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOptionWhitelist,
  buildValueSelectorPrompts,
  selectRecommendedPickValue,
} = require('../../webapp/services/recommendedPickValueSelectorService');

function analystSnapshot(matchRef, estimates = [
  { market_key: 'one_x_two:home', estimated_probability: 0.58, confidence: 72 },
  { market_key: 'both_to_score:yes', estimated_probability: 0.54, confidence: 61 },
]) {
  return Object.freeze({
    match_ref: matchRef,
    match_assessment: 'Immutable analyst snapshot.',
    market_estimates: estimates,
    uncertainty: null,
    data_quality: { overall_coverage: 0.8 },
    analyst_version: 'recommended-pick-analyst-v1',
  });
}

function sourceOptions() {
  return [
    { match_ref: 42, option_ref: 'a-home', market_key: 'one_x_two:home', label: 'Home win', odds_decimal: 2.1, implied_probability: 0.476 },
    { match_ref: 42, option_ref: 'a-away', market_key: 'one_x_two:away', label: 'Away win', odds_decimal: 3.4, implied_probability: 0.294 },
    { match_ref: 42, option_ref: 'a-btts', market_key: 'both_to_score:yes', label: 'Both score', odds_decimal: 1.95, implied_probability: 0.513 },
    { match_ref: 77, option_ref: 'b-home', market_key: 'one_x_two:home', label: 'Home win', odds_decimal: 2.3, implied_probability: 0.435 },
  ];
}

function selection(overrides = {}) {
  return {
    match_ref: 42,
    option_ref: 'a-home',
    selection_confidence: 76,
    selection_quality: 'strong',
    warning: null,
    selector_version: 'recommended-pick-value-selector-v1',
    ...overrides,
  };
}

test('option whitelist retains only analyst-estimated market keys and applies compact caps', () => {
  const snapshots = [
    analystSnapshot(42),
    analystSnapshot(77, [{ market_key: 'one_x_two:home', estimated_probability: 0.55, confidence: 70 }]),
  ];
  const whitelist = buildOptionWhitelist(snapshots, sourceOptions());

  assert.deepEqual(whitelist, [
    sourceOptions()[0],
    sourceOptions()[2],
    sourceOptions()[3],
  ]);
  assert.equal(whitelist.some((option) => option.market_key === 'one_x_two:away'), false);
});

test('valid selector result maps to an existing whitelisted option and analyst market estimate', async () => {
  const snapshots = [analystSnapshot(42)];
  const result = await selectRecommendedPickValue(snapshots, sourceOptions(), {
    provider: async () => ({ text: JSON.stringify(selection()) }),
  });

  assert.deepEqual(result.selection, selection());
  assert.equal(Object.isFrozen(result.selection), true);
  assert.equal(result.trace.prompt_version, 'recommended-pick-value-selector-v1');
});

test('selector rejects an option_ref belonging to another match', async () => {
  const result = await selectRecommendedPickValue([analystSnapshot(42), analystSnapshot(77)], sourceOptions(), {
    provider: async () => ({ text: JSON.stringify(selection({ option_ref: 'b-home' })) }),
  });

  assert.equal(result.selection, null);
  assert.equal(result.reason, 'value_selection_invalid');
  assert.match(result.trace.validation_errors[0], /option_ref must belong to match_ref/);
});

test('selector retries once after invalid response and accepts a valid selection', async () => {
  const calls = [];
  const result = await selectRecommendedPickValue([analystSnapshot(42)], sourceOptions(), {
    provider: async (request) => {
      calls.push(request);
      return { text: JSON.stringify(calls.length === 1 ? selection({ selection_quality: 'strong', warning: 'must be null' }) : selection()) };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].userPrompt, /Previous response was rejected: strong selection requires warning to be null/);
  assert.deepEqual(result.selection, selection());
});

test('selector returns no selection after two invalid responses and never uses a code fallback', async () => {
  let calls = 0;
  const result = await selectRecommendedPickValue([analystSnapshot(42)], sourceOptions(), {
    provider: async () => {
      calls += 1;
      return { text: calls === 1 ? 'not json' : JSON.stringify(selection({ selection_confidence: 20, selection_quality: 'strong' })) };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.selection, null);
  assert.equal(result.reason, 'value_selection_invalid');
  assert.equal(result.fallback, undefined);
  assert.equal(result.trace.validation_errors.length, 2);
});

test('selector prompt contains snapshots and compact whitelist but no raw SStats, provider odds IDs, or evidence text', () => {
  const snapshot = analystSnapshot(42, [{
    market_key: 'one_x_two:home', estimated_probability: 0.58, confidence: 72,
    rationale: 'do not send', evidence: [{ path: 'sstats_data.secret', value: 'raw data' }],
  }]);
  const prompts = buildValueSelectorPrompts([snapshot], [{
    ...sourceOptions()[0],
    provider_odds_id: 'provider-secret',
    sstats_data: { raw: 'never send' },
  }]);

  assert.match(prompts.systemPrompt, /value selector/i);
  assert.match(prompts.systemPrompt, /cannot invent sports facts/i);
  assert.match(prompts.systemPrompt, /cannot modify analyst probability/i);
  assert.match(prompts.systemPrompt, /no provider odds IDs/i);
  assert.doesNotMatch(prompts.userPrompt, /sstats_data|provider-secret|do not send|raw data/i);
  assert.match(prompts.userPrompt, /implied_probability/);
});
