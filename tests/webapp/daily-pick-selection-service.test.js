const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectUserSlotForDate,
  buildUserSelections,
} = require('../../webapp/services/dailyPickSelectionService');

const TODAY = '2026-07-02';
const TOMORROW = '2026-07-03';

function makeMatch(overrides) {
  return {
    id: 'match-1',
    starts_at: `${TODAY}T18:00:00+03:00`,
    date_msk: TODAY,
    home_team: 'Team A',
    away_team: 'Team B',
    odds: { home: 1.90, draw: 3.50, away: 2.00 },
    popularity_hints: {},
    ...overrides,
  };
}

// --- selectUserSlotForDate ---

test('selectUserSlotForDate: returns null for empty matches array', () => {
  const result = selectUserSlotForDate({ userId: 1, matches: [], targetDate: TODAY });
  assert.equal(result, null);
});

test('selectUserSlotForDate: returns null for null/undefined matches', () => {
  assert.equal(selectUserSlotForDate({ userId: 1, matches: null, targetDate: TODAY }), null);
  assert.equal(selectUserSlotForDate({ userId: 1, matches: undefined, targetDate: TODAY }), null);
});

test('selectUserSlotForDate: returns slot with correct shape', () => {
  const match = makeMatch({ id: 'mx1' });
  const slot = selectUserSlotForDate({ userId: 7, matches: [match], targetDate: TODAY });
  assert.equal(slot.user_id, 7);
  assert.equal(slot.slot_date, TODAY);
  assert.equal(slot.match_id, 'mx1');
});

test('selectUserSlotForDate: picks best match by ranking when multiple candidates', () => {
  const popular = makeMatch({ id: 'pop', popularity_hints: { league_tier: 1 } });
  const lesser = makeMatch({ id: 'low', popularity_hints: { league_tier: 3 } });
  const slot = selectUserSlotForDate({ userId: 1, matches: [lesser, popular], targetDate: TODAY });
  assert.equal(slot.match_id, 'pop');
});

// --- buildUserSelections ---

test('buildUserSelections: two users can receive the same match', () => {
  const match = makeMatch({ id: 'shared', starts_at: `${TODAY}T18:00:00+03:00` });
  const users = [{ id: 1 }, { id: 2 }];
  const candidatesByUserId = { 1: [match], 2: [match] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 2);
  assert.equal(userSlots[0].match_id, 'shared');
  assert.equal(userSlots[1].match_id, 'shared');
});

test('buildUserSelections: users with different candidates get different matches', () => {
  const matchA = makeMatch({ id: 'matchA', starts_at: `${TODAY}T18:00:00+03:00`, popularity_hints: { league_tier: 1 } });
  const matchB = makeMatch({ id: 'matchB', starts_at: `${TODAY}T18:00:00+03:00`, popularity_hints: { league_tier: 2 } });
  const users = [{ id: 1 }, { id: 2 }];
  const candidatesByUserId = { 1: [matchA], 2: [matchB] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 2);
  const slotUser1 = userSlots.find(s => s.user_id === 1);
  const slotUser2 = userSlots.find(s => s.user_id === 2);
  assert.equal(slotUser1.match_id, 'matchA');
  assert.equal(slotUser2.match_id, 'matchB');
});

test('buildUserSelections: today and tomorrow are selected independently', () => {
  const todayMatch = makeMatch({ id: 'today-match', starts_at: `${TODAY}T18:00:00+03:00` });
  const tomorrowMatch = makeMatch({ id: 'tomorrow-match', starts_at: `${TOMORROW}T18:00:00+03:00`, date_msk: TOMORROW });
  const users = [{ id: 1 }];
  const candidatesByUserId = { 1: [todayMatch, tomorrowMatch] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 2);
  const todaySlot = userSlots.find(s => s.slot_date === TODAY);
  const tomorrowSlot = userSlots.find(s => s.slot_date === TOMORROW);
  assert.equal(todaySlot.match_id, 'today-match');
  assert.equal(tomorrowSlot.match_id, 'tomorrow-match');
});

test('buildUserSelections: no slot created when user has no matches for a date', () => {
  const tomorrowMatch = makeMatch({ id: 'tm', starts_at: `${TOMORROW}T18:00:00+03:00`, date_msk: TOMORROW });
  const users = [{ id: 1 }];
  const candidatesByUserId = { 1: [tomorrowMatch] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 1);
  assert.equal(userSlots[0].slot_date, TOMORROW);
});

test('buildUserSelections: no slots at all when user has no candidates', () => {
  const users = [{ id: 1 }];
  const candidatesByUserId = { 1: [] };

  const { userSlots, uniqueMatchIds } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 0);
  assert.equal(uniqueMatchIds.length, 0);
});

test('buildUserSelections: uniqueMatchIds deduped when multiple users pick the same match', () => {
  const match = makeMatch({ id: 'dup', starts_at: `${TODAY}T18:00:00+03:00` });
  const users = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const candidatesByUserId = { 1: [match], 2: [match], 3: [match] };

  const { userSlots, uniqueMatchIds } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 3);
  assert.equal(uniqueMatchIds.length, 1);
  assert.equal(uniqueMatchIds[0], 'dup');
});

test('buildUserSelections: uniqueMatchIds contains all distinct selected matches', () => {
  const m1 = makeMatch({ id: 'id1', starts_at: `${TODAY}T18:00:00+03:00` });
  const m2 = makeMatch({ id: 'id2', starts_at: `${TODAY}T18:00:00+03:00` });
  const users = [{ id: 1 }, { id: 2 }];
  const candidatesByUserId = { 1: [m1], 2: [m2] };

  const { uniqueMatchIds } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(uniqueMatchIds.length, 2);
  assert.ok(uniqueMatchIds.includes('id1'));
  assert.ok(uniqueMatchIds.includes('id2'));
});

test('buildUserSelections: returns empty result for empty users list', () => {
  const { userSlots, uniqueMatchIds } = buildUserSelections({
    users: [],
    candidatesByUserId: {},
    todayDate: TODAY,
    tomorrowDate: TOMORROW,
  });
  assert.equal(userSlots.length, 0);
  assert.equal(uniqueMatchIds.length, 0);
});

test('buildUserSelections: user object with user_id field works as key', () => {
  const match = makeMatch({ id: 'mx', starts_at: `${TODAY}T18:00:00+03:00` });
  const users = [{ user_id: 5 }];
  const candidatesByUserId = { 5: [match] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 1);
  assert.equal(userSlots[0].user_id, 5);
  assert.equal(userSlots[0].match_id, 'mx');
});

test('buildUserSelections: 21:00 UTC = 00:00 MSK next day goes to tomorrow slot, not today', () => {
  // TODAY=2026-07-02; 2026-07-02T21:00:00Z = 2026-07-03T00:00:00+03:00 → date_msk = TOMORROW
  const match = makeMatch({
    id: 'midnight-msk',
    starts_at: `${TODAY}T21:00:00.000Z`,
    date_msk: TOMORROW,
  });
  const users = [{ id: 1 }];
  const candidatesByUserId = { 1: [match] };

  const { userSlots } = buildUserSelections({ users, candidatesByUserId, todayDate: TODAY, tomorrowDate: TOMORROW });

  assert.equal(userSlots.length, 1, 'must create exactly one slot');
  assert.equal(userSlots[0].slot_date, TOMORROW, 'midnight MSK match belongs to tomorrow, not today');
});
