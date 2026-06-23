const { getRecommendations } = require('../../services/recommendationService');
const { getFavoritesByProfile } = require('../../services/favoritesStore');

async function loadFavoriteSports(fastify, userId, profile) {
  const rows = await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.favorite_sport fs
    JOIN public.sport s ON s.sport_id = fs.sport_id
    WHERE fs.user_id = $1
    ORDER BY fs.sport_id
  `, [userId]);

  const stored = getFavoritesByProfile(profile);
  const settingsMap = new Map((stored.sport_settings || []).map((item) => [String(item.name || '').trim(), item]));

  return rows.map((row) => {
    const sportName = String(row.sport_name || row.sport_url || '').trim();
    const existing = settingsMap.get(sportName);

    return {
      ...row,
      leagues: Array.isArray(existing?.leagues) ? existing.leagues : [],
    };
  });
}

async function recommendationsRoutes(fastify) {
  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    const profile = String(request.user?.profile || '');
    const favoriteSports = await loadFavoriteSports(fastify, userId, profile);
    return await getRecommendations({ favoriteSports });
  });
}

module.exports = recommendationsRoutes;
