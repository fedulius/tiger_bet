const { buildFeedPayload } = require('../../services/feedService');
const { FALLBACK_TOP_MATCHES, loadLiveRecommendations } = require('../../services/recommendationService');

async function defaultFeedLoader() {
  const liveItems = await loadLiveRecommendations({
    limit: 50,
    upcomingOnly: true,
  }).catch(() => []);

  if (Array.isArray(liveItems) && liveItems.length > 0) {
    return liveItems;
  }

  return FALLBACK_TOP_MATCHES;
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
