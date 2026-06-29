const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakePg } = require('./testHelpers');
const {
  getCurrentBriefByMatchId,
  getCurrentBriefsByMatchIds,
  getCurrentBriefsByMatchSlugs,
  mapCurrentRowToApiBrief,
  insertGeneration,
  upsertCurrentBriefFromReadyGeneration,
  upsertNoopCurrentRow,
  markCurrentBriefStaleAfterFailure,
  markCurrentBriefStaleAfterSkip,
} = require('../../webapp/services/aiBriefStore');

// --- mapCurrentRowToApiBrief ---

test('mapCurrentRowToApiBrief: returns lightweight api object', () => {
  const row = {
    match_id: 42,
    status: 'ready',
    headline: 'Test headline',
    brief: 'Test brief',
    risk_note: 'Low risk',
    current_generation_id: 99,
    last_error: null,
  };

  const result = mapCurrentRowToApiBrief(row);

  assert.deepEqual(result, {
    headline: 'Test headline',
    brief: 'Test brief',
    risk_note: 'Low risk',
    stale: false,
  });

  assert.equal('current_generation_id' in result, false);
  assert.equal('last_error' in result, false);
  assert.equal('match_id' in result, false);
  assert.equal('status' in result, false);
});

test('mapCurrentRowToApiBrief: sets stale=true for stale status', () => {
  const row = { status: 'stale', headline: 'H', brief: 'B', risk_note: null };
  const result = mapCurrentRowToApiBrief(row);
  assert.equal(result.stale, true);
  assert.equal(result.risk_note, null);
});

test('mapCurrentRowToApiBrief: sets stale=false for ready status', () => {
  const row = { status: 'ready', headline: 'H', brief: 'B', risk_note: 'Note' };
  assert.equal(mapCurrentRowToApiBrief(row).stale, false);
});

test('mapCurrentRowToApiBrief: returns null for null input', () => {
  assert.equal(mapCurrentRowToApiBrief(null), null);
});

test('mapCurrentRowToApiBrief: returns null for undefined input', () => {
  assert.equal(mapCurrentRowToApiBrief(undefined), null);
});

// --- getCurrentBriefByMatchId ---

test('getCurrentBriefByMatchId: returns normalized row when found', async () => {
  const fakeRow = {
    match_id: 123,
    status: 'ready',
    headline: 'Match headline',
    brief: 'Match brief text',
    risk_note: 'Medium risk',
  };

  const pg = createFakePg({ rows: [fakeRow] });
  const result = await getCurrentBriefByMatchId(pg, { matchId: 123 });

  assert.deepEqual(result, {
    match_id: 123,
    status: 'ready',
    headline: 'Match headline',
    brief: 'Match brief text',
    risk_note: 'Medium risk',
  });
});

test('getCurrentBriefByMatchId: returns null when not found', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await getCurrentBriefByMatchId(pg, { matchId: 999 });
  assert.equal(result, null);
});

test('getCurrentBriefByMatchId: passes correct params to pg', async () => {
  const pg = createFakePg({ rows: [] });
  await getCurrentBriefByMatchId(pg, { matchId: 42 });

  assert.equal(pg.calls.length, 1);
  assert.deepEqual(pg.calls[0].params, [42]);
});

test('getCurrentBriefByMatchId: coerces match_id to number', async () => {
  const fakeRow = {
    match_id: '77',
    status: 'stale',
    headline: 'H',
    brief: 'B',
    risk_note: null,
  };

  const pg = createFakePg({ rows: [fakeRow] });
  const result = await getCurrentBriefByMatchId(pg, { matchId: 77 });

  assert.equal(typeof result.match_id, 'number');
  assert.equal(result.match_id, 77);
});

// --- getCurrentBriefsByMatchIds ---

test('getCurrentBriefsByMatchIds: returns empty map for empty matchIds', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await getCurrentBriefsByMatchIds(pg, { matchIds: [] });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
  assert.equal(pg.calls.length, 0);
});

test('getCurrentBriefsByMatchIds: returns map keyed by match_id', async () => {
  const rows = [
    { match_id: 10, status: 'ready', headline: 'H1', brief: 'B1', risk_note: null },
    { match_id: 20, status: 'stale', headline: 'H2', brief: 'B2', risk_note: 'Risk note' },
  ];

  const pg = createFakePg({ rows });
  const result = await getCurrentBriefsByMatchIds(pg, { matchIds: [10, 20, 30] });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get(10), {
    match_id: 10, status: 'ready', headline: 'H1', brief: 'B1', risk_note: null,
  });
  assert.deepEqual(result.get(20), {
    match_id: 20, status: 'stale', headline: 'H2', brief: 'B2', risk_note: 'Risk note',
  });
  assert.equal(result.has(30), false);
});

test('getCurrentBriefsByMatchIds: passes correct params to pg', async () => {
  const pg = createFakePg({ rows: [] });
  await getCurrentBriefsByMatchIds(pg, { matchIds: [1, 2, 3] });

  assert.equal(pg.calls.length, 1);
  assert.deepEqual(pg.calls[0].params, [1, 2, 3]);
});

test('getCurrentBriefsByMatchIds: handles missing match_ids with no query', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await getCurrentBriefsByMatchIds(pg, { matchIds: null });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
  assert.equal(pg.calls.length, 0);
});

test('getCurrentBriefsByMatchIds: single match_id works', async () => {
  const row = { match_id: 55, status: 'ready', headline: 'Single', brief: 'Brief', risk_note: null };
  const pg = createFakePg({ rows: [row] });
  const result = await getCurrentBriefsByMatchIds(pg, { matchIds: [55] });

  assert.equal(result.size, 1);
  assert.equal(result.get(55).headline, 'Single');
  assert.deepEqual(pg.calls[0].params, [55]);
});

// --- getCurrentBriefsByMatchSlugs ---

test('getCurrentBriefsByMatchSlugs: returns empty map for empty matchSlugs', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await getCurrentBriefsByMatchSlugs(pg, { matchSlugs: [] });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
  assert.equal(pg.calls.length, 0);
});

test('getCurrentBriefsByMatchSlugs: returns map keyed by match_slug', async () => {
  const rows = [
    { match_id: 10, match_slug: 'slug-a', status: 'ready', headline: 'H1', brief: 'B1', risk_note: null },
    { match_id: 20, match_slug: 'slug-b', status: 'stale', headline: 'H2', brief: 'B2', risk_note: 'Risk' },
  ];

  const pg = createFakePg({ rows });
  const result = await getCurrentBriefsByMatchSlugs(pg, { matchSlugs: ['slug-a', 'slug-b', 'slug-c'] });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 2);
  assert.equal(result.get('slug-a').headline, 'H1');
  assert.equal(result.get('slug-a').status, 'ready');
  assert.equal(result.get('slug-b').status, 'stale');
  assert.equal(result.get('slug-b').risk_note, 'Risk');
  assert.equal(result.has('slug-c'), false);
});

test('getCurrentBriefsByMatchSlugs: passes correct params to pg', async () => {
  const pg = createFakePg({ rows: [] });
  await getCurrentBriefsByMatchSlugs(pg, { matchSlugs: ['slug-x', 'slug-y'] });

  assert.equal(pg.calls.length, 1);
  assert.deepEqual(pg.calls[0].params, ['slug-x', 'slug-y']);
  assert.ok(pg.calls[0].query.includes('match_slug IN'), 'query should filter by match_slug');
});

test('getCurrentBriefsByMatchSlugs: handles null matchSlugs with no query', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await getCurrentBriefsByMatchSlugs(pg, { matchSlugs: null });

  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
  assert.equal(pg.calls.length, 0);
});

test('getCurrentBriefsByMatchSlugs: skips rows with null match_slug', async () => {
  const rows = [
    { match_id: 5, match_slug: null, status: 'ready', headline: 'H', brief: 'B', risk_note: null },
    { match_id: 6, match_slug: 'good-slug', status: 'ready', headline: 'H2', brief: 'B2', risk_note: null },
  ];
  const pg = createFakePg({ rows });
  const result = await getCurrentBriefsByMatchSlugs(pg, { matchSlugs: ['good-slug'] });

  assert.equal(result.size, 1);
  assert.ok(result.has('good-slug'));
});

// --- insertGeneration ---

test('insertGeneration: returns inserted row from pg', async () => {
  const inserted = {
    id: 1,
    match_id: 42,
    match_slug: null,
    run_type: 'scheduled',
    status: 'ready',
    headline: 'H',
    brief: 'B',
    risk_note: null,
    source_mode: 'full',
    source_hash: 'abc123',
    model_name: 'claude-sonnet-4-6',
    prompt_version: 'v1',
    tokens_input: 500,
    tokens_output: 200,
    estimated_cost: null,
    failure_reason: null,
    skip_reason: null,
    created_at: new Date(),
  };
  const pg = createFakePg({ rows: [inserted] });
  const result = await insertGeneration(pg, {
    matchId: 42,
    status: 'ready',
    headline: 'H',
    brief: 'B',
    sourceMode: 'full',
    sourceHash: 'abc123',
    modelName: 'claude-sonnet-4-6',
    promptVersion: 'v1',
    tokensInput: 500,
    tokensOutput: 200,
  });

  assert.equal(result.id, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.source_hash, 'abc123');
});

test('insertGeneration: passes correct params in order', async () => {
  const pg = createFakePg({ rows: [{ id: 7 }] });
  await insertGeneration(pg, {
    matchId: 10,
    matchSlug: null,
    runType: 'scheduled',
    status: 'failed',
    headline: null,
    brief: null,
    riskNote: null,
    sourceMode: 'light',
    sourceHash: 'hash1',
    sourcePayload: null,
    modelName: 'claude-haiku-4-5-20251001',
    promptVersion: 'v2',
    tokensInput: 100,
    tokensOutput: 0,
    estimatedCost: null,
    failureReason: 'Provider error',
    skipReason: null,
    startedAt: null,
  });

  assert.equal(pg.calls.length, 1);
  const params = pg.calls[0].params;
  assert.equal(params[0], 10);                           // matchId
  assert.equal(params[1], null);                         // matchSlug
  assert.equal(params[2], 'scheduled');                  // runType
  assert.equal(params[3], 'failed');                     // status
  assert.equal(params[4], null);                         // headline
  assert.equal(params[5], null);                         // brief
  assert.equal(params[6], null);                         // risk_note
  assert.equal(params[7], 'light');                      // source_mode
  assert.equal(params[8], 'hash1');                      // source_hash
  assert.equal(params[9], '{}');                         // source_payload (null falls back to '{}')
  assert.equal(params[10], 'claude-haiku-4-5-20251001'); // model_name
  assert.equal(params[11], 'v2');                        // prompt_version
  assert.equal(params[12], 100);                         // tokens_input
  assert.equal(params[13], 0);                           // tokens_output
  assert.equal(params[14], null);                        // estimated_cost
  assert.equal(params[15], 'Provider error');            // failure_reason
  assert.equal(params[16], null);                        // skip_reason
  assert.equal(params[17], null);                        // started_at
});

test('insertGeneration: returns null when pg returns empty rows', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await insertGeneration(pg, { matchId: 1, status: 'ready' });
  assert.equal(result, null);
});

test('insertGeneration: optional fields default to null', async () => {
  const pg = createFakePg({ rows: [{ id: 3 }] });
  await insertGeneration(pg, { matchId: 2, status: 'skipped' });

  const params = pg.calls[0].params;
  assert.equal(params[4], null);  // headline
  assert.equal(params[5], null);  // brief
  assert.equal(params[15], null); // failure_reason
  assert.equal(params[16], null); // skip_reason
});

// --- upsertCurrentBriefFromReadyGeneration ---

test('upsertCurrentBriefFromReadyGeneration: upserts with ready status and returns row', async () => {
  const upserted = {
    match_id: 42,
    brief_status: 'ready',
    last_generation_status: 'ready',
    headline: 'New headline',
    brief: 'New brief',
    risk_note: 'Some risk',
    current_generation_id: 7,
    generated_at: new Date(),
    invalidated_at: null,
    invalidated_reason: null,
    last_error: null,
  };
  const pg = createFakePg({ rows: [upserted] });
  const result = await upsertCurrentBriefFromReadyGeneration(pg, {
    matchId: 42,
    generationId: 7,
    headline: 'New headline',
    brief: 'New brief',
    riskNote: 'Some risk',
  });

  assert.equal(result.brief_status, 'ready');
  assert.equal(result.headline, 'New headline');
  assert.equal(result.invalidated_at, null);
  assert.equal(result.last_error, null);
});

test('upsertCurrentBriefFromReadyGeneration: passes correct params to pg', async () => {
  const pg = createFakePg({ rows: [{ brief_status: 'ready' }] });
  await upsertCurrentBriefFromReadyGeneration(pg, {
    matchId: 5,
    generationId: 11,
    headline: 'H',
    brief: 'B',
    riskNote: null,
  });

  assert.equal(pg.calls.length, 1);
  assert.equal(pg.calls[0].params[0], 5);
  assert.equal(pg.calls[0].params[7], 'H');
  assert.equal(pg.calls[0].params[8], 'B');
  assert.equal(pg.calls[0].params[9], null);
  assert.equal(pg.calls[0].params[15], 11);
});

test('upsertCurrentBriefFromReadyGeneration: query clears invalidated_at and error fields', async () => {
  const pg = createFakePg({ rows: [{ brief_status: 'ready' }] });
  await upsertCurrentBriefFromReadyGeneration(pg, {
    matchId: 1,
    generationId: 1,
    headline: 'H',
    brief: 'B',
  });

  const query = pg.calls[0].query;
  assert.ok(query.includes("brief_status = 'ready'"), 'should set brief_status to ready');
  assert.ok(query.includes("last_generation_status = 'ready'"), 'should set last_generation_status to ready');
  assert.ok(query.includes('invalidated_at = NULL'), 'should clear invalidated_at');
  assert.ok(query.includes('last_error = NULL'), 'should clear last_error');
  assert.ok(query.includes('invalidated_reason = NULL'), 'should clear invalidated_reason');
  assert.ok(query.includes('stale_since = NULL'), 'should clear stale_since');
  assert.ok(query.includes('last_skip_reason = NULL'), 'should clear last_skip_reason');
});

test('upsertCurrentBriefFromReadyGeneration: returns null when pg returns empty', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await upsertCurrentBriefFromReadyGeneration(pg, {
    matchId: 1,
    generationId: 1,
    headline: 'H',
    brief: 'B',
  });
  assert.equal(result, null);
});

// --- upsertNoopCurrentRow ---

test('upsertNoopCurrentRow: inserts a noop row with correct params', async () => {
  const pg = createFakePg({ rows: [{ status: 'failed' }] });
  await upsertNoopCurrentRow(pg, {
    matchId: 9,
    status: 'failed',
    generationId: 3,
    lastError: 'Timeout',
    skipReason: null,
  });

  assert.equal(pg.calls.length, 1);
  assert.deepEqual(pg.calls[0].params, [9, 'failed', 3, 'Timeout', null, 'skip', null, '{}']);
});

test('upsertNoopCurrentRow: query has upsert logic guarded against overwriting real briefs', async () => {
  const pg = createFakePg({ rows: [{ status: 'skipped' }] });
  await upsertNoopCurrentRow(pg, {
    matchId: 1,
    status: 'skipped',
    generationId: 1,
    skipReason: 'insufficient_data',
  });

  const query = pg.calls[0].query;
  assert.ok(query.includes('ON CONFLICT'), 'should have upsert logic');
  assert.ok(query.includes("brief_status NOT IN ('ready', 'stale')"), 'should guard against overwriting real briefs');
  assert.ok(query.includes("VALUES ($1, 'missing', $2"), 'should persist missing brief_status with generation status separately');
});

test('upsertNoopCurrentRow: returns null when pg returns empty (conflict on ready/stale row)', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await upsertNoopCurrentRow(pg, {
    matchId: 1,
    status: 'failed',
    generationId: 5,
    lastError: 'error',
  });
  assert.equal(result, null);
});

// --- markCurrentBriefStaleAfterFailure ---

test('markCurrentBriefStaleAfterFailure: updates existing ready/stale row to stale', async () => {
  const pg = createFakePg({ rows: [{ affected: 1 }] });
  await markCurrentBriefStaleAfterFailure(pg, {
    matchId: 42,
    generationId: 5,
    errorMessage: 'Claude timeout',
  });

  assert.equal(pg.calls.length, 1);
  const { query, params } = pg.calls[0];
  assert.ok(query.includes('UPDATE'), 'should be an UPDATE query');
  assert.ok(query.includes("brief_status = 'stale'"), 'should set stale brief_status');
  assert.ok(query.includes("last_generation_status = 'failed'"), 'should track failed generation status');
  assert.ok(query.includes('COALESCE(invalidated_at, NOW())'), 'should preserve existing invalidated_at');
  assert.ok(query.includes('COALESCE(stale_since, NOW())'), 'should preserve existing stale_since');
  assert.equal(params[0], 42);
  assert.equal(params[1], 'Claude timeout');
  assert.equal(params[2], 5);
});

test('markCurrentBriefStaleAfterFailure: does not call insert when existing row matched', async () => {
  const pg = createFakePg({ rows: [{ affected: 1 }] });
  await markCurrentBriefStaleAfterFailure(pg, {
    matchId: 1,
    generationId: 1,
    errorMessage: null,
  });

  assert.equal(pg.calls.length, 1, 'only one query when update matched a row');
});

test('markCurrentBriefStaleAfterFailure: creates noop row when no existing brief', async () => {
  let callIndex = 0;
  const pg = createFakePg({
    handler: () => {
      callIndex++;
      if (callIndex === 1) return [];
      return [{ brief_status: 'missing', last_generation_status: 'failed' }];
    },
  });

  await markCurrentBriefStaleAfterFailure(pg, {
    matchId: 5,
    generationId: 10,
    errorMessage: 'Timeout',
  });

  assert.equal(pg.calls.length, 2, 'should make two queries when no row exists');
  assert.ok(pg.calls[0].query.includes('UPDATE'), 'first query should be UPDATE');
  assert.ok(pg.calls[1].query.includes('INSERT'), 'second query should be INSERT');
  assert.equal(pg.calls[1].params[1], 'failed', 'insert should record failed generation status');
  assert.equal(pg.calls[1].params[3], 'Timeout', 'insert should record error message');
});

test('markCurrentBriefStaleAfterFailure: noop row insert has null skip_reason', async () => {
  let callIndex = 0;
  const pg = createFakePg({ handler: () => { callIndex++; return callIndex === 1 ? [] : [{}]; } });

  await markCurrentBriefStaleAfterFailure(pg, {
    matchId: 3,
    generationId: 2,
    errorMessage: 'err',
  });

  assert.equal(pg.calls[1].params[4], null, 'skip_reason should be null for failure');
});

// --- markCurrentBriefStaleAfterSkip ---

test('markCurrentBriefStaleAfterSkip: updates existing row to stale with skip reason', async () => {
  const pg = createFakePg({ rows: [{ affected: 1 }] });
  await markCurrentBriefStaleAfterSkip(pg, {
    matchId: 20,
    generationId: 8,
    skipReason: 'insufficient_data',
  });

  assert.equal(pg.calls.length, 1);
  const { query, params } = pg.calls[0];
  assert.ok(query.includes('UPDATE'), 'should be an UPDATE query');
  assert.ok(query.includes("brief_status = 'stale'"), 'should set stale brief_status');
  assert.ok(query.includes("last_generation_status = 'skipped'"), 'should track skipped generation status');
  assert.ok(query.includes('invalidated_reason'), 'should update invalidated_reason');
  assert.ok(query.includes('last_error = NULL'), 'should clear last_error');
  assert.ok(query.includes('last_skip_reason = $2'), 'should persist last_skip_reason');
  assert.equal(params[0], 20);
  assert.equal(params[1], 'insufficient_data');
  assert.equal(params[2], 8);
});

test('markCurrentBriefStaleAfterSkip: creates noop row when no existing brief', async () => {
  let callIndex = 0;
  const pg = createFakePg({
    handler: () => {
      callIndex++;
      if (callIndex === 1) return [];
      return [{ brief_status: 'missing', last_generation_status: 'skipped' }];
    },
  });

  await markCurrentBriefStaleAfterSkip(pg, {
    matchId: 7,
    generationId: 4,
    skipReason: 'no_source',
  });

  assert.equal(pg.calls.length, 2, 'should make two queries when no row exists');
  assert.ok(pg.calls[1].query.includes('INSERT'), 'second query should be INSERT');
  assert.equal(pg.calls[1].params[1], 'skipped', 'insert should record skipped generation status');
  assert.equal(pg.calls[1].params[3], null, 'last_error should be null for skips');
  assert.equal(pg.calls[1].params[4], 'no_source', 'insert should record skip reason');
});

test('markCurrentBriefStaleAfterSkip: does not call insert when existing row matched', async () => {
  const pg = createFakePg({ rows: [{ affected: 1 }] });
  await markCurrentBriefStaleAfterSkip(pg, {
    matchId: 1,
    generationId: 1,
    skipReason: null,
  });

  assert.equal(pg.calls.length, 1, 'only one query when update matched a row');
});
