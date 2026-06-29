'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectCandidateMatches,
  shouldSkipUnchanged,
  computeTimings,
  refreshMatchBrief,
  runAiBriefBatch,
} = require('../../webapp/services/aiBriefBatchService');

const NOW = new Date('2026-06-27T10:00:00.000Z');

function makeMatch(overrides = {}) {
  return {
    id: 101,
    slug: 'team-a-team-b',
    sportSlug: 'soccer',
    match: 'Team A — Team B',
    league: 'Premier League',
    starts_at: '2026-06-27T15:00:00.000Z',
    ...overrides,
  };
}

function makeStore(overrides = {}) {
  return {
    getCurrentBriefByMatchId: async () => null,
    insertGeneration: async (_pg, params) => ({ id: 501, ...params }),
    upsertCurrentBriefFromReadyGeneration: async (_pg, params) => ({ id: 601, ...params }),
    markCurrentBriefStaleAfterFailure: async () => {},
    markCurrentBriefStaleAfterSkip: async () => {},
    ...overrides,
  };
}

test('selectCandidateMatches removes invalid/past matches, dedupes, sorts, and limits', () => {
  const matches = [
    makeMatch({ id: 2, starts_at: '2026-06-27T14:00:00.000Z' }),
    makeMatch({ id: 1, starts_at: '2026-06-27T13:00:00.000Z' }),
    makeMatch({ id: 1, starts_at: '2026-06-27T12:00:00.000Z' }),
    makeMatch({ id: 3, starts_at: '2026-06-27T09:00:00.000Z' }),
    makeMatch({ id: null }),
  ];

  const result = selectCandidateMatches(matches, { now: NOW, limit: 2 });
  assert.deepEqual(result.map((item) => item.id), [1, 2]);
});

test('shouldSkipUnchanged returns true for same hash with future refresh_after and expires_at', () => {
  const row = {
    status: 'ready',
    source_hash: 'abc',
    refresh_after: '2026-06-27T11:00:00.000Z',
    expires_at: '2026-06-27T18:00:00.000Z',
  };
  const payload = { source_hash: 'abc' };
  assert.equal(shouldSkipUnchanged(row, payload, NOW), true);
});

test('shouldSkipUnchanged returns false when refresh_after is due', () => {
  const row = {
    status: 'ready',
    source_hash: 'abc',
    refresh_after: '2026-06-27T09:59:00.000Z',
    expires_at: '2026-06-27T18:00:00.000Z',
  };
  const payload = { source_hash: 'abc' };
  assert.equal(shouldSkipUnchanged(row, payload, NOW), false);
});

test('computeTimings derives refresh_after before match start and expiry after start', () => {
  const timings = computeTimings(makeMatch(), NOW, {
    refreshLeadMs: 60 * 60 * 1000,
    staleGraceMs: 2 * 60 * 60 * 1000,
  });

  assert.equal(timings.refreshAfter, '2026-06-27T14:00:00.000Z');
  assert.equal(timings.expiresAt, '2026-06-27T17:00:00.000Z');
});

test('refreshMatchBrief returns unchanged when current ready brief has same fresh hash', async () => {
  const store = makeStore({
    getCurrentBriefByMatchId: async () => ({
      match_id: 101,
      status: 'ready',
      source_hash: 'same',
      refresh_after: '2026-06-27T11:00:00.000Z',
      expires_at: '2026-06-27T18:00:00.000Z',
    }),
    insertGeneration: async () => {
      throw new Error('should not insert');
    },
  });

  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch(),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'full', source_hash: 'same', match_slug: 'team-a-team-b' }),
    generator: async () => {
      throw new Error('should not generate');
    },
    store,
  });

  assert.equal(result.outcome, 'unchanged');
  assert.equal(result.counts.unchanged, 1);
  assert.equal(result.counts.full, 1);
});

test('refreshMatchBrief persists ready generation and current row', async () => {
  let insertedGeneration = null;
  let upsertedCurrent = null;
  const store = makeStore({
    insertGeneration: async (_pg, params) => {
      insertedGeneration = params;
      return { id: 777, ...params };
    },
    upsertCurrentBriefFromReadyGeneration: async (_pg, params) => {
      upsertedCurrent = params;
      return { id: 888, ...params };
    },
  });

  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch(),
    now: NOW,
    sourceBuilder: async () => ({
      match_id: 101,
      match_slug: 'team-a-team-b',
      sport_slug: 'soccer',
      source_mode: 'full',
      source_hash: 'hash-1',
      source_url: 'https://stavka.tv/matches/team-a-team-b',
      primary_signal: { label: 'Победа Team A', rate: 1.91 },
      top_bets: [],
      risk_bets: [],
      summary_snippet: 'Summary',
    }),
    generator: async () => ({
      status: 'ready',
      output: { headline: 'Headline', brief: 'Brief', risk_note: 'Risk note' },
      model_name: 'gpt-5.4',
      prompt_version: 'v1',
      prompt_tokens: 123,
      completion_tokens: 45,
    }),
    store,
    modelName: 'gpt-5.4',
    promptVersion: 'v1',
  });

  assert.equal(result.outcome, 'ready');
  assert.equal(result.counts.ready, 1);
  assert.equal(insertedGeneration.status, 'ready');
  assert.equal(insertedGeneration.tokensInput, 123);
  assert.equal(insertedGeneration.tokensOutput, 45);
  assert.equal(upsertedCurrent.matchSlug, 'team-a-team-b');
  assert.equal(upsertedCurrent.primaryForecast, 'Победа Team A');
  assert.equal(upsertedCurrent.sourceHash, 'hash-1');
  assert.ok(upsertedCurrent.refreshAfter);
  assert.ok(upsertedCurrent.expiresAt);
});

test('refreshMatchBrief handles source skip and preserves stale semantics', async () => {
  let staleArgs = null;
  const store = makeStore({
    getCurrentBriefByMatchId: async () => ({ match_id: 101, status: 'ready' }),
    insertGeneration: async (_pg, params) => ({ id: 900, ...params }),
    markCurrentBriefStaleAfterSkip: async (_pg, params) => {
      staleArgs = params;
    },
  });

  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch(),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'skip', skip_reason: 'insufficient_data', match_slug: 'team-a-team-b' }),
    store,
  });

  assert.equal(result.outcome, 'skipped');
  assert.equal(result.counts.skipped, 1);
  assert.equal(result.counts.stale_transitions, 1);
  assert.deepEqual(staleArgs, {
    matchId: 101,
    generationId: 900,
    skipReason: 'insufficient_data',
    sourceMode: 'skip',
    sourceHash: null,
    sourcePayload: { source_mode: 'skip', skip_reason: 'insufficient_data', match_slug: 'team-a-team-b' },
  });
});

test('refreshMatchBrief handles generation failure and preserves stale semantics', async () => {
  let staleArgs = null;
  const store = makeStore({
    getCurrentBriefByMatchId: async () => ({ match_id: 101, status: 'stale' }),
    insertGeneration: async (_pg, params) => ({ id: 901, ...params }),
    markCurrentBriefStaleAfterFailure: async (_pg, params) => {
      staleArgs = params;
    },
  });

  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch(),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'light', source_hash: 'hash-2', match_slug: 'team-a-team-b' }),
    generator: async () => ({ status: 'failed', error: 'provider_timeout' }),
    store,
    modelName: 'gpt-5.4',
    promptVersion: 'v1',
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.light, 1);
  assert.equal(result.counts.stale_transitions, 1);
  assert.deepEqual(staleArgs, {
    matchId: 101,
    generationId: 901,
    errorMessage: 'provider_timeout',
    sourceMode: 'light',
    sourceHash: 'hash-2',
    sourcePayload: { source_mode: 'light', source_hash: 'hash-2', match_slug: 'team-a-team-b' },
  });
});

test('runAiBriefBatch collects counters across mixed outcomes', async () => {
  const matches = [makeMatch({ id: 101 }), makeMatch({ id: 102 }), makeMatch({ id: 103 })];

  const summary = await runAiBriefBatch({
    pg: {},
    matches,
    selectCandidates: (items) => items,
    sourceBuilder: async ({ match }) => {
      if (match.id === 101) {
        return { source_mode: 'full', source_hash: 'h-101', match_slug: match.slug };
      }
      if (match.id === 102) {
        return { source_mode: 'light', source_hash: 'same', match_slug: match.slug };
      }
      return { source_mode: 'skip', skip_reason: 'insufficient_data', match_slug: match.slug };
    },
    generator: async ({ sourcePayload }) => ({
      status: 'ready',
      output: {
        headline: `H:${sourcePayload.source_mode}`,
        brief: `B:${sourcePayload.source_mode}`,
        risk_note: null,
      },
    }),
    store: makeStore({
      getCurrentBriefByMatchId: async (_pg, { matchId }) => {
        if (matchId === 102) {
          return {
            match_id: 102,
            status: 'ready',
            source_hash: 'same',
            refresh_after: '2026-06-27T11:00:00.000Z',
            expires_at: '2026-06-27T18:00:00.000Z',
          };
        }
        if (matchId === 103) {
          return { match_id: 103, status: 'ready' };
        }
        return null;
      },
    }),
    now: NOW,
  });

  assert.equal(summary.candidates, 3);
  assert.equal(summary.processed, 3);
  assert.equal(summary.full, 1);
  assert.equal(summary.light, 1);
  assert.equal(summary.skip, 1);
  assert.equal(summary.ready, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.stale_transitions, 1);
});

test('selectCandidateMatches keeps slug-only future matches', () => {
  const matches = [
    makeMatch({ id: undefined, slug: 'alpha-vs-beta', starts_at: '2026-06-27T15:00:00.000Z' }),
    makeMatch({ id: undefined, slug: 'gamma-vs-delta', starts_at: '2026-06-27T16:00:00.000Z' }),
  ];

  const result = selectCandidateMatches(matches, { now: NOW });
  assert.equal(result.length, 2);
});

test('selectCandidateMatches dedupes slug-only matches by slug deterministically', () => {
  const matches = [
    makeMatch({ id: undefined, slug: 'alpha-vs-beta', starts_at: '2026-06-27T15:00:00.000Z' }),
    makeMatch({ id: undefined, slug: 'alpha-vs-beta', starts_at: '2026-06-27T16:00:00.000Z' }),
  ];

  const result = selectCandidateMatches(matches, { now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, 'alpha-vs-beta');
});

test('selectCandidateMatches drops slug-only past matches', () => {
  const matches = [
    makeMatch({ id: undefined, slug: 'alpha-vs-beta', starts_at: '2026-06-27T09:00:00.000Z' }),
  ];

  const result = selectCandidateMatches(matches, { now: NOW });
  assert.equal(result.length, 0);
});

test('selectCandidateMatches drops matches with neither id nor slug', () => {
  const matches = [
    makeMatch({ id: undefined, slug: undefined, starts_at: '2026-06-27T15:00:00.000Z' }),
  ];

  const result = selectCandidateMatches(matches, { now: NOW });
  assert.equal(result.length, 0);
});

test('refreshMatchBrief does not return invalid_match_id for slug-only live match', async () => {
  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch({ id: undefined }),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'full', source_hash: 'h-slug', match_slug: 'team-a-team-b' }),
    generator: async () => ({
      status: 'ready',
      output: { headline: 'H', brief: 'B', risk_note: null },
    }),
    store: makeStore(),
  });

  assert.equal(result.outcome, 'ready');
  assert.notEqual(result.error, 'invalid_match_id');
});

test('refreshMatchBrief derives deterministic positive match_id from slug', async () => {
  const run = () =>
    refreshMatchBrief({
      pg: {},
      match: makeMatch({ id: undefined }),
      now: NOW,
      sourceBuilder: async () => ({ source_mode: 'full', source_hash: 'h-slug', match_slug: 'team-a-team-b' }),
      generator: async () => ({
        status: 'ready',
        output: { headline: 'H', brief: 'B', risk_note: null },
      }),
      store: makeStore(),
    });

  const [r1, r2] = await Promise.all([run(), run()]);

  assert.equal(r1.match_id, r2.match_id);
  assert.ok(Number.isFinite(r1.match_id));
  assert.ok(r1.match_id > 0);
});

test('refreshMatchBrief still fails with invalid_match_id when match has no id and no slug', async () => {
  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch({ id: undefined, slug: undefined }),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'full', source_hash: 'h', match_slug: null }),
    generator: async () => ({ status: 'ready', output: { headline: 'H', brief: 'B', risk_note: null } }),
    store: makeStore(),
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.error, 'invalid_match_id');
});

test('refreshMatchBrief uses real numeric match_id unchanged when present', async () => {
  const result = await refreshMatchBrief({
    pg: {},
    match: makeMatch({ id: 999 }),
    now: NOW,
    sourceBuilder: async () => ({ source_mode: 'full', source_hash: 'h-999', match_slug: 'team-a-team-b' }),
    generator: async () => ({
      status: 'ready',
      output: { headline: 'H', brief: 'B', risk_note: null },
    }),
    store: makeStore(),
  });

  assert.equal(result.match_id, 999);
});

test('runAiBriefBatch continues when one match throws', async () => {
  const matches = [makeMatch({ id: 1 }), makeMatch({ id: 2 })];
  let calls = 0;

  const summary = await runAiBriefBatch({
    pg: {},
    matches,
    selectCandidates: (items) => items,
    sourceBuilder: async ({ match }) => ({ source_mode: 'full', source_hash: `h-${match.id}`, match_slug: match.slug }),
    generator: async ({ sourcePayload }) => {
      calls += 1;
      if (sourcePayload.source_hash === 'h-1') {
        throw new Error('boom');
      }
      return { status: 'ready', output: { headline: 'H', brief: 'B', risk_note: null } };
    },
    store: makeStore(),
  });

  assert.equal(calls, 2);
  assert.equal(summary.processed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.ready, 1);
  assert.equal(summary.results[0].outcome, 'failed');
  assert.equal(summary.results[1].outcome, 'ready');
});
