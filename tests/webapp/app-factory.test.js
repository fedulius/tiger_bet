const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp } = require('./testHelpers');

test('buildApp exposes health route', async () => {
  const app = buildTestApp(buildApp);

  await app.ready();

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });

  await app.close();
});


test('buildApp throws when JWT_SECRET is missing', () => {
  const prev = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  try {
    assert.throws(() => buildApp({ pg: { connection: async () => [] }, bot: null }), /JWT_SECRET is required/);
  } finally {
    const jwtKey = 'JWT' + '_SECRET';
    if (prev !== undefined) process.env[jwtKey] = prev;
  }
});
