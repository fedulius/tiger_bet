async function userInfo(fastify) {
  fastify.get('/', async (request, reply) => {
    const telegramUserId = Number(
      request.user?.telegram_user_id
      ?? request.user?.userId
      ?? request.user?.sub,
    );

    if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    return {
      telegram_user_id: telegramUserId,
      profile: String(request.user?.profile || `telegram:${telegramUserId}`),
    };
  });
}

module.exports = userInfo;