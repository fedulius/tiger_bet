const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

test('GET /webapp serves React dist index when webappFrontendMode=react', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-react-dist-'));
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><div id="root">React</div></body></html>');
  fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("react")');

  const app = buildApp({
    pg: null,
    bot: null,
    webappFrontendMode: 'react',
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
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
