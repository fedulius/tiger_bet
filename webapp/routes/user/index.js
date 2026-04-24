function tryExtractTelegramUserId(initDataRaw = '') {
  try {
    const params = new URLSearchParams(String(initDataRaw || ''));
    const userRaw = params.get('user');
    if (!userRaw) return null;

    const user = JSON.parse(userRaw);
    const userId = Number(user?.id);
    return Number.isFinite(userId) ? userId : null;
  } catch {
    return null;
  }
}


async function userInfo(fastify) {
  fastify.get('/', async (request, reply) => {
    const initData = request.headers['x-telegram-init-data'] || '';
    const telegramUserId = tryExtractTelegramUserId(initData);

    if (!telegramUserId) {
      return reply.status(401).send({
        error: 'Telegram initData required',
      });
    }
  })
}

module.exports = userInfo;