const { getGuestFavorites, saveGuestFavorites } = require('../services/favoritesStore');

function registerFavoritesRoutes(fastify) {
  fastify.get('/api/webapp/favorites', async () => {
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
