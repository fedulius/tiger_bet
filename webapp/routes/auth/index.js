const crypto = require('crypto');

function parseInitData(initDataRaw = '') {
  const params = new URLSearchParams(String(initDataRaw || ''));
  const hash = params.get('hash') || '';
  const authDate = Number(params.get('auth_date') || 0);

  const data = {};
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    data[key] = value;
  }

  return { params, hash, authDate, data };
}

function computeTelegramHash(data = {}, botToken = '') {
  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(String(botToken))
    .digest();

  return crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
}

function extractTelegramUserId(userRaw = '') {
  try {
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    const userId = Number(user?.id);
    return Number.isFinite(userId) ? userId : null;
  } catch {
    return null;
  }
}

function isFreshAuthDate(authDate, maxAgeSeconds = 3600) {
  if (!Number.isFinite(authDate) || authDate <= 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - authDate) <= maxAgeSeconds;
}

async function authRoutes(fastify) {
  const dal = new (require('./DAL'))(fastify.pg);

  fastify.get('/', async (req, res) => {
    const initData = String(req.headers['x-telegram-init-data'] || '');
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();

    if (!botToken) {
      return res.status(500).send({ error: 'TELEGRAM_BOT_TOKEN is required' });
    }

    const { hash, authDate, data } = parseInitData(initData);
    if (!hash || !isFreshAuthDate(authDate)) {
      return res.status(401).send({ error: 'Invalid telegram init data' });
    }

    const expectedHash = computeTelegramHash(data, botToken);
    if (expectedHash !== hash) {
      return res.status(401).send({ error: 'Invalid telegram init data' });
    }

    const telegramUserId = extractTelegramUserId(data.user || '');
    if (!telegramUserId) {
      return res.status(401).send({ error: 'Invalid telegram user' });
    }

    const users = await dal.checkUser(telegramUserId);
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(403).send({ error: 'Access denied' });
    }

    const token = fastify.jwt.sign({ userId: telegramUserId });
    return res.send({ token });
  });
}

module.exports = authRoutes;
module.exports.__private = {
  parseInitData,
  computeTelegramHash,
  extractTelegramUserId,
  isFreshAuthDate,
};
