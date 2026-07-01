const { getHistory } = require('../../services/historyService');

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
    return getHistory({ sample, favoriteSports });
  });
}

module.exports = historyRoutes;
