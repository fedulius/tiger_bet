const { getHistory } = require('../../services/historyService');
const { logUserEvent } = require('../../services/eventLogService');

async function loadFavoriteSports(fastify, userId) {
  return await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.user_sport fs
    JOIN public.sport s ON s.sport_id = fs.sport_id
    WHERE fs.user_id = $1
    ORDER BY fs.sport_id
  `, [userId]);
}

async function historyRoutes(fastify) {
  fastify.get('/', async (request) => {
    const sample = String(request.query?.sample || '') === '1';
    const userId = Number(request.user?.userId);
    const favoriteSports = await loadFavoriteSports(fastify, userId);
    const payload = getHistory({ sample, favoriteSports });
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
