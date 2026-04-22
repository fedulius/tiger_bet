const { getGuestFavorites, saveGuestFavorites } = require('../services/favoritesStore');

function tryExtractTelegramUserId(initDataRaw = '') {
  try {
    const params = new URLSearchParams(String(initDataRaw || ''));
    console.log(params);
    const userRaw = params.get('user');
    if (!userRaw) return null;

    const user = JSON.parse(userRaw);
    const userId = Number(user?.id);
    return Number.isFinite(userId) ? userId : null;
  } catch {
    return null;
  }
}

function registerFavoritesRoutes(fastify) {
  fastify.get('/api/webapp/favorites', async (request) => {
    // В WebApp window.* доступен только в браузере.
    // На backend получаем initData через заголовок от фронта.
    const initData = request.headers['x-telegram-init-data'] || '';
    const telegramUserId = tryExtractTelegramUserId(initData);

    if (telegramUserId) {
      request.log.info({ telegramUserId }, 'favorites request from telegram webapp user');
    }
    console.log(initData);

    return getGuestFavorites();
  });

  fastify.put('/api/webapp/favorites', async (request, reply) => {
    const payload = request.body || {};

    try {
      return saveGuestFavorites(payload);
    } catch (error) {
      return reply.status(400).send({
        error: error.message || 'Invalid payload',
      });
    }
  });
}

module.exports = {
  registerFavoritesRoutes,
};
