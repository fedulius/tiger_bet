const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

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

test('GET /recommendations returns favorite-based items when user has favorite sports', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 77, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(payload.source, 'favorites');
    assert.equal(Array.isArray(payload.items), true);
    assert.ok(payload.items.length >= 1);
    assert.ok(payload.items.every((item) => item.sport_name === 'Футбол'));
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations respects per-sport leagues for fallback items', async () => {
  const cleanup = withTempFavoritesFile({
    'telegram:777': {
      sport_settings: [
        { name: 'Футбол', leagues: ['La Liga'] },
      ],
    },
  });

  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 77, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.source, 'favorites');
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].league, 'La Liga');
    assert.equal(payload.items[0].sport_name, 'Футбол');
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations does not fall back to football when user favorites have no matching items', async () => {
  const cleanup = withTempFavoritesFile({
    'telegram:778': {
      sport_settings: [
        { name: 'Теннис', leagues: ['ATP'] },
      ],
    },
  });

  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) {
        return [{ sport_id: 2, sport_name: 'Теннис', sport_url: 'tennis' }];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 78, telegram_user_id: 778, profile: 'telegram:778' }),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(payload.source, 'favorites');
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 0);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns 3 items sorted by starts_at', async () => {
  const cleanup = withTempFavoritesFile();
  const fakePg = createFakePg({ rows: [] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.ok(['fallback-top', 'stavka-live'].includes(payload.source));
    assert.ok(payload.updated_at);
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 3);

    for (const item of payload.items) {
      assert.ok(item.id);
      assert.ok(item.match);
      assert.ok(item.league);
      assert.ok(item.starts_at);
      assert.ok(item.main_thought);
      assert.equal(typeof item.confidence, 'number');
      assert.equal(typeof item.is_new, 'boolean');
      assert.equal(Array.isArray(item.bets), true);
      assert.equal(item.bets.length, 3);

      assert.equal(item.bets[0].coeff >= 1.5 && item.bets[0].coeff <= 1.9, true);
      assert.equal(item.bets[1].coeff >= 1.7 && item.bets[1].coeff <= 2.2, true);
      assert.match(String(item.bets[2].forecast || ''), /точный счет\s+\d+:\d+/i);
    }

    const starts = payload.items.map((item) => item.starts_at);
    const sortedStarts = [...starts].sort((a, b) => new Date(a) - new Date(b));
    assert.deepEqual(starts, sortedStarts);
  } finally {
    await app.close();
    cleanup();
  }
});


test('GET /recommendations reflects updated favorites immediately after PUT /favorites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-rec-sequence-'));
  const filePath = path.join(dir, 'favorites.json');
  process.env.WEBAPP_FAVORITES_FILE = filePath;
  fs.writeFileSync(filePath, JSON.stringify({
    'telegram:799': {
      sport_settings: [{ name: 'Футбол', leagues: [] }],
    },
  }, null, 2));

  const cleanup = () => {
    delete process.env.WEBAPP_FAVORITES_FILE;
    fs.rmSync(dir, { force: true, recursive: true });
  };

  const fakeRedis = { async del() {} };
  let sportsDeleted = false;
  const fakePg = createFakePg({
    handler(query) {
      if (/DELETE FROM public\.favorite_sport/i.test(query)) {
        sportsDeleted = true;
        return [];
      }
      if (/FROM public\.favorite_sport fs/i.test(query)) {
        return sportsDeleted ? [] : [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      if (/FROM public\.sport/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
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
    assert.equal(before.json().source, 'favorites');

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
    assert.notEqual(after.json().source, 'favorites');
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
