const test = require('node:test');
const assert = require('node:assert/strict');

const { runDailyPickBatch } = require('../../webapp/services/dailyPickBatchService');
const { createMemoryStore } = require('../../webapp/services/dailyPickStore');

function createFakePg({ systemId = 1, sportId = 10, tournamentId = 100, sourceId = 'src-1' } = {}) {
  const calls = [];
  return {
    calls,
    async connection(sql, params) {
      calls.push({ sql, params });
      if (/external\.system/.test(sql)) return systemId != null ? [{ system_id: systemId }] : [];
      if (/public\.sport/.test(sql)) return sportId != null ? [{ sport_id: sportId }] : [];
      if (/public_tournament/.test(sql)) return tournamentId != null ? [{ tournament_id: tournamentId }] : [];
      if (/match_create/.test(sql)) return [{ id: 'db-match-1' }];
      if (/match_source_create/.test(sql)) return sourceId != null ? [{ id: sourceId }] : [];
      if (/match_analysis_create/.test(sql)) return [{ id: 'db-analysis-1' }];
      return [];
    },
  };
}

const TODAY = '2026-07-02';
const TOMORROW = '2026-07-03';

function makeCandidate({ id, date }) {
  return {
    id: String(id),
    match_id: String(id),
    starts_at: `${date}T18:00:00+03:00`,
    date_msk: date,
    home_team: 'Team A',
    away_team: 'Team B',
    odds: { home: 1.9, draw: 3.5, away: 2.0 },
    popularity_hints: { league_tier: 1 },
  };
}

function trackingStore(store) {
  const calls = { upsertMatchSnapshot: [], upsertUserSlot: [] };
  return {
    ...store,
    async upsertMatchSnapshot(snapshot) {
      calls.upsertMatchSnapshot.push(snapshot);
      return store.upsertMatchSnapshot(snapshot);
    },
    async upsertUserSlot(slot) {
      calls.upsertUserSlot.push(slot);
      return store.upsertUserSlot(slot);
    },
    calls,
  };
}

// --- happy path ---

test('happy path: two users each with one match, all new snapshots', async () => {
  const store = trackingStore(createMemoryStore());
  const users = [{ id: 1 }, { id: 2 }];

  const candidateLoader = async ({ user, targetDate }) => {
    if (targetDate === TODAY) {
      return [makeCandidate({ id: `m${user.id ?? user.user_id}`, date: TODAY })];
    }
    return [];
  };

  let analysisLoaderCalled = false;
  const analysisLoader = async ({ uniqueMatchIds }) => {
    analysisLoaderCalled = true;
    return uniqueMatchIds.map(id => ({ match_id: id, analysis: 'ai-data' }));
  };

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.users_processed, 2);
  assert.equal(summary.slots_created, 2);
  assert.equal(summary.unique_matches_selected, 2);
  assert.equal(summary.snapshots_created, 2);
  assert.ok(analysisLoaderCalled);
  assert.equal(store.calls.upsertUserSlot.length, 2);
  assert.equal(store.calls.upsertMatchSnapshot.length, 2);
});

// --- shared match deduplication ---

test('shared match: two users picking same match produces one snapshot', async () => {
  const store = trackingStore(createMemoryStore());
  const users = [{ id: 1 }, { id: 2 }];
  const sharedMatch = makeCandidate({ id: 'shared-m1', date: TODAY });

  const candidateLoader = async ({ targetDate }) => {
    if (targetDate === TODAY) return [sharedMatch];
    return [];
  };
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id, analysis: 'shared-analysis' }));

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.unique_matches_selected, 1);
  assert.equal(summary.snapshots_created, 1);
  assert.equal(summary.slots_created, 2);
  assert.equal(store.calls.upsertMatchSnapshot.length, 1);
});

// --- existing snapshot skips analysis ---

test('existing snapshot: analysisLoader not called for already-snapshotted match', async () => {
  const base = createMemoryStore();
  await base.upsertMatchSnapshot({ match_id: 'existing-m1', analysis: 'cached' });
  const store = trackingStore(base);

  const users = [{ id: 1 }];
  const candidateLoader = async ({ targetDate }) => {
    if (targetDate === TODAY) return [makeCandidate({ id: 'existing-m1', date: TODAY })];
    return [];
  };

  const analysisLoaderCalls = [];
  const analysisLoader = async ({ uniqueMatchIds }) => {
    analysisLoaderCalls.push(uniqueMatchIds);
    return uniqueMatchIds.map(id => ({ match_id: id }));
  };

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.snapshots_created, 0);
  assert.equal(analysisLoaderCalls.length, 0, 'analysisLoader must not be called for existing snapshot');
  assert.equal(summary.slots_created, 1);
});

// --- no candidates = no slot ---

test('no candidates: no slot created and analysisLoader not called', async () => {
  const store = trackingStore(createMemoryStore());
  const users = [{ id: 1 }];
  const analysisLoaderCalls = [];
  const analysisLoader = async ({ uniqueMatchIds }) => {
    analysisLoaderCalls.push(uniqueMatchIds);
    return [];
  };

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader: async () => [],
    analysisLoader,
  });

  assert.equal(summary.slots_created, 0);
  assert.equal(summary.unique_matches_selected, 0);
  assert.equal(summary.snapshots_created, 0);
  assert.equal(store.calls.upsertUserSlot.length, 0);
  assert.equal(analysisLoaderCalls.length, 0);
});

// --- users as async loader callback ---

test('users as async loader: resolved and processed correctly', async () => {
  const store = createMemoryStore();
  const usersLoader = async () => [{ id: 7 }];
  const candidateLoader = async ({ targetDate }) => {
    if (targetDate === TODAY) return [makeCandidate({ id: 'm7', date: TODAY })];
    return [];
  };
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id }));

  const summary = await runDailyPickBatch({
    store,
    users: usersLoader,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.users_processed, 1);
  assert.equal(summary.slots_created, 1);
});

// --- summary counters ---

test('summary counters: two users, two dates produce correct totals', async () => {
  const store = trackingStore(createMemoryStore());
  const users = [{ id: 1 }, { id: 2 }];

  const candidateLoader = async ({ user, targetDate }) => {
    const uid = user.id ?? user.user_id;
    return [makeCandidate({ id: `m${uid}-${targetDate}`, date: targetDate })];
  };
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id }));

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  // 2 users × 2 dates = 4 slots, 4 unique matches, 4 new snapshots
  assert.equal(summary.users_processed, 2);
  assert.equal(summary.slots_created, 4);
  assert.equal(summary.unique_matches_selected, 4);
  assert.equal(summary.snapshots_created, 4);
});

// --- mixed existing / new snapshots ---

test('mixed snapshots: only missing IDs sent to analysisLoader', async () => {
  const base = createMemoryStore();
  await base.upsertMatchSnapshot({ match_id: 'm-old', analysis: 'old-cached' });
  const store = trackingStore(base);

  const users = [{ id: 1 }, { id: 2 }];
  const candidateLoader = async ({ user, targetDate }) => {
    if (targetDate !== TODAY) return [];
    const uid = user.id ?? user.user_id;
    if (uid === 1) return [makeCandidate({ id: 'm-old', date: TODAY })];
    return [makeCandidate({ id: 'm-new', date: TODAY })];
  };

  const analysisLoaderIds = [];
  const analysisLoader = async ({ uniqueMatchIds }) => {
    analysisLoaderIds.push(...uniqueMatchIds);
    return uniqueMatchIds.map(id => ({ match_id: id }));
  };

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.snapshots_created, 1, 'only the new match snapshot is created');
  assert.deepEqual(analysisLoaderIds, ['m-new'], 'only missing ID sent to analysisLoader');
  assert.equal(summary.slots_created, 2);
  assert.equal(store.calls.upsertMatchSnapshot.length, 1);
});

// --- analysisLoader returning a Map ---

test('analysisLoader returning Map: snapshots saved correctly', async () => {
  const store = createMemoryStore();
  const users = [{ id: 1 }];
  const candidateLoader = async ({ targetDate }) => {
    if (targetDate === TODAY) return [makeCandidate({ id: 'map-m1', date: TODAY })];
    return [];
  };
  const analysisLoader = async ({ uniqueMatchIds }) => {
    const result = new Map();
    for (const id of uniqueMatchIds) result.set(id, { match_id: id, analysis: 'from-map' });
    return result;
  };

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    analysisLoader,
  });

  assert.equal(summary.snapshots_created, 1);
});

test('default analysis path: batch uses analyzeMatches when analysisLoader is omitted', async () => {
  const store = trackingStore(createMemoryStore());
  const users = [{ id: 1 }];
  const candidate = {
    ...makeCandidate({ id: 'm-default', date: TODAY }),
    match_slug: 'team-a-vs-team-b',
  };

  const candidateLoader = async ({ targetDate }) => {
    if (targetDate === TODAY) return [candidate];
    return [];
  };

  const sourceBuilder = async (match) => ({
    match_id: match.match_id,
    match_slug: match.match_slug,
    source_mode: 'full',
    source_hash: 'hash-default',
  });

  const generator = async () => ({
    status: 'ready',
    output: {
      headline: 'Daily pick headline',
      brief: 'Daily pick brief',
      risk_note: 'Daily pick risk',
    },
    model_name: 'test-model',
    prompt_version: 'daily-pick-v1',
  });

  const summary = await runDailyPickBatch({
    store,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    sourceBuilder,
    generator,
    modelName: 'test-model',
    promptVersion: 'daily-pick-v1',
  });

  assert.equal(summary.users_processed, 1);
  assert.equal(summary.slots_created, 1);
  assert.equal(summary.unique_matches_selected, 1);
  assert.equal(summary.snapshots_created, 1);
  assert.equal(store.calls.upsertMatchSnapshot.length, 1);
  assert.equal(store.calls.upsertMatchSnapshot[0].status, 'ready');
  assert.equal(store.calls.upsertMatchSnapshot[0].headline, 'Daily pick headline');
  assert.deepEqual(store.calls.upsertMatchSnapshot[0].source_payload, {
    match_id: 'm-default',
    match_slug: 'team-a-vs-team-b',
    source_mode: 'full',
    source_hash: 'hash-default',
  });
});

// --- DB persistence via default analysis path ---

test('pg happy path: default analysis path persists to DB when sourceBuilder/generator are used', async () => {
  const store = trackingStore(createMemoryStore());
  const pg = createFakePg();
  const users = [{ id: 1 }];

  const candidate = {
    ...makeCandidate({ id: 'db-default-m1', date: TODAY }),
    match_slug: 'db-default-m1',
    sport_slug: 'soccer',
    external_league_id: '42',
  };

  const candidateLoader = async ({ targetDate }) => targetDate === TODAY ? [candidate] : [];
  const sourceBuilder = async (match) => ({
    match_id: match.match_id,
    match_slug: match.match_slug,
    source_mode: 'full',
    source_hash: 'hash-default-db',
  });
  const generator = async () => ({
    status: 'ready',
    output: {
      headline: 'DB default headline',
      brief: 'DB default brief',
      risk_note: 'DB default risk',
      recommended_bets: [],
    },
    model_name: 'test-model',
    prompt_version: 'daily-pick-v1',
  });

  const summary = await runDailyPickBatch({
    store,
    pg,
    users,
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
    candidateLoader,
    sourceBuilder,
    generator,
    modelName: 'test-model',
    promptVersion: 'daily-pick-v1',
  });

  assert.equal(summary.snapshots_created, 1);
  const sqlCalls = pg.calls.map(c => c.sql);
  assert.ok(sqlCalls.some(s => /match_create/.test(s)), 'should call match_create');
  assert.ok(sqlCalls.some(s => /match_source_create/.test(s)), 'should call match_source_create');
  assert.ok(sqlCalls.some(s => /match_analysis_create/.test(s)), 'should call match_analysis_create');
});

// --- DB persistence: happy path ---

test('pg happy path: persistBundleSnapshot and persistAnalysisSnapshot called when pg + source_payload present', async () => {
  const store = trackingStore(createMemoryStore());
  const pg = createFakePg();
  const users = [{ id: 1 }];

  const candidate = {
    ...makeCandidate({ id: 'db-m1', date: TODAY }),
    sport_slug: 'football',
    external_league_id: '42',
  };

  const candidateLoader = async ({ targetDate }) => targetDate === TODAY ? [candidate] : [];
  const sourcePayload = { source_mode: 'full', source_hash: 'hash-db-1' };
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id, status: 'ready', source_payload: sourcePayload }));

  const summary = await runDailyPickBatch({
    store, users, todayDate: TODAY, tomorrowDate: TOMORROW, candidateLoader, analysisLoader, pg,
  });

  assert.equal(summary.snapshots_created, 1);
  assert.equal(store.calls.upsertMatchSnapshot.length, 1);

  const sqlCalls = pg.calls.map(c => c.sql);
  assert.ok(sqlCalls.some(s => /external\.system/.test(s)), 'should resolve systemId');
  assert.ok(sqlCalls.some(s => /public\.sport/.test(s)), 'should resolve sportId');
  assert.ok(sqlCalls.some(s => /public_tournament/.test(s)), 'should resolve tournamentId');
  assert.ok(sqlCalls.some(s => /match_create/.test(s)), 'should call match_create');
  assert.ok(sqlCalls.some(s => /match_source_create/.test(s)), 'should call match_source_create');
  assert.ok(sqlCalls.some(s => /match_analysis_create/.test(s)), 'should call match_analysis_create');
});

// --- DB persistence: skip when systemId unresolved ---

test('pg skip: DB persistence skipped when systemId resolves null', async () => {
  const store = trackingStore(createMemoryStore());
  const pg = createFakePg({ systemId: null });
  const users = [{ id: 1 }];

  const candidate = {
    ...makeCandidate({ id: 'db-m2', date: TODAY }),
    sport_slug: 'football',
    external_league_id: '42',
  };

  const candidateLoader = async ({ targetDate }) => targetDate === TODAY ? [candidate] : [];
  const sourcePayload = { source_mode: 'full', source_hash: 'hash-db-2' };
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id, status: 'ready', source_payload: sourcePayload }));

  const summary = await runDailyPickBatch({
    store, users, todayDate: TODAY, tomorrowDate: TOMORROW, candidateLoader, analysisLoader, pg,
  });

  assert.equal(summary.snapshots_created, 1, 'in-memory snapshot still created');
  assert.equal(store.calls.upsertMatchSnapshot.length, 1);

  const sqlCalls = pg.calls.map(c => c.sql);
  assert.ok(sqlCalls.some(s => /external\.system/.test(s)), 'should try to resolve systemId');
  assert.ok(!sqlCalls.some(s => /match_create/.test(s)), 'should NOT call match_create when systemId missing');
  assert.ok(!sqlCalls.some(s => /match_analysis_create/.test(s)), 'should NOT call match_analysis_create when systemId missing');
});

// --- DB persistence: skip when source_payload missing ---

test('pg skip: DB persistence skipped when source_payload absent from snapshot', async () => {
  const store = trackingStore(createMemoryStore());
  const pg = createFakePg();
  const users = [{ id: 1 }];

  const candidate = {
    ...makeCandidate({ id: 'db-m3', date: TODAY }),
    sport_slug: 'football',
    external_league_id: '42',
  };

  const candidateLoader = async ({ targetDate }) => targetDate === TODAY ? [candidate] : [];
  // No source_payload on snapshot
  const analysisLoader = async ({ uniqueMatchIds }) =>
    uniqueMatchIds.map(id => ({ match_id: id, status: 'ready' }));

  const summary = await runDailyPickBatch({
    store, users, todayDate: TODAY, tomorrowDate: TOMORROW, candidateLoader, analysisLoader, pg,
  });

  assert.equal(summary.snapshots_created, 1, 'in-memory snapshot still created');
  assert.equal(pg.calls.length, 0, 'pg should not be called when source_payload is absent');
});
