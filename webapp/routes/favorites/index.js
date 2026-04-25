const { getGuestFavorites, saveGuestFavorites } = require('../../services/favoritesStore');

async function favoritesRoutes(fastify) {
  fastify.get('/', async (request) => {
    // В WebApp window.* доступен только в браузере.
    // На backend получаем initData через заголовок от фронта.

    // const result = await fastify.pg.connection(`
    //     SELECT *
    //     FROM public.favorite_sport
    // `)
    //
    // console.log(result);
    //
    // if (telegramUserId) {
    //   request.log.info({ telegramUserId }, 'favorites request from telegram webapp user');
    // }

    return getGuestFavorites();
  });

  fastify.put('/', async (request, reply) => {
    const payload = request.body || {};

    try {
      return saveGuestFavorites(payload);
    } catch (error) {
      return reply.status(400).send({
        error: error.message || 'Invalid payload',
      });
    }
  });

  fastify.delete('/', async (req, res) => {
    res.send(1);
  });
}

module.exports = favoritesRoutes;
// module.exports.tryExtractTelegramUserId = tryExtractTelegramUserId;
