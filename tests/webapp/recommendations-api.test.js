const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');
const { filterItemsByFavoriteLeagues } = require('../../webapp/services/recommendationService');

function withTempFavoritesFile(contents = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-recommendations-'));
  const filePath = path.join(dir, 'favorites.json');
  process.env.WEBAPP_FAVORITES_FILE = filePath;
  fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
  return () => {
    delete process.env.WEBAPP_FAVORITES_FILE;
    fs.rmSync(dir, { force: true, recursive: true });
  };
}

function makeFakeRedis({ store = {} } = {}) {
  return {
    store,
    deletedKeys: [],
    async get(key) {
      return store[key] !== undefined ? store[key] : null;
    },
    async set(key, value, opts = {}) {
      if (opts && opts.NX && store[key] !== undefined) return null;
      store[key] = value;
      return 'OK';
    },
    async del(...keys) {
      this.deletedKeys.push(...keys);
      let removed = 0;
      for (const key of keys) {
        if (store[key] !== undefined) {
          delete store[key];
          removed += 1;
        }
      }
      return removed;
    },
  };
}

// ── filterItemsByFavoriteLeagues tests ──────────────────────

test('filterItemsByFavoriteLeagues matches World Cup aliases and ignores country prefix', () => {
  const items = [
    {
      sport_id: 1,
      league: 'Мир: Чемпионат мира',
      league_name: 'Чемпионат мира',
      match: 'Австралия — Египет',
    },
    {
      sport_id: 1,
      league: 'Эстония: Премиум Лига',
      league_name: 'Премиум Лига',
      match: 'Нымме Юнайтед — Нымме Калью',
    },
  ];

  const filtered = filterItemsByFavoriteLeagues(items, [
    { sport_id: 1, leagues: ['World Cup'] },
  ]);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].match, 'Австралия — Египет');
});

test('filterItemsByFavoriteLeagues keeps sport+league pair strict', () => {
  const items = [
    {
      sport_id: 1,
      league: 'Мир: Чемпионат мира',
      league_name: 'Чемпионат мира',
      match: 'Футбол ЧМ',
    },
    {
      sport_id: 2,
      league: 'Мир: Чемпионат мира',
      league_name: 'Чемпионат мира',
      match: 'Хоккей ЧМ',
    },
  ];

  const filtered = filterItemsByFavoriteLeagues(items, [
    { sport_id: 1, leagues: ['World Cup'] },
  ]);

  assert.deepEqual(filtered.map((item) => item.match), ['Футбол ЧМ']);
});

// ── API route tests ─────────────────────────────────────────

test('GET /recommendations returns items and daily_picks', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({ rows: [] });
  const fakeRedis = makeFakeRedis();
  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.daily_picks);
    assert.ok(payload.updated_at);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns consistent results on repeated calls', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({ rows: [] });
  const fakeRedis = makeFakeRedis();
  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const first = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });
    assert.equal(first.statusCode, 200);
    const firstPayload = first.json();

    const second = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });
    assert.equal(second.statusCode, 200);
    const secondPayload = second.json();

    assert.ok(Array.isArray(firstPayload.items));
    assert.ok(Array.isArray(secondPayload.items));
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations handles missing favorites gracefully', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({ rows: [] });
  const fakeRedis = makeFakeRedis();
  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.daily_picks);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations reflects updated favorites immediately after PUT /favorites', async () => {
  const cleanup = withTempFavoritesFile();

  const fakeRedis = { async del() {} };
  let sportsDeleted = false;
  const fakePg = createFakePg({
    handler(query) {
      if (/DELETE FROM public\\.user_tournament/i.test(query)) {
        return [];
      }
      if (/DELETE FROM public\\.user_sport/i.test(query)) {
        sportsDeleted = true;
        return [];
      }
      if (/FROM public\\.user_sport us/i.test(query)) {
        return sportsDeleted
          ? []
          : [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer', tournament_id: null, tournament_name: null, tournament_name_en: null }];
      }
      if (/FROM public\\.sport/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      if (/FROM public\\.tournament/i.test(query)) {
        return [];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const before = await app.inject({
      headers: makeAuthHeaders(app, { userId: 99, telegram_user_id: 799, profile: 'telegram:799' }),
      method: 'GET',
      url: '/recommendations',
    });
    assert.equal(before.statusCode, 200);

    await app.inject({
      headers: makeAuthHeaders(app, { userId: 99, telegram_user_id: 799, profile: 'telegram:799' }),
      method: 'PUT',
      url: '/favorites',
      payload: { sports: [] },
    });

    const after = await app.inject({
      headers: makeAuthHeaders(app, { userId: 99, telegram_user_id: 799, profile: 'telegram:799' }),
      method: 'GET',
      url: '/recommendations',
    });
    assert.equal(after.statusCode, 200);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns daily_picks from match_analysis', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\\.user_sport/i.test(query)) return [];
      if (/match_analysis/i.test(query)) return [];
      return [];
    },
  });
  const fakeRedis = makeFakeRedis();
  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.daily_picks);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns 401 without JWT', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({ rows: [] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
    cleanup();
  }
});
