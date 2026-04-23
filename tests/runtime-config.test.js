const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getWebAppUrl,
  getHttpsOptions,
  getListenConfig,
  getWebAppFrontendMode,
} = require('../server/runtimeConfig');

test('getWebAppUrl defaults to bet.twfed.com/webapp over https', () => {
  const url = getWebAppUrl({});
  assert.equal(url, 'https://bet.twfed.com/webapp');
});

test('getWebAppUrl normalizes bare host into https webapp url', () => {
  const url = getWebAppUrl({ WEBAPP_URL: 'bet.twfed.com' });
  assert.equal(url, 'https://bet.twfed.com/webapp');
});

test('getHttpsOptions returns null when HTTPS_ENABLE is not 1', () => {
  const options = getHttpsOptions({ HTTPS_ENABLE: '0' });
  assert.equal(options, null);
});

test('getHttpsOptions loads cert and key when HTTPS_ENABLE=1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-https-'));
  const certPath = path.join(dir, 'fullchain.pem');
  const keyPath = path.join(dir, 'privkey.pem');

  fs.writeFileSync(certPath, 'CERT_CONTENT');
  fs.writeFileSync(keyPath, 'KEY_CONTENT');

  const options = getHttpsOptions({
    HTTPS_ENABLE: '1',
    HTTPS_CERT_PATH: certPath,
    HTTPS_KEY_PATH: keyPath,
  });

  assert.equal(String(options.cert), 'CERT_CONTENT');
  assert.equal(String(options.key), 'KEY_CONTENT');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('getListenConfig uses 443 by default in HTTPS mode', () => {
  const config = getListenConfig({ HTTPS_ENABLE: '1' });
  assert.equal(config.port, 443);
  assert.equal(config.host, '0.0.0.0');
});

test('getWebAppFrontendMode defaults to legacy', () => {
  const mode = getWebAppFrontendMode({});
  assert.equal(mode, 'legacy');
});

test('getWebAppFrontendMode accepts react and normalizes case/spaces', () => {
  const mode = getWebAppFrontendMode({ WEBAPP_FRONTEND_MODE: ' React ' });
  assert.equal(mode, 'react');
});

test('getWebAppFrontendMode falls back to legacy for unknown values', () => {
  const mode = getWebAppFrontendMode({ WEBAPP_FRONTEND_MODE: 'nextjs' });
  assert.equal(mode, 'legacy');
});
