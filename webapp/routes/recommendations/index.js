const { getRecommendations } = require('../../services/recommendationService');
const { fetchAllMatches, fetchPopularBets, selectRiskBets } = require('../../../lib/stavkaApi');
const { loadResolvedFavoriteSports } = require('../../services/favoritesStore');
const { getDailyPicksFeed } = require('../../services/dailyPickReadService');

async function loadFavoriteSports(fastify, userId) {
  return loadResolvedFavoriteSports(fastify.pg, userId);
}

async function recommendationsRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const userId = Number(request.user?.userId);
    const favoriteSports = await loadFavoriteSports(fastify, userId);

    // Load recommendations from match_analysis (via dailyPickReadService)
    const dailyPicksFeed = await getDailyPicksFeed(fastify.pg, { favoriteSports });

    // Also load live recommendations from stavka.tv API
    const recommendationsVersion = String(request.query?.recommendations_version || '').trim();
    const recResult = await getRecommendations({
      favoriteSports,
      recommendationsVersion,
      redisClient: fastify.recommendationsRedis,
      apiLoader: fetchAllMatches,
      popularBetsLoader: fetchPopularBets,
      riskBetsSelector: selectRiskBets,
    });

    if (recResult?.stale_version) {
      reply.code(409);
      return {
        error: 'STALE_RECOMMENDATIONS_VERSION',
        message: 'Рекомендации обновились',
        reload_from_start: true,
        recommendations_version: recResult.recommendations_version,
        current_recommendations_version: recResult.current_recommendations_version || '',
      };
    }

    // Merge: daily picks (from match_analysis) + live recommendations
    const items = recResult?.items || [];
    return {
      items,
      daily_picks: dailyPicksFeed,
      source: recResult?.source || 'stavka-live',
      updated_at: dailyPicksFeed?.updated_at || recResult?.updated_at || new Date().toISOString(),
    };
  });
}

module.exports = recommendationsRoutes;
