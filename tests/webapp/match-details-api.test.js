const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');

test('GET /api/webapp/match/:id returns match details with required fields', async () => {
  const app = buildApp({ pg: null, bot: null });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/webapp/match/fallback-1',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.ok(payload.id);
    assert.ok(payload.match);
    assert.ok(payload.league);
    assert.ok(payload.starts_at);
    assert.ok(payload.main_thought);
    assert.equal(typeof payload.confidence, 'number');
    assert.equal(typeof payload.basis, 'string');
    assert.equal(typeof payload.source_url, 'string');
    assert.match(payload.source_url, /^https?:\/\//i);
  } finally {
    await app.close();
  }
});

test('GET /api/webapp/match/:id returns 404 for unknown id', async () => {
  const app = buildApp({ pg: null, bot: null });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/webapp/match/unknown-id',
    });

    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /not found/i);
  } finally {
    await app.close();
  }
});
