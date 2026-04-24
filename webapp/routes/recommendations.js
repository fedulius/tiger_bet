const { getRecommendations } = require('../services/recommendationService');

async function recommendationsRoutes(fastify) {
  // Endpoint MVP-контракта для рекомендаций в webApp.
  fastify.get('/recommendations', async () => {
    return await getRecommendations();
  });
}

module.exports = recommendationsRoutes;
