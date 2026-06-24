const { buildFeedPayload, buildFeedPayloadFromNormalized } = require('../../services/feedService');
const { FALLBACK_TOP_MATCHES, loadWideFeedRecommendations } = require('../../services/recommendationService');
const { getOrBuildSnapshot } = require('../../services/feedSnapshotService');

const FEED_SNAPSHOT_HORIZON_MS = 2 * 60 * 60 * 1000;

async function defaultFeedLoader() {
  const liveItems = await loadWideFeedRecommendations({
    horizonMs: FEED_SNAPSHOT_HORIZON_MS,
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

    const snapshot = await getOrBuildSnapshot(fastify.feedRedis, loader);
    if (snapshot) {
      const payload = buildFeedPayloadFromNormalized(snapshot.items, { window, sport, country, league, limit, offset });
      return { ...payload, feed_version: snapshot.feed_version };
    }

    const rawItems = await loader();
    return buildFeedPayload(rawItems, { window, sport, country, league, limit, offset });
  });
}

module.exports = feedRoutes;
