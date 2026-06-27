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
    if (payload.items.length > 0) {
      assert.ok(payload.items.every((item) => item.sport_name === 'Футбол'));
    }
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations does not inject fallback placeholder items for favorite sports', async () => {
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
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 0);
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

test('GET /recommendations returns available items sorted by starts_at without padding', async () => {
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
    assert.ok(payload.items.length <= 3);

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
      assert.ok('match_id' in item, 'item should expose match_id field');
      assert.ok('match_slug' in item, 'item should expose match_slug field');

      assert.equal(item.bets[0].coeff >= 1.5 && item.bets[0].coeff <= 1.9, true);
      assert.equal(item.bets[1].coeff >= 1.7 && item.bets[1].coeff <= 2.2, true);
      assert.match(String(item.bets[2].forecast || ''), /точный счет\s+\d+:\d+/i);
    }

    const starts = payload.items.map((item) => item.starts_at);
    const sortedStarts = [...starts].sort((a, b) => new Date(a) - new Date(b));
    assert.deepEqual(starts, sortedStarts);
    if (payload.items.length > 0) {
      assert.ok(payload.items.every((item) => Array.isArray(item.bets)));
    }
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns recommendations_version when backed by Redis cache', async () => {
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
    assert.equal(typeof payload.recommendations_version, 'string');
    assert.ok(payload.recommendations_version.startsWith('r'));
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations serves the same explicit recommendations_version snapshot', async () => {
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
      url: `/recommendations?recommendations_version=${encodeURIComponent(firstPayload.recommendations_version)}`,
    });
    assert.equal(second.statusCode, 200);
    const secondPayload = second.json();

    assert.equal(secondPayload.recommendations_version, firstPayload.recommendations_version);
    assert.deepEqual(secondPayload.items, firstPayload.items);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns explicit stale-version response when requested snapshot is unavailable', async () => {
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

    for (const key of Object.keys(fakeRedis.store)) {
      if (key.includes(`:${firstPayload.recommendations_version}`)) {
        delete fakeRedis.store[key];
      }
    }

    const stale = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: `/recommendations?recommendations_version=${encodeURIComponent(firstPayload.recommendations_version)}`,
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(stale.json(), {
      error: 'STALE_RECOMMENDATIONS_VERSION',
      message: 'Рекомендации обновились',
      reload_from_start: true,
      recommendations_version: firstPayload.recommendations_version,
      current_recommendations_version: firstPayload.recommendations_version,
    });
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

test('GET /recommendations attaches ai_brief to item when ready brief exists', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'stavka-match-42',
      match_id: 42,
      match_slug: 'match-42',
      sport_id: 1,
      sport_name: 'Футбол',
      match: 'Team A — Team B',
      league: 'Premier League',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      main_thought: 'Победа хозяев',
      confidence: 70,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r1000',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/FROM public\.ai_recommendation_briefs/i.test(query)) {
        return [{
          match_id: 42,
          status: 'ready',
          headline: 'Прогноз на матч',
          brief: 'Детальный разбор',
          risk_note: 'Умеренный риск',
        }];
      }
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    const item = payload.items[0];
    assert.ok(item.ai_brief, 'should have ai_brief');
    assert.equal(item.ai_brief.headline, 'Прогноз на матч');
    assert.equal(item.ai_brief.brief, 'Детальный разбор');
    assert.equal(item.ai_brief.risk_note, 'Умеренный риск');
    assert.equal(item.ai_brief.stale, false);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations attaches ai_brief with stale=true when brief_status is stale', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'stavka-match-43',
      match_id: 43,
      match_slug: 'match-43',
      sport_id: 1,
      sport_name: 'Футбол',
      match: 'Team C — Team D',
      league: 'La Liga',
      starts_at: new Date(Date.now() + 7200000).toISOString(),
      main_thought: 'Ничья',
      confidence: 55,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r1001',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/FROM public\.ai_recommendation_briefs/i.test(query)) {
        return [{
          match_id: 43,
          status: 'stale',
          headline: 'Устаревший прогноз',
          brief: 'Старый разбор',
          risk_note: null,
        }];
      }
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    const item = payload.items[0];
    assert.ok(item.ai_brief, 'should have ai_brief for stale status');
    assert.equal(item.ai_brief.stale, true);
    assert.equal(item.ai_brief.headline, 'Устаревший прогноз');
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations omits ai_brief when no brief row exists for match', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'stavka-match-44',
      match_id: 44,
      match_slug: 'match-44',
      sport_id: 1,
      sport_name: 'Футбол',
      match: 'Team E — Team F',
      league: 'Bundesliga',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      main_thought: 'Победа гостей',
      confidence: 60,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r1002',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/FROM public\.ai_recommendation_briefs/i.test(query)) return [];
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    assert.equal('ai_brief' in payload.items[0], false, 'should not have ai_brief when no row');
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations returns base items unchanged when ai brief store fails', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'stavka-match-45',
      match_id: 45,
      match_slug: 'match-45',
      sport_id: 1,
      sport_name: 'Футбол',
      match: 'Team G — Team H',
      league: 'Serie A',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      main_thought: 'Обе забьют',
      confidence: 65,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r1003',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/FROM public\.ai_recommendation_briefs/i.test(query)) throw new Error('DB connection error');
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].match_id, 45);
    assert.equal('ai_brief' in payload.items[0], false, 'should not have ai_brief when store fails');
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations attaches ai_brief for item with synthetic match_id via match_slug', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'ts_1234567890',
      match_id: 'ts_1234567890',
      match_slug: 'real-match-slug',
      sport_id: 1,
      sport_name: 'Футбол',
      match: 'Team X — Team Y',
      league: 'RPL',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      main_thought: 'Победа хозяев',
      confidence: 72,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r2000',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/match_slug IN/i.test(query)) {
        return [{
          match_id: 100,
          match_slug: 'real-match-slug',
          status: 'ready',
          headline: 'Слаг-прогноз',
          brief: 'Разбор по слагу',
          risk_note: null,
        }];
      }
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    const item = payload.items[0];
    assert.ok(item.ai_brief, 'should have ai_brief when match_id is synthetic but match_slug matches');
    assert.equal(item.ai_brief.headline, 'Слаг-прогноз');
    assert.equal(item.ai_brief.brief, 'Разбор по слагу');
    assert.equal(item.ai_brief.stale, false);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /recommendations omits ai_brief for item with synthetic match_id when no slug brief exists', async () => {
  const cleanup = withTempFavoritesFile();
  const cachedPayload = JSON.stringify({
    items: [{
      id: 'ts_9999999999',
      match_id: 'ts_9999999999',
      match_slug: 'no-brief-slug',
      sport_id: 1,
      sport_name: 'Хоккей',
      match: 'Team A — Team B',
      league: 'KHL',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      main_thought: 'Победа гостей',
      confidence: 55,
      is_new: false,
      bets: [],
    }],
    source: 'stavka-live',
    updated_at: new Date().toISOString(),
    recommendations_version: 'r2001',
  });

  const fakeRedis = makeFakeRedis({ store: { 'recommendations:default': cachedPayload } });
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) return [];
      if (/match_slug IN/i.test(query)) return [];
      return [];
    },
  });

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
    assert.equal(payload.items.length, 1);
    assert.equal('ai_brief' in payload.items[0], false, 'should not have ai_brief when no slug brief exists');
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
