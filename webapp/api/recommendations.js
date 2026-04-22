const { getRecommendations } = require('../services/recommendationService');

function registerRecommendationsRoutes(fastify) {
  // Endpoint MVP-контракта для рекомендаций в webApp.
  fastify.get('/api/webapp/recommendations', async () => {
    return await getRecommendations();
  });
}

module.exports = {
  registerRecommendationsRoutes,
};
