const test = require('node:test');
const assert = require('node:assert/strict');

const { runDailyPickBatch } = require('../../webapp/services/dailyPickBatchService');
const { createMemoryStore } = require('../../webapp/services/dailyPickStore');

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
});
