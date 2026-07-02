const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryStore } = require('../../webapp/services/dailyPickStore');

// --- getUserDailyPicks ---

test('getUserDailyPicks: returns null slots when store is empty', async () => {
  const store = createMemoryStore();
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.deepEqual(result, { today: null, tomorrow: null });
});

test('getUserDailyPicks: returns today slot by slot_date', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.equal(result.today.match_id, 10);
  assert.equal(result.tomorrow, null);
});

test('getUserDailyPicks: returns tomorrow slot by slot_date', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-03', match_id: 20 });
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.equal(result.today, null);
  assert.equal(result.tomorrow.match_id, 20);
});

test('getUserDailyPicks: returns both slots when both exist', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-03', match_id: 20 });
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.equal(result.today.match_id, 10);
  assert.equal(result.tomorrow.match_id, 20);
});

test('getUserDailyPicks: isolates picks by user_id', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 2, slot_date: '2026-07-02', match_id: 99 });
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.equal(result.today, null);
});

// --- upsertMatchSnapshot / getExistingMatchSnapshots ---

test('getExistingMatchSnapshots: returns empty map when no snapshots', async () => {
  const store = createMemoryStore();
  const result = await store.getExistingMatchSnapshots({ matchIds: [1, 2] });
  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
});

test('upsertMatchSnapshot: stores snapshot and retrieves it by match_id', async () => {
  const store = createMemoryStore();
  await store.upsertMatchSnapshot({ match_id: 42, analysis: 'some data' });
  const result = await store.getExistingMatchSnapshots({ matchIds: [42] });
  assert.equal(result.size, 1);
  assert.equal(result.get(42).analysis, 'some data');
});

test('upsertMatchSnapshot: overwrites existing snapshot for same match_id', async () => {
  const store = createMemoryStore();
  await store.upsertMatchSnapshot({ match_id: 42, analysis: 'old' });
  await store.upsertMatchSnapshot({ match_id: 42, analysis: 'new' });
  const result = await store.getExistingMatchSnapshots({ matchIds: [42] });
  assert.equal(result.get(42).analysis, 'new');
});

test('getExistingMatchSnapshots: returns only requested match_ids', async () => {
  const store = createMemoryStore();
  await store.upsertMatchSnapshot({ match_id: 1 });
  await store.upsertMatchSnapshot({ match_id: 2 });
  await store.upsertMatchSnapshot({ match_id: 3 });
  const result = await store.getExistingMatchSnapshots({ matchIds: [1, 3] });
  assert.equal(result.size, 2);
  assert.ok(result.has(1));
  assert.ok(result.has(3));
  assert.equal(result.has(2), false);
});

// --- upsertUserSlot ---

test('upsertUserSlot: returns stored slot', async () => {
  const store = createMemoryStore();
  const saved = await store.upsertUserSlot({ user_id: 5, slot_date: '2026-07-02', match_id: 77 });
  assert.equal(saved.user_id, 5);
  assert.equal(saved.match_id, 77);
});

test('upsertUserSlot: overwrites slot for same user_id and slot_date', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 99 });
  const result = await store.getUserDailyPicks({ userId: 1, todayDate: '2026-07-02', tomorrowDate: '2026-07-03' });
  assert.equal(result.today.match_id, 99);
});

// --- getUnsettledPredictions / upsertMatchResult ---

test('getUnsettledPredictions: returns slots without a match result', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  await store.upsertUserSlot({ user_id: 2, slot_date: '2026-07-02', match_id: 20 });
  const unsettled = await store.getUnsettledPredictions();
  assert.equal(unsettled.length, 2);
});

test('getUnsettledPredictions: excludes slots whose match has a result', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  await store.upsertMatchResult({ match_id: 10, outcome: 'won' });
  const unsettled = await store.getUnsettledPredictions();
  assert.equal(unsettled.length, 0);
});

test('getUnsettledPredictions: returns only unsettled when results are mixed', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 10 });
  await store.upsertUserSlot({ user_id: 2, slot_date: '2026-07-02', match_id: 20 });
  await store.upsertMatchResult({ match_id: 10, outcome: 'won' });
  const unsettled = await store.getUnsettledPredictions();
  assert.equal(unsettled.length, 1);
  assert.equal(unsettled[0].match_id, 20);
});

test('upsertMatchResult: stores result and settles matching predictions', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 42 });
  await store.upsertMatchResult({ match_id: 42, outcome: 'won', score: '2:1' });
  const unsettled = await store.getUnsettledPredictions();
  assert.equal(unsettled.length, 0);
});

test('upsertMatchResult: overwrites existing result idempotently', async () => {
  const store = createMemoryStore();
  await store.upsertUserSlot({ user_id: 1, slot_date: '2026-07-02', match_id: 42 });
  await store.upsertMatchResult({ match_id: 42, outcome: 'won' });
  const saved = await store.upsertMatchResult({ match_id: 42, outcome: 'lost', score: '0:3' });
  assert.equal(saved.outcome, 'lost');
  assert.equal(saved.score, '0:3');
  const unsettled = await store.getUnsettledPredictions();
  assert.equal(unsettled.length, 0);
});
