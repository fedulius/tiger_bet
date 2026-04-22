const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');

test('GET /webapp returns 200 and html', async () => {
  const app = buildApp({
    pg: null,
    bot: null,
  });

  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/webapp',
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
  } finally {
    await app.close();
  }
});
