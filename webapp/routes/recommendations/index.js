const { getDailyPicksFeed } = require('../../services/dailyPickReadService');
const { loadResolvedFavoriteSports } = require('../../services/favoritesStore');

async function loadFavoriteSports(fastify, userId) {
  return loadResolvedFavoriteSports(fastify.pg, userId);
}

async function recommendationsRoutes(fastify) {
  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    const favoriteSports = Number.isFinite(userId)
      ? await loadFavoriteSports(fastify, userId)
      : [];

    const dailyPicksFeed = await getDailyPicksFeed(fastify.pg, { favoriteSports });
    return {
      daily_picks: dailyPicksFeed,
      updated_at: dailyPicksFeed?.updated_at || new Date().toISOString(),
    };
  });
}

module.exports = recommendationsRoutes;
