const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');
const { followMatch, unfollowMatch } = require('../../webapp/services/matchFollowService');

function withMatchFollowFlag(value, fn) {
  const previous = process.env.MATCH_FOLLOW_ENABLED;
  if (value === undefined) delete process.env.MATCH_FOLLOW_ENABLED;
  else process.env.MATCH_FOLLOW_ENABLED = value;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.MATCH_FOLLOW_ENABLED;
      else process.env.MATCH_FOLLOW_ENABLED = previous;
    });
}

test('GET /match/:id/follow returns an explicit feature-disabled response by default', async () => {
  await withMatchFollowFlag(undefined, async () => {
    const app = buildTestApp(buildApp);
    await app.ready();

    try {
      const response = await app.inject({
        headers: makeAuthHeaders(app, { userId: 42 }),
        method: 'GET',
        url: '/match/123/follow',
      });

      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        error: 'FEATURE_DISABLED',
        message: 'Отслеживание матчей временно недоступно: схема уведомлений ещё не применена.',
      });
    } finally {
      await app.close();
    }
  });
});

test('all match-follow methods return FEATURE_DISABLED while the flag is off', async () => {
  await withMatchFollowFlag('false', async () => {
    const app = buildTestApp(buildApp);
    await app.ready();

    try {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await app.inject({
          headers: makeAuthHeaders(app, { userId: 42 }),
          method,
          url: '/match/123/follow',
        });

        assert.equal(response.statusCode, 503, method);
        assert.equal(response.json().error, 'FEATURE_DISABLED');
      }
    } finally {
      await app.close();
    }
  });
});

test('match-follow methods require the same JWT auth as the app', async () => {
  await withMatchFollowFlag('true', async () => {
    const app = buildTestApp(buildApp);
    await app.ready();

    try {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await app.inject({
          method,
          url: '/match/123/follow',
        });

        assert.equal(response.statusCode, 401, method);
        assert.deepEqual(response.json(), { error: 'Unauthorized' });
      }
    } finally {
      await app.close();
    }
  });
});

test('enabled match-follow methods expose the API after schema gate passes', async () => {
  await withMatchFollowFlag('true', async () => {
    const fakePg = createFakePg({ handler: async (query) => /to_regclass/i.test(query) ? [{ missing_tables: [] }] : [] });
    const app = buildTestApp(buildApp, { pg: fakePg });
    await app.ready();

    try {
      const get = await app.inject({ headers: makeAuthHeaders(app, { userId: 42 }), method: 'GET', url: '/match/123/follow' });
      const put = await app.inject({ headers: makeAuthHeaders(app, { userId: 42 }), method: 'PUT', url: '/match/123/follow' });
      const del = await app.inject({ headers: makeAuthHeaders(app, { userId: 42 }), method: 'DELETE', url: '/match/123/follow' });
      assert.equal(get.statusCode, 200);
      assert.deepEqual(get.json(), { following: false, canFollow: false, isFinished: false });
      assert.equal(put.statusCode, 409);
      assert.equal(put.json().error, 'MATCH_MAPPING_REQUIRED');
      assert.equal(del.statusCode, 409);
      assert.equal(del.json().error, 'MATCH_MAPPING_REQUIRED');
    } finally {
      await app.close();
    }
  });
});

test('GET /match/:id/follow checks notification schema before exposing an enabled feature', async () => {
  await withMatchFollowFlag('true', async () => {
    const fakePg = createFakePg({ rows: [{ missing_tables: ['notification.event'] }] });
    const app = buildTestApp(buildApp, { pg: fakePg });
    await app.ready();

    try {
      const response = await app.inject({
        headers: makeAuthHeaders(app, { userId: 42 }),
        method: 'GET',
        url: '/match/123/follow',
      });

      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error, 'FEATURE_DISABLED');
      assert.match(fakePg.calls[0].query, /to_regclass/i);
      assert.ok(fakePg.calls[0].params[0].includes('notification.event'));
    } finally {
      await app.close();
    }
  });
});

test('PUT follows mapped scheduled match using injected SStats fetcher and JWT user only', async () => {
  const calls = [];
  const pg = createFakePg({ handler: async (query, params) => {
    calls.push({ query, params });
    if (/FROM external\.public_match_status/i.test(query)) return [{ is_finished: false, is_cancelled: false }];
    if (/FROM external\.public_match(?!_status)/i.test(query)) return [{ match_id: 700 }];
    return [];
  } });
  const result = await followMatch({ pg, userId: 42, sstatsId: 123, fetcher: async () => ({ game: { status: { id: 1 } } }) });
  assert.deepEqual(result, { following: true, canFollow: true, isFinished: false });
  const upsert = calls.find((call) => /INSERT INTO public\.match_follow/i.test(call.query));
  assert.deepEqual(upsert.params, [42, 700]);
});

test('PUT rejects finished mapped match and DELETE is scoped to current user', async () => {
  const calls = [];
  const pg = createFakePg({ handler: async (query, params) => {
    calls.push({ query, params });
    if (/FROM external\.public_match_status/i.test(query)) return [{ is_finished: true, is_cancelled: false }];
    if (/FROM external\.public_match(?!_status)/i.test(query)) return [{ match_id: 700 }];
    return [];
  } });
  const rejected = await followMatch({ pg, userId: 42, sstatsId: 123, fetcher: async () => ({ game: { status: { id: 8 } } }) });
  assert.deepEqual(rejected, { error: 'MATCH_NOT_FOLLOWABLE', statusCode: 409 });
  const deleted = await unfollowMatch({ pg, userId: 42, sstatsId: 123 });
  assert.deepEqual(deleted, { following: false, canFollow: true, isFinished: false });
  const update = calls.find((call) => /UPDATE public\.match_follow/i.test(call.query));
  assert.deepEqual(update.params, [42, 700]);
});
