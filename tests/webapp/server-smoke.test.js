const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildApp } = require('../../server/app');
const { buildTestApp } = require('./testHelpers');

test('GET /webapp returns 503 when react dist is missing', async () => {
  const missingDir = path.join(os.tmpdir(), `tiger-bet-react-missing-${Date.now()}`);
  const app = buildTestApp(buildApp, {
    reactDistDir: missingDir,
  });

  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/webapp',
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /index\.html/);
  } finally {
    await app.close();
  }
});

test('GET /webapp serves React dist index', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-react-dist-'));
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><div id="root">React</div></body></html>');
  fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("react")');

  const app = buildTestApp(buildApp, {
    reactDistDir: dir,
  });

  await app.ready();

  try {
    const indexResponse = await app.inject({
      method: 'GET',
      url: '/webapp',
    });

    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.body, /id="root">React</);

    const assetResponse = await app.inject({
      method: 'GET',
      url: '/webapp/assets/app.js',
    });

    assert.equal(assetResponse.statusCode, 200);
    assert.match(assetResponse.body, /console\.log\("react"\)/);

    const matchCompatResponse = await app.inject({
      method: 'GET',
      url: '/webapp/match.html?id=match-42',
    });

    assert.equal(matchCompatResponse.statusCode, 200);
    assert.match(matchCompatResponse.body, /id="root">React</);

    const matchRouteResponse = await app.inject({
      method: 'GET',
      url: '/webapp/match/fallback-1',
    });

    assert.equal(matchRouteResponse.statusCode, 200);
    assert.match(matchRouteResponse.body, /id="root">React</);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
