const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, makeAuthHeaders } = require('./testHelpers');
const {
  clearSstatsListMatchCache,
  rememberSstatsListMatches,
} = require('../../webapp/services/sstatsMatchListCache');

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

test('GET /match/:id falls back to SStats list cache when detail endpoint says not found', async () => {
  clearSstatsListMatchCache();
  rememberSstatsListMatches([{
    id: 424242,
    date: '2026-07-14T18:00:00+03:00',
    status: 1,
    statusName: 'Not started',
    homeTeam: { id: 1, name: 'France', country: { code: 'FR' } },
    awayTeam: { id: 2, name: 'Spain', country: { code: 'ES' } },
    season: { year: 2026, league: { id: 10, name: 'UEFA Euro' } },
    roundName: 'Final',
  }]);

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/Games/424242')) {
      return new Response(JSON.stringify({ data: null }), { status: 404 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 404 });
  };

  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/match/424242',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.id, 424242);
    assert.equal(payload.match, 'Франция — Испания');
    assert.equal(payload.fallbackSource, 'home-list-cache');
  } finally {
    global.fetch = originalFetch;
    clearSstatsListMatchCache();
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

test('GET /match/:id returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/match/fallback-1',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
