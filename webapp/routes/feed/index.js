const { buildFeedPayload } = require('../../services/feedService');
const { getRecommendations } = require('../../services/recommendationService');

async function defaultFeedLoader() {
  const result = await getRecommendations({ enableLive: false });
  return Array.isArray(result.items) ? result.items : [];
}

async function feedRoutes(fastify) {
  fastify.get('/', async (request) => {
    const { window = 'all', sport, country, league, limit, offset } = request.query;

    const loader = fastify.feedLoader || defaultFeedLoader;
    const rawItems = await loader();

    return buildFeedPayload(rawItems, { window, sport, country, league, limit, offset });
  });
}

module.exports = feedRoutes;
