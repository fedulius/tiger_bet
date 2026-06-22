const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

test('GET /favorites returns DB-backed favorites for authenticated user', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.favorite_sport fs/i.test(query)) {
        return [
          { sport_name: 'Футбол', sport_url: 'soccer' },
          { sport_name: 'Теннис', sport_url: 'tennis' },
        ];
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
      url: '/favorites',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fakePg.calls.length, 1);
    assert.match(fakePg.calls[0].query, /JOIN public\.sport/i);
    assert.deepEqual(fakePg.calls[0].params, [77]);
    assert.deepEqual(response.json(), {
      sports: ['soccer', 'tennis'],
      leagues: [],
      profile: 'telegram:777',
    });
  } finally {
    await app.close();
  }
});

test('PUT /favorites replaces user favorites in DB', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/SELECT sport_id, sport_name, sport_url\s+FROM public\.sport/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' },
          { sport_id: 3, sport_name: 'Теннис', sport_url: 'tennis' },
        ];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const putResponse = await app.inject({
      headers: makeAuthHeaders(app, { userId: 55, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: ['football', 'tennis'],
        leagues: ['Premier League', 'ATP'],
      },
    });

    assert.equal(putResponse.statusCode, 200);
    assert.deepEqual(putResponse.json(), {
      sports: ['soccer', 'tennis'],
      leagues: ['Premier League', 'ATP'],
      profile: 'telegram:777',
    });

    assert.equal(fakePg.calls.length, 4);
    assert.match(fakePg.calls[0].query, /FROM public\.sport/i);
    assert.match(fakePg.calls[1].query, /DELETE FROM public\.favorite_sport/i);
    assert.deepEqual(fakePg.calls[1].params, [55]);
    assert.match(fakePg.calls[2].query, /INSERT INTO public\.favorite_sport/i);
    assert.deepEqual(fakePg.calls[2].params, [55, 1]);
    assert.match(fakePg.calls[3].query, /INSERT INTO public\.favorite_sport/i);
    assert.deepEqual(fakePg.calls[3].params, [55, 3]);
  } finally {
    await app.close();
  }
});

test('PUT /favorites validates payload arrays', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 1, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: 'football',
        leagues: ['Premier League'],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /sports and leagues must be arrays/i);
  } finally {
    await app.close();
  }
});

test('GET /favorites returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/favorites',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('PUT /favorites returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: ['football'],
        leagues: ['Premier League'],
      },
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
