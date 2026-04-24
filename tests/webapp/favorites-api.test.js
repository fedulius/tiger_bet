const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg } = require('./testHelpers');

function makeTempFavoritesFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-favorites-'));
  const filePath = path.join(dir, 'favorites.json');
  fs.writeFileSync(filePath, JSON.stringify({ guest: { sports: [], leagues: [] } }, null, 2));
  return { dir, filePath };
}

test('GET /favorites returns default guest favorites', async () => {
  const temp = makeTempFavoritesFile();
  process.env.WEBAPP_FAVORITES_FILE = temp.filePath;

  const fakePg = createFakePg({ rows: [{ favorite_sport_id: 1, name: 'football' }] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/favorites' });
    assert.equal(response.statusCode, 200);
    assert.equal(fakePg.calls.length, 1);
    assert.match(fakePg.calls[0].query, /FROM public\.favorite_sport/i);
    assert.deepEqual(response.json(), {
      sports: [],
      leagues: [],
      profile: 'guest',
    });
  } finally {
    await app.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
    delete process.env.WEBAPP_FAVORITES_FILE;
  }
});

test('PUT /favorites persists guest favorites', async () => {
  const temp = makeTempFavoritesFile();
  process.env.WEBAPP_FAVORITES_FILE = temp.filePath;

  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: ['football', 'tennis'],
        leagues: ['Premier League', 'ATP'],
      },
    });

    assert.equal(putResponse.statusCode, 200);
    assert.deepEqual(putResponse.json(), {
      sports: ['football', 'tennis'],
      leagues: ['Premier League', 'ATP'],
      profile: 'guest',
    });

    const getResponse = await app.inject({ method: 'GET', url: '/favorites' });
    assert.equal(getResponse.statusCode, 200);
    assert.deepEqual(getResponse.json(), {
      sports: ['football', 'tennis'],
      leagues: ['Premier League', 'ATP'],
      profile: 'guest',
    });
  } finally {
    await app.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
    delete process.env.WEBAPP_FAVORITES_FILE;
  }
});

test('PUT /favorites validates payload arrays', async () => {
  const temp = makeTempFavoritesFile();
  process.env.WEBAPP_FAVORITES_FILE = temp.filePath;

  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
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
    fs.rmSync(temp.dir, { recursive: true, force: true });
    delete process.env.WEBAPP_FAVORITES_FILE;
  }
});
