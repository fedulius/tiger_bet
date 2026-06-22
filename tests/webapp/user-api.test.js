const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, makeAuthHeaders } = require('./testHelpers');

test('GET /user returns JWT-backed user profile', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, {
        userId: 777,
        telegram_user_id: 777,
        profile: 'telegram:777',
      }),
      method: 'GET',
      url: '/user',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      telegram_user_id: 777,
      profile: 'telegram:777',
    });
  } finally {
    await app.close();
  }
});

test('GET /user returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/user',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
