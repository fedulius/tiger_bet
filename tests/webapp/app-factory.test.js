const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');

test('buildApp exposes health route', async () => {
  const app = buildApp({
    pg: null,
    bot: null,
  });

  await app.ready();

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });

  await app.close();
});
