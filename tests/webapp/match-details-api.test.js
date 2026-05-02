const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, makeAuthHeaders } = require('./testHelpers');

test('GET /match/:id returns match details with required fields', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/match/fallback-1',
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
    assert.equal(Array.isArray(payload.bets), true);
    assert.equal(payload.bets.length, 3);
    assert.equal(payload.bets[0].coeff >= 1.5 && payload.bets[0].coeff <= 1.9, true);
    assert.equal(payload.bets[1].coeff >= 1.7 && payload.bets[1].coeff <= 2.2, true);
    assert.match(String(payload.bets[2].forecast || ''), /точный счет\s+\d+:\d+/i);
  } finally {
    await app.close();
  }
});

test('GET /match/:id returns 404 for unknown id', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/match/unknown-id',
    });

    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /not found/i);
  } finally {
    await app.close();
  }
});
