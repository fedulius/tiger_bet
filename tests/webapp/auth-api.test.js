const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg } = require('./testHelpers');

function makeInitData({ userId = 123, botToken = 'test-bot-token', authDate = Math.floor(Date.now() / 1000) } = {}) {
  const user = JSON.stringify({ id: userId, first_name: 'T', username: 'u' });
  const data = {
    auth_date: String(authDate),
    query_id: 'AAEAAAE',
    user,
  };

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams();
  params.set('auth_date', data.auth_date);
  params.set('query_id', data.query_id);
  params.set('user', data.user);
  params.set('hash', hash);
  return params.toString();
}

test('GET /auth returns token for valid telegram init data and allowed user', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  const fakePg = createFakePg({ rows: [{ user_id: 1 }] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: {
        'x-telegram-init-data': makeInitData({ botToken: process.env.TELEGRAM_BOT_TOKEN, userId: 777 }),
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(typeof payload.token, 'string');
  } finally {
    await app.close();
  }
});

test('GET /auth returns 401 for invalid hash', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  const app = buildTestApp(buildApp, { pg: createFakePg({ rows: [{ user_id: 1 }] }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: {
        'x-telegram-init-data': 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=bad',
      },
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /auth returns 403 when telegram user is not allowed', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  const app = buildTestApp(buildApp, { pg: createFakePg({ rows: [] }) });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: {
        'x-telegram-init-data': makeInitData({ botToken: process.env.TELEGRAM_BOT_TOKEN, userId: 999 }),
      },
    });

    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});
