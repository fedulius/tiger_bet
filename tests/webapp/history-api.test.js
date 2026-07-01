const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

test('GET /history returns favorite-based items when user has favorite sports', async () => {
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
      url: '/history',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.empty_state, null);
    assert.ok(payload.items.every((item) => /Premier League|La Liga/.test(item.league)));
  } finally {
    await app.close();
  }
});

test('GET /history returns empty-state payload', async () => {
  const fakePg = createFakePg({ rows: [] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/history',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 0);
    assert.equal(payload.empty_state?.message, 'Здесь появятся ваши последние прогнозы');
    assert.equal(payload.empty_state?.cta?.label, 'Открыть рекомендации');
    assert.equal(payload.empty_state?.cta?.target, '#recommendations');
  } finally {
    await app.close();
  }
});

test('GET /history item shape uses format A fields', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/history?sample=1',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.ok(payload.items.length >= 1);

    const item = payload.items[0];
    assert.ok(item.id);
    assert.ok(item.match);
    assert.ok(item.league);
    assert.ok(item.starts_at);
    assert.ok(item.main_thought);
    assert.equal(typeof item.confidence, 'number');
  } finally {
    await app.close();
  }
});

test('GET /history returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/history',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
