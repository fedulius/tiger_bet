const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

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
    assert.ok(!('feed_version' in payload), 'feed_version must not be present in MVP');
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
