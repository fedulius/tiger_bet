const { getDailyPicksFeed } = require('../../services/dailyPickReadService');
const { loadResolvedFavoriteSports } = require('../../services/favoritesStore');
const { logUserEvent } = require('../../services/eventLogService');
const { checkHeavyRouteAccess } = require('../../services/accessCheck');

async function loadFavoriteSports(fastify, userId) {
  return loadResolvedFavoriteSports(fastify.pg, userId);
}

async function recommendationsRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const access = await checkHeavyRouteAccess(fastify, request);
    if (!access.allowed) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const userId = Number(request.user?.userId);
    const favoriteSports = Number.isFinite(userId)
      ? await loadFavoriteSports(fastify, userId)
      : [];

    const dailyPicksFeed = await getDailyPicksFeed(fastify.pg, { favoriteSports });
    await logUserEvent(fastify, request, {
      eventName: 'screen.recommendations_open',
      statusCode: 200,
      entityId: 'recommendations',
      meta: {
        screen: 'recommendations',
        has_daily_picks: Boolean(dailyPicksFeed?.today || dailyPicksFeed?.tomorrow),
      },
    });
    return {
      daily_picks: dailyPicksFeed,
      updated_at: dailyPicksFeed?.updated_at || new Date().toISOString(),
    };
  });
}

module.exports = recommendationsRoutes;
