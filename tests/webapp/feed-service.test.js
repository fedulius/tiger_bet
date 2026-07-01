const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeFeedItem,
  buildTimeWindowBounds,
  filterByWindow,
  filterByParams,
  buildFeedPayload,
  buildFeedPayloadFromNormalized,
} = require('../../webapp/services/feedService');
const {
  buildSnapshot,
  getOrBuildSnapshot,
  readCurrentSnapshot,
  readSnapshotByVersion,
  publishSnapshot,
  CURRENT_VERSION_KEY,
  LOCK_KEY,
  FRESH_TTL_MS,
  getSnapshotItemsKey,
  getSnapshotMetaKey,
} = require('../../webapp/services/feedSnapshotService');

// nowMs = 2026-06-23T15:00:00Z → Moscow 18:00
// Moscow today:    [2026-06-22T21:00:00Z, 2026-06-23T21:00:00Z)
// Moscow tomorrow: [2026-06-23T21:00:00Z, 2026-06-24T21:00:00Z)
const NOW_MS = new Date('2026-06-23T15:00:00.000Z').getTime();

const ITEMS = {
  past: {
    id: 'past-1',
    match: 'Past Match',
    sport_name: 'Футбол',
    country: '',
    league: 'Premier League',
    starts_at: '2026-06-23T10:00:00.000Z',
    main_thought: 'Past forecast',
    confidence: 60,
  },
  today1: {
    id: 'today-1',
    match: 'Arsenal vs Chelsea',
    sport_name: 'Футбол',
    country: 'Англия',
    league: 'Premier League',
    starts_at: '2026-06-23T17:00:00.000Z',
    main_thought: 'Арсенал выглядит сильнее',
    confidence: 70,
  },
  today2: {
    id: 'today-2',
    match: 'Real vs Barca',
    sport_name: 'Футбол',
    country: 'Испания',
    league: 'La Liga',
    starts_at: '2026-06-23T19:00:00.000Z',
    main_thought: 'Реал на своём поле',
    confidence: 65,
  },
  tomorrow1: {
    id: 'tomorrow-1',
    match: 'Djokovic vs Medvedev',
    sport_name: 'Теннис',
    country: 'Франция',
    league: 'ATP',
    starts_at: '2026-06-23T22:00:00.000Z',
    main_thought: 'Джокович в форме',
    confidence: 72,
  },
  tooFar: {
    id: 'too-far',
    match: 'Far Future',
    sport_name: 'Теннис',
    country: '',
    league: 'WTA',
    starts_at: '2026-06-25T00:00:00.000Z',
    main_thought: 'Будущий матч',
    confidence: 50,
  },
};

// ─── normalizeFeedItem ────────────────────────────────────────────────────────

test('normalizeFeedItem: returns valid feed item from raw match', () => {
  const item = normalizeFeedItem(ITEMS.today1);
  assert.ok(item);
  assert.equal(item.id, 'today-1');
  assert.equal(item.match_id, 'today-1');
  assert.equal(item.match, 'Arsenal vs Chelsea');
  assert.equal(item.sport, 'Футбол');
  assert.equal(item.country, 'Англия');
  assert.equal(item.league, 'Premier League');
  assert.equal(item.starts_at, '2026-06-23T17:00:00.000Z');
  assert.equal(typeof item.summary, 'string');
  assert.ok(item.primary_bet);
  assert.ok(item.primary_bet.forecast);
  assert.ok(typeof item.primary_bet.coeff === 'number');
  assert.equal(typeof item.primary_bet.description, 'string');
});

test('normalizeFeedItem: country is empty string when missing', () => {
  const item = normalizeFeedItem(ITEMS.past);
  assert.ok(item);
  assert.equal(item.country, '');
});

test('normalizeFeedItem: bets path prefers source_coeff over stale primary.coeff', () => {
  const raw = {
    id: 'coeff-stale',
    match: 'GamerLegion vs Astralis',
    sport_name: 'КС:ГО',
    country: '',
    league: 'ESL Pro League',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'Победа GamerLegion со счетом 2:0 с кэфом: 1.65',
    source_coeff: 1.65,
    confidence: 61,
    bets: [
      { type: 'primary', forecast: 'Победа GamerLegion со счетом 2:0 с кэфом: 1.65', coeff: 1.71, description: 'Базовый сценарий.' },
    ],
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'Победа GamerLegion со счетом 2:0', 'coeff phrase must be stripped from forecast text');
  assert.equal(item.primary_bet.coeff, 1.65, 'coeff must match source_coeff (editorial), not stale bets coeff');
});

test('normalizeFeedItem: main_thought path uses editorial_rationale as description, not forecast duplicate', () => {
  const raw = {
    id: 'rationale-test',
    match: 'A vs B',
    sport_name: 'Футбол',
    country: '',
    league: 'Test',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'Победа команды A',
    summary: 'Победа команды A',
    editorial_rationale: 'Команда A сильнее по форме последних 5 матчей.',
    source_coeff: 1.7,
    confidence: 60,
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'Победа команды A');
  assert.notEqual(item.primary_bet.description, item.primary_bet.forecast, 'description must not duplicate forecast');
  assert.equal(item.primary_bet.description, 'Команда A сильнее по форме последних 5 матчей.');
});

test('normalizeFeedItem: main_thought path description is empty when summary equals main_thought and no editorial_rationale', () => {
  const raw = {
    id: 'no-rationale',
    match: 'A vs B',
    sport_name: 'Футбол',
    country: '',
    league: 'Test',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'Победа команды A',
    summary: 'Победа команды A',
    confidence: 60,
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'Победа команды A');
  assert.equal(item.primary_bet.description, '', 'description should be empty to avoid duplicating forecast');
});

test('normalizeFeedItem: extracts primary_bet from bets array', () => {
  const raw = {
    id: 'bet-item',
    match: 'A vs B',
    sport_name: 'Теннис',
    country: '',
    league: 'ATP',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'ignored',
    confidence: 60,
    bets: [
      { type: 'primary', forecast: 'П1 победа', coeff: 1.75, description: 'Базовый вариант.' },
      { type: 'value', forecast: 'Альтернатива', coeff: 2.1, description: '' },
    ],
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'П1 победа');
  assert.equal(item.primary_bet.coeff, 1.75);
  assert.equal(item.primary_bet.description, 'Базовый вариант.');
});

test('normalizeFeedItem: strips coeff phrase from main_thought forecast and summary', () => {
  const raw = {
    id: 'strip-coeff',
    match: 'Тaусон vs Opponent',
    sport_name: 'Теннис',
    country: '',
    league: 'WTA',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'Победа Таусон с кэфом: 2.08',
    summary: 'Победа Таусон с кэфом: 2.08',
    source_coeff: 1.9,
    confidence: 60,
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'Победа Таусон', 'coeff phrase must be stripped from main_thought forecast');
  assert.equal(item.summary, 'Победа Таусон', 'coeff phrase must be stripped from summary');
  assert.equal(item.primary_bet.coeff, 1.9, 'coeff comes from source_coeff, not text');
});

test('normalizeFeedItem: strips integer coeff phrase from forecast and summary', () => {
  const raw = {
    id: 'strip-integer-coeff',
    match: 'Samuel vs Tirante',
    sport_name: 'Теннис',
    country: '',
    league: 'ATP',
    starts_at: '2026-06-23T20:00:00.000Z',
    main_thought: 'Победа Самуэля по геймам с форой (-2.5) с кэфом: 2',
    summary: 'Победа Самуэля по геймам с форой (-2.5) с кэфом: 2',
    source_coeff: 1.9,
    confidence: 60,
  };
  const item = normalizeFeedItem(raw);
  assert.ok(item);
  assert.equal(item.primary_bet.forecast, 'Победа Самуэля по геймам с форой (-2.5)');
  assert.equal(item.summary, 'Победа Самуэля по геймам с форой (-2.5)');
  assert.equal(item.primary_bet.coeff, 1.9);
});

test('normalizeFeedItem: returns null when id is missing', () => {
  const item = normalizeFeedItem({ match: 'X vs Y', starts_at: '2026-06-23T20:00:00Z', main_thought: 'ok', confidence: 60 });
  assert.equal(item, null);
});

test('normalizeFeedItem: returns null when starts_at is missing', () => {
  const item = normalizeFeedItem({ id: 'x', match: 'X vs Y', main_thought: 'ok', confidence: 60 });
  assert.equal(item, null);
});

test('normalizeFeedItem: returns null when no valid primary bet', () => {
  const item = normalizeFeedItem({ id: 'x', match: 'X vs Y', starts_at: '2026-06-23T20:00:00Z' });
  assert.equal(item, null);
});

// ─── buildTimeWindowBounds ────────────────────────────────────────────────────

test('buildTimeWindowBounds: today window is Moscow calendar day in UTC', () => {
  const bounds = buildTimeWindowBounds('today', NOW_MS);
  // Moscow today: June 23 00:00 Moscow = June 22 21:00 UTC → June 24 00:00 Moscow = June 23 21:00 UTC
  assert.equal(new Date(bounds.start).toISOString(), '2026-06-22T21:00:00.000Z');
  assert.equal(new Date(bounds.end).toISOString(), '2026-06-23T21:00:00.000Z');
});

test('buildTimeWindowBounds: tomorrow window follows today', () => {
  const bounds = buildTimeWindowBounds('tomorrow', NOW_MS);
  assert.equal(new Date(bounds.start).toISOString(), '2026-06-23T21:00:00.000Z');
  assert.equal(new Date(bounds.end).toISOString(), '2026-06-24T21:00:00.000Z');
});

test('buildTimeWindowBounds: all window spans today+tomorrow', () => {
  const bounds = buildTimeWindowBounds('all', NOW_MS);
  assert.equal(new Date(bounds.start).toISOString(), '2026-06-22T21:00:00.000Z');
  assert.equal(new Date(bounds.end).toISOString(), '2026-06-24T21:00:00.000Z');
});

// ─── filterByWindow ───────────────────────────────────────────────────────────

function makeItems(raws) {
  return raws.map(normalizeFeedItem).filter(Boolean);
}

test('filterByWindow: excludes past matches', () => {
  const items = makeItems([ITEMS.past, ITEMS.today1]);
  const result = filterByWindow(items, 'all', NOW_MS);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'today-1');
});

test('filterByWindow: all returns today and tomorrow matches', () => {
  const items = makeItems([ITEMS.past, ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1, ITEMS.tooFar]);
  const result = filterByWindow(items, 'all', NOW_MS);
  assert.equal(result.length, 3);
  const ids = result.map((i) => i.id);
  assert.ok(ids.includes('today-1'));
  assert.ok(ids.includes('today-2'));
  assert.ok(ids.includes('tomorrow-1'));
});

test('filterByWindow: today excludes tomorrow matches', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]);
  const result = filterByWindow(items, 'today', NOW_MS);
  assert.equal(result.length, 2);
  assert.ok(result.every((i) => ['today-1', 'today-2'].includes(i.id)));
});

test('filterByWindow: tomorrow excludes today matches', () => {
  const items = makeItems([ITEMS.today1, ITEMS.tomorrow1]);
  const result = filterByWindow(items, 'tomorrow', NOW_MS);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'tomorrow-1');
});

test('filterByWindow: excludes matches beyond tomorrow', () => {
  const items = makeItems([ITEMS.tomorrow1, ITEMS.tooFar]);
  const result = filterByWindow(items, 'all', NOW_MS);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'tomorrow-1');
});

// ─── filterByParams ───────────────────────────────────────────────────────────

test('filterByParams: filters by sport (case insensitive)', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]);
  const result = filterByParams(items, { sport: 'Теннис' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'tomorrow-1');
});

test('filterByParams: filters by league (case insensitive)', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2]);
  const result = filterByParams(items, { league: 'la liga' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'today-2');
});

test('filterByParams: filters by country', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]);
  const result = filterByParams(items, { country: 'Англия' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'today-1');
});

test('filterByParams: combined sport and league filters', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]);
  const result = filterByParams(items, { sport: 'Футбол', league: 'La Liga' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'today-2');
});

test('filterByParams: no filters returns all items', () => {
  const items = makeItems([ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]);
  const result = filterByParams(items, {});
  assert.equal(result.length, 3);
});

// ─── buildFeedPayload ─────────────────────────────────────────────────────────

test('buildFeedPayload: sorts items by starts_at ascending', () => {
  const rawItems = [ITEMS.today2, ITEMS.today1, ITEMS.tomorrow1];
  const payload = buildFeedPayload(rawItems, { nowMs: NOW_MS });
  const starts = payload.items.map((i) => i.starts_at);
  const sorted = [...starts].sort((a, b) => new Date(a) - new Date(b));
  assert.deepEqual(starts, sorted);
});

test('buildFeedPayload: paginates with limit and offset', () => {
  const rawItems = [ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1];
  const page1 = buildFeedPayload(rawItems, { nowMs: NOW_MS, limit: 2, offset: 0 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.next_offset, 2);
  assert.equal(page1.has_more, true);

  const page2 = buildFeedPayload(rawItems, { nowMs: NOW_MS, limit: 2, offset: 2 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.next_offset, 4);
  assert.equal(page2.has_more, false);
});

test('buildFeedPayload: default window=all', () => {
  const rawItems = [ITEMS.today1, ITEMS.tomorrow1, ITEMS.tooFar];
  const payload = buildFeedPayload(rawItems, { nowMs: NOW_MS });
  assert.equal(payload.window, 'all');
  assert.equal(payload.items.length, 2);
});

test('buildFeedPayload: response includes required fields', () => {
  const payload = buildFeedPayload([ITEMS.today1], { nowMs: NOW_MS });
  assert.ok(payload.generated_at);
  assert.equal(payload.window, 'all');
  assert.ok('filters' in payload);
  assert.ok(Array.isArray(payload.items));
  assert.equal(typeof payload.next_offset, 'number');
  assert.equal(typeof payload.has_more, 'boolean');
});

test('buildFeedPayload: filters object includes null for unset params', () => {
  const payload = buildFeedPayload([ITEMS.today1], { nowMs: NOW_MS });
  assert.equal(payload.filters.sport, null);
  assert.equal(payload.filters.country, null);
  assert.equal(payload.filters.league, null);
});

test('buildFeedPayload: empty result when all items are past', () => {
  const payload = buildFeedPayload([ITEMS.past], { nowMs: NOW_MS });
  assert.equal(payload.items.length, 0);
  assert.equal(payload.has_more, false);
});

test('buildFeedPayload: items include country even when empty', () => {
  const payload = buildFeedPayload([ITEMS.past, ITEMS.today1], { nowMs: NOW_MS });
  for (const item of payload.items) {
    assert.ok('country' in item);
  }
});

// ─── available_sports ─────────────────────────────────────────────────────────

test('buildFeedPayload: available_sports contains all sports in window', () => {
  const rawItems = [ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1];
  const payload = buildFeedPayload(rawItems, { nowMs: NOW_MS });
  assert.ok(Array.isArray(payload.available_sports));
  assert.deepEqual([...payload.available_sports].sort(), ['Теннис', 'Футбол']);
});

test('buildFeedPayload: available_sports includes sports from all pages, not just page 1', () => {
  const rawItems = [ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1];
  const page1 = buildFeedPayload(rawItems, { nowMs: NOW_MS, limit: 2, offset: 0 });
  // page 1 items are only football, but available_sports should still include Tennis
  assert.ok(page1.available_sports.includes('Теннис'), 'Теннис must appear even though it is on page 2');
  assert.ok(page1.available_sports.includes('Футбол'));
});

test('buildFeedPayload: available_sports is not filtered by active sport param', () => {
  const rawItems = [ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1];
  const payload = buildFeedPayload(rawItems, { nowMs: NOW_MS, sport: 'Футбол' });
  // items are football-only, but available_sports should still show Tennis
  assert.ok(payload.available_sports.includes('Теннис'), 'Теннис must appear even when sport=Футбол filter is active');
  assert.equal(payload.items.every((i) => i.sport === 'Футбол'), true);
});

test('buildFeedPayload: available_sports excludes past matches outside window', () => {
  const rawItems = [ITEMS.past, ITEMS.tooFar, ITEMS.today1];
  const payload = buildFeedPayload(rawItems, { nowMs: NOW_MS });
  // past and tooFar are outside the window, only today1 (Футбол) is included
  assert.deepEqual(payload.available_sports, ['Футбол']);
});

test('buildFeedPayloadFromNormalized: available_sports present in response', () => {
  const normalized = [ITEMS.today1, ITEMS.today2, ITEMS.tomorrow1]
    .map(normalizeFeedItem)
    .filter(Boolean);
  const payload = buildFeedPayloadFromNormalized(normalized, { nowMs: NOW_MS });
  assert.ok(Array.isArray(payload.available_sports));
  assert.ok(payload.available_sports.includes('Футбол'));
  assert.ok(payload.available_sports.includes('Теннис'));
});

function makeFakeRedis({ store = {} } = {}) {
  return {
    store,
    async get(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async set(key, value, opts = {}) {
      if (opts && opts.NX && Object.prototype.hasOwnProperty.call(store, key)) {
        return null;
      }
      store[key] = value;
      return 'OK';
    },
    async del(...keys) {
      for (const key of keys.flat()) delete store[key];
    },
  };
}

// ─── snapshot service ──────────────────────────────────────────────────────────

test('publishSnapshot: stores immutable versioned items/meta and switches current version', async () => {
  const redis = makeFakeRedis();
  const snapshot = {
    feed_version: 'v-unit-1',
    generated_at: new Date(NOW_MS).toISOString(),
    generated_at_ms: NOW_MS,
    items: [normalizeFeedItem(ITEMS.today1)].filter(Boolean),
  };

  await publishSnapshot(redis, snapshot);

  assert.equal(redis.store[CURRENT_VERSION_KEY], 'v-unit-1');
  assert.ok(redis.store[getSnapshotItemsKey('v-unit-1')]);
  assert.ok(redis.store[getSnapshotMetaKey('v-unit-1')]);

  const current = await readCurrentSnapshot(redis);
  assert.equal(current.feed_version, 'v-unit-1');
  assert.equal(current.items.length, 1);
  assert.equal(current.items[0].id, 'today-1');
});

test('readSnapshotByVersion: returns same immutable data for repeated reads of one version', async () => {
  const redis = makeFakeRedis();
  const snapshot = {
    feed_version: 'v-unit-2',
    generated_at: new Date(NOW_MS).toISOString(),
    generated_at_ms: NOW_MS,
    items: [normalizeFeedItem(ITEMS.today1), normalizeFeedItem(ITEMS.tomorrow1)].filter(Boolean),
  };

  await publishSnapshot(redis, snapshot);

  const first = await readSnapshotByVersion(redis, 'v-unit-2');
  const second = await readSnapshotByVersion(redis, 'v-unit-2');
  assert.deepEqual(first, second);
});

test('getOrBuildSnapshot: returns stale snapshot when rebuild lock is already held', async () => {
  const staleMs = NOW_MS - FRESH_TTL_MS - 1000;
  const staleSnapshot = {
    feed_version: 'v-stale-unit',
    generated_at: new Date(staleMs).toISOString(),
    generated_at_ms: staleMs,
    items: [normalizeFeedItem(ITEMS.today1)].filter(Boolean),
  };
  const redis = makeFakeRedis({
    store: {
      [CURRENT_VERSION_KEY]: staleSnapshot.feed_version,
      [getSnapshotMetaKey(staleSnapshot.feed_version)]: JSON.stringify({
        feed_version: staleSnapshot.feed_version,
        generated_at: staleSnapshot.generated_at,
        generated_at_ms: staleSnapshot.generated_at_ms,
      }),
      [getSnapshotItemsKey(staleSnapshot.feed_version)]: JSON.stringify(staleSnapshot.items),
      [LOCK_KEY]: '1',
    },
  });

  const result = await getOrBuildSnapshot(redis, async () => {
    throw new Error('loader must not run when lock is held');
  });

  assert.equal(result.feed_version, 'v-stale-unit');
  assert.equal(result.items.length, 1);
});

test('getOrBuildSnapshot: rebuild publishes new immutable version and preserves old snapshot briefly', async () => {
  const staleMs = NOW_MS - FRESH_TTL_MS - 1000;
  const oldSnapshot = {
    feed_version: 'v-old-unit',
    generated_at: new Date(staleMs).toISOString(),
    generated_at_ms: staleMs,
    items: [normalizeFeedItem(ITEMS.today1)].filter(Boolean),
  };
  const redis = makeFakeRedis({
    store: {
      [CURRENT_VERSION_KEY]: oldSnapshot.feed_version,
      [getSnapshotMetaKey(oldSnapshot.feed_version)]: JSON.stringify({
        feed_version: oldSnapshot.feed_version,
        generated_at: oldSnapshot.generated_at,
        generated_at_ms: oldSnapshot.generated_at_ms,
      }),
      [getSnapshotItemsKey(oldSnapshot.feed_version)]: JSON.stringify(oldSnapshot.items),
    },
  });

  const originalDateNow = Date.now;
  Date.now = () => NOW_MS + 123456;
  try {
    const rebuilt = await getOrBuildSnapshot(redis, async () => [ITEMS.today2, ITEMS.tomorrow1]);
    assert.notEqual(rebuilt.feed_version, 'v-old-unit');
    assert.equal(redis.store[CURRENT_VERSION_KEY], rebuilt.feed_version, 'current_version must switch only to newly published version');

    const oldRead = await readSnapshotByVersion(redis, 'v-old-unit');
    const newRead = await readCurrentSnapshot(redis);
    assert.equal(oldRead.feed_version, 'v-old-unit', 'old snapshot must remain readable for a short overlap period');
    assert.equal(oldRead.items.length, 1);
    assert.equal(newRead.feed_version, rebuilt.feed_version);
    assert.equal(newRead.items.length, 2);
  } finally {
    Date.now = originalDateNow;
  }
});

test('buildSnapshot: normalizes raw recommendation items into feed snapshot items', async () => {
  const snapshot = await buildSnapshot(async () => [ITEMS.today1, ITEMS.past, { bad: true }]);
  assert.ok(snapshot.feed_version.startsWith('v'));
  assert.equal(snapshot.items.length, 2, 'snapshot build normalizes valid items and leaves time filtering to payload assembly');
  assert.ok(snapshot.items.every((item) => item.primary_bet && item.primary_bet.forecast));
});
