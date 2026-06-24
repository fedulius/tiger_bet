const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');
const { SNAPSHOT_KEY, FRESH_TTL_MS } = require('../../webapp/services/feedSnapshotService');

const HOUR_MS = 60 * 60 * 1000;

function makeFeedItems() {
  const now = Date.now();
  return [
    {
      id: 'feed-1',
      match: 'Arsenal vs Chelsea',
      sport_name: 'Футбол',
      country: 'Англия',
      league: 'Premier League',
      starts_at: new Date(now + 2 * HOUR_MS).toISOString(),
      main_thought: 'Арсенал выглядит сильнее',
      confidence: 70,
    },
    {
      id: 'feed-2',
      match: 'Real vs Barca',
      sport_name: 'Футбол',
      country: 'Испания',
      league: 'La Liga',
      starts_at: new Date(now + 4 * HOUR_MS).toISOString(),
      main_thought: 'Реал на своём поле',
      confidence: 65,
    },
    {
      id: 'feed-3',
      match: 'PSG vs Lyon',
      sport_name: 'Футбол',
      country: 'Франция',
      league: 'Ligue 1',
      starts_at: new Date(now + 6 * HOUR_MS).toISOString(),
      main_thought: 'ПСЖ дома',
      confidence: 68,
    },
    {
      id: 'feed-4',
      match: 'Djokovic vs Medvedev',
      sport_name: 'Теннис',
      country: 'Великобритания',
      league: 'Wimbledon',
      starts_at: new Date(now + 8 * HOUR_MS).toISOString(),
      main_thought: 'Джокович в форме',
      confidence: 72,
    },
    {
      id: 'feed-5',
      match: 'Sinner vs Alcaraz',
      sport_name: 'Теннис',
      country: 'Великобритания',
      league: 'Wimbledon',
      starts_at: new Date(now + 10 * HOUR_MS).toISOString(),
      main_thought: 'Синнер на пике',
      confidence: 66,
    },
  ];
}

function buildFeedApp(extraOptions = {}) {
  const items = makeFeedItems();
  return buildTestApp(buildApp, {
    pg: createFakePg(),
    feedLoader: async () => items,
    ...extraOptions,
  });
}

// ─── JWT protection ───────────────────────────────────────────────────────────

test('GET /feed returns 401 without JWT', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/feed' });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

// ─── Basic response shape ─────────────────────────────────────────────────────

test('GET /feed returns 200 with valid JWT', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('GET /feed response has required fields', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();

    assert.ok(payload.generated_at, 'missing generated_at');
    assert.ok('window' in payload, 'missing window');
    assert.ok('filters' in payload, 'missing filters');
    assert.ok(Array.isArray(payload.items), 'items is not an array');
    assert.equal(typeof payload.next_offset, 'number', 'missing next_offset');
    assert.equal(typeof payload.has_more, 'boolean', 'missing has_more');
    assert.ok(Array.isArray(payload.available_sports), 'available_sports must be an array');
    assert.ok(payload.available_sports.includes('Футбол'), 'available_sports must include football');
    assert.ok(payload.available_sports.includes('Теннис'), 'available_sports must include tennis from later items too');
    assert.ok(!('feed_version' in payload), 'feed_version absent when Redis not available (live-fallback path)');
  } finally {
    await app.close();
  }
});

test('GET /feed items have required item fields including country', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    const { items } = response.json();
    assert.ok(items.length > 0);

    for (const item of items) {
      assert.ok(item.id, 'missing id');
      assert.ok(item.match_id, 'missing match_id');
      assert.ok('match' in item, 'missing match');
      assert.ok('sport' in item, 'missing sport');
      assert.ok('country' in item, 'missing country (must exist even if empty)');
      assert.ok('league' in item, 'missing league');
      assert.ok(item.starts_at, 'missing starts_at');
      assert.ok('summary' in item, 'missing summary');
      assert.ok(item.primary_bet, 'missing primary_bet');
      assert.ok(item.primary_bet.forecast, 'missing primary_bet.forecast');
      assert.equal(typeof item.primary_bet.coeff, 'number', 'primary_bet.coeff must be number');
      assert.ok('description' in item.primary_bet, 'missing primary_bet.description');
    }
  } finally {
    await app.close();
  }
});

// ─── Default window ───────────────────────────────────────────────────────────

test('GET /feed default window is all', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.window, 'all');
  } finally {
    await app.close();
  }
});

test('GET /feed returns all 5 items by default (no filter, no pagination)', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 5);
    assert.equal(payload.has_more, false);
  } finally {
    await app.close();
  }
});

test('GET /feed items are sorted by starts_at ascending', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    const { items } = response.json();
    const starts = items.map((i) => i.starts_at);
    const sorted = [...starts].sort((a, b) => new Date(a) - new Date(b));
    assert.deepEqual(starts, sorted);
  } finally {
    await app.close();
  }
});

// ─── Pagination ───────────────────────────────────────────────────────────────

test('GET /feed paginates: first page limit=2', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?limit=2&offset=0',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.equal(payload.next_offset, 2);
    assert.equal(payload.has_more, true);
  } finally {
    await app.close();
  }
});

test('GET /feed paginates: second page limit=2 offset=2', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?limit=2&offset=2',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.equal(payload.next_offset, 4);
    assert.equal(payload.has_more, true);
  } finally {
    await app.close();
  }
});

test('GET /feed paginates: last page limit=2 offset=4', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?limit=2&offset=4',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 1);
    assert.equal(payload.next_offset, 6);
    assert.equal(payload.has_more, false);
  } finally {
    await app.close();
  }
});

test('GET /feed paginates: offset beyond total returns empty', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?limit=10&offset=20',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 0);
    assert.equal(payload.has_more, false);
  } finally {
    await app.close();
  }
});

// ─── Filter by sport ──────────────────────────────────────────────────────────

test('GET /feed filters by sport', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?sport=%D0%A4%D1%83%D1%82%D0%B1%D0%BE%D0%BB', // Футбол
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 3);
    assert.ok(payload.items.every((i) => i.sport === 'Футбол'));
    assert.equal(payload.filters.sport, 'Футбол');
  } finally {
    await app.close();
  }
});

test('GET /feed filters by sport=Теннис returns tennis items', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?sport=%D0%A2%D0%B5%D0%BD%D0%BD%D0%B8%D1%81', // Теннис
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.ok(payload.items.every((i) => i.sport === 'Теннис'));
  } finally {
    await app.close();
  }
});

// ─── Filter by league ─────────────────────────────────────────────────────────

test('GET /feed filters by league', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?league=La%20Liga',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].id, 'feed-2');
    assert.equal(payload.filters.league, 'La Liga');
  } finally {
    await app.close();
  }
});

test('GET /feed filters by league=Wimbledon returns 2 items', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?league=Wimbledon',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.ok(payload.items.every((i) => i.league === 'Wimbledon'));
  } finally {
    await app.close();
  }
});

// ─── Filter by country ────────────────────────────────────────────────────────

test('GET /feed filters by country', async () => {
  const app = buildFeedApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?country=%D0%90%D0%BD%D0%B3%D0%BB%D0%B8%D1%8F', // Англия
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].id, 'feed-1');
    assert.equal(payload.filters.country, 'Англия');
  } finally {
    await app.close();
  }
});

// ─── Snapshot-backed feed ─────────────────────────────────────────────────────

function makeFakeRedis({ store = {}, getError = null, setError = null } = {}) {
  return {
    async get(key) {
      if (getError) throw getError;
      return store[key] !== undefined ? store[key] : null;
    },
    async set(key, value, opts = {}) {
      if (setError) throw setError;
      if (opts && opts.NX && store[key] !== undefined) return null;
      store[key] = value;
      return 'OK';
    },
    async del(...keys) {
      for (const key of keys.flat()) delete store[key];
    },
  };
}

function makeSnapshotItems() {
  const now = Date.now();
  return [
    {
      id: 'snap-1',
      match_id: 'snap-1',
      match: 'Bayern vs Dortmund',
      sport: 'Футбол',
      country: 'Германия',
      league: 'Bundesliga',
      starts_at: new Date(now + 2 * HOUR_MS).toISOString(),
      summary: 'Баварский дерби',
      primary_bet: { forecast: 'П1', coeff: 1.75, description: '' },
    },
    {
      id: 'snap-2',
      match_id: 'snap-2',
      match: 'Djokovic vs Sinner',
      sport: 'Теннис',
      country: 'Великобритания',
      league: 'Wimbledon',
      starts_at: new Date(now + 4 * HOUR_MS).toISOString(),
      summary: 'Финал Уимблдона',
      primary_bet: { forecast: 'П1', coeff: 1.6, description: '' },
    },
    {
      id: 'snap-3',
      match_id: 'snap-3',
      match: 'PSG vs Lyon',
      sport: 'Футбол',
      country: 'Франция',
      league: 'Ligue 1',
      starts_at: new Date(now + 6 * HOUR_MS).toISOString(),
      summary: 'ПСЖ дома',
      primary_bet: { forecast: 'П1', coeff: 1.55, description: '' },
    },
  ];
}

test('GET /feed returns feed_version when backed by Redis snapshot', async () => {
  const store = {};
  store[SNAPSHOT_KEY] = JSON.stringify({
    feed_version: 'v99999',
    generated_at: new Date().toISOString(),
    generated_at_ms: Date.now() - 1000,
    items: makeSnapshotItems(),
  });
  const app = buildFeedApp({ feedRedis: makeFakeRedis({ store }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.ok('feed_version' in payload, 'feed_version must be present when served from snapshot');
    assert.equal(payload.feed_version, 'v99999');
  } finally {
    await app.close();
  }
});

test('GET /feed snapshot path: response preserves required contract fields', async () => {
  const store = {};
  store[SNAPSHOT_KEY] = JSON.stringify({
    feed_version: 'v88888',
    generated_at: new Date().toISOString(),
    generated_at_ms: Date.now() - 1000,
    items: makeSnapshotItems(),
  });
  const app = buildFeedApp({ feedRedis: makeFakeRedis({ store }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.ok(payload.generated_at);
    assert.ok('window' in payload);
    assert.ok('filters' in payload);
    assert.ok(Array.isArray(payload.items));
    assert.equal(typeof payload.next_offset, 'number');
    assert.equal(typeof payload.has_more, 'boolean');
    assert.ok('feed_version' in payload);
  } finally {
    await app.close();
  }
});

test('GET /feed snapshot path: pagination works from snapshot items', async () => {
  const store = {};
  store[SNAPSHOT_KEY] = JSON.stringify({
    feed_version: 'v77777',
    generated_at: new Date().toISOString(),
    generated_at_ms: Date.now() - 1000,
    items: makeSnapshotItems(),
  });
  const app = buildFeedApp({ feedRedis: makeFakeRedis({ store }) });
  await app.ready();

  try {
    const page1 = await app.inject({
      method: 'GET',
      url: '/feed?limit=2&offset=0',
      headers: makeAuthHeaders(app),
    });
    const p1 = page1.json();
    assert.equal(p1.items.length, 2);
    assert.equal(p1.has_more, true);
    assert.equal(p1.next_offset, 2);

    const page2 = await app.inject({
      method: 'GET',
      url: '/feed?limit=2&offset=2',
      headers: makeAuthHeaders(app),
    });
    const p2 = page2.json();
    assert.equal(p2.items.length, 1);
    assert.equal(p2.has_more, false);
  } finally {
    await app.close();
  }
});

test('GET /feed snapshot path: filter by sport works', async () => {
  const store = {};
  store[SNAPSHOT_KEY] = JSON.stringify({
    feed_version: 'v66666',
    generated_at: new Date().toISOString(),
    generated_at_ms: Date.now() - 1000,
    items: makeSnapshotItems(),
  });
  const app = buildFeedApp({ feedRedis: makeFakeRedis({ store }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed?sport=%D0%A4%D1%83%D1%82%D0%B1%D0%BE%D0%BB', // Футбол
      headers: makeAuthHeaders(app),
    });

    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.ok(payload.items.every((i) => i.sport === 'Футбол'));
    assert.equal(payload.filters.sport, 'Футбол');
  } finally {
    await app.close();
  }
});

test('GET /feed snapshot path: cache miss triggers build, stores snapshot, loader called once', async () => {
  const store = {};
  let loaderCallCount = 0;
  const items = makeFeedItems();
  const app = buildFeedApp({
    feedLoader: async () => { loaderCallCount++; return items; },
    feedRedis: makeFakeRedis({ store }),
  });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.ok('feed_version' in payload, 'feed_version must be set after cache miss build');
    assert.equal(loaderCallCount, 1, 'loader must be called exactly once on cache miss');
    assert.ok(store[SNAPSHOT_KEY], 'snapshot must be stored in Redis after build');
  } finally {
    await app.close();
  }
});

test('GET /feed snapshot path: stale snapshot returned when lock is held', async () => {
  const staleMs = Date.now() - FRESH_TTL_MS - 60000;
  const staleSnapshot = {
    feed_version: 'v-stale',
    generated_at: new Date(staleMs).toISOString(),
    generated_at_ms: staleMs,
    items: makeSnapshotItems(),
  };
  const store = {
    [SNAPSHOT_KEY]: JSON.stringify(staleSnapshot),
    'feed:snapshot:lock': '1',  // lock already held
  };

  const app = buildFeedApp({ feedRedis: makeFakeRedis({ store }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: makeAuthHeaders(app),
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.feed_version, 'v-stale', 'stale snapshot must be returned when lock held');
  } finally {
    await app.close();
  }
});
