const { getHistory } = require('../../services/historyService');
const { logUserEvent } = require('../../services/eventLogService');

async function loadFavoriteSports(fastify, userId) {
  return await fastify.pg.connection(`
    SELECT DISTINCT s.sport_id, s.sport_name, s.sport_url
    FROM public.user_tournament ut
    JOIN public.tournament t ON t.tournament_id = ut.tournament_id
    JOIN public.sport s ON s.sport_id = t.sport_id
    WHERE ut.user_id = $1
    ORDER BY s.sport_id
  `, [userId]);
}

async function historyRoutes(fastify) {
  fastify.get('/', async (request) => {
    const sample = String(request.query?.sample || '') === '1';
    const userId = Number(request.user?.userId);
    const favoriteSports = await loadFavoriteSports(fastify, userId);
    const payload = await getHistory({ pg: fastify.pg, sample, favoriteSports });
    await logUserEvent(fastify, request, {
      eventName: 'screen.history_open',
      statusCode: 200,
      entityId: 'history',
      meta: {
        screen: 'history',
        sample,
        items_count: Array.isArray(payload?.items) ? payload.items.length : 0,
      },
    });
    return payload;
  });
}

module.exports = historyRoutes;
