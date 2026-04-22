const fs = require('fs');

const DEFAULT_WEBAPP_HOST = 'bet.twfed.com';
const DEFAULT_HTTP_PORT = 8084;
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_HOST = '0.0.0.0';

function normalizeWebAppUrl(raw) {
  const value = String(raw || '').trim();
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);

  if (url.protocol !== 'https:') {
    url.protocol = 'https:';
  }

  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/webapp';
  }

  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function getWebAppUrl(env = process.env) {
  const source = env.WEBAPP_URL || env.WEBAPP_HOST || DEFAULT_WEBAPP_HOST;
  return normalizeWebAppUrl(source);
}

function getHttpsOptions(env = process.env) {
  if (String(env.HTTPS_ENABLE || '') !== '1') {
    return null;
  }

  const domain = env.HTTPS_DOMAIN || env.WEBAPP_HOST || DEFAULT_WEBAPP_HOST;
  const certPath = env.HTTPS_CERT_PATH || `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const keyPath = env.HTTPS_KEY_PATH || `/etc/letsencrypt/live/${domain}/privkey.pem`;

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

function getListenConfig(env = process.env) {
  const httpsEnabled = String(env.HTTPS_ENABLE || '') === '1';
  return {
    port: Number(env.PORT || (httpsEnabled ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT)),
    host: env.DOMAIN || DEFAULT_HOST,
  };
}

module.exports = {
  getWebAppUrl,
  getHttpsOptions,
  getListenConfig,
};
