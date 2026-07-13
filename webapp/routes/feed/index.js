const { buildFeedPayload, buildFeedPayloadFromNormalized } = require('../../services/feedService');
const { loadWideFeedRecommendations } = require('../../services/recommendationService');
const { fetchAllMatches } = require('../../../lib/stavkaApi');
const {
  getOrBuildSnapshot,
  readCurrentSnapshot,
  readSnapshotByVersion,
} = require('../../services/feedSnapshotService');

const FEED_SNAPSHOT_HORIZON_MS = 2 * 60 * 60 * 1000;

async function defaultFeedLoader() {
  return loadWideFeedRecommendations({
    apiLoader: fetchAllMatches,
    horizonMs: FEED_SNAPSHOT_HORIZON_MS,
  }).catch(() => []);
}

function buildFeedResponse(snapshot, query) {
  const { window = 'all', sport, country, league, limit, offset } = query;
  const payload = buildFeedPayloadFromNormalized(snapshot.items, { window, sport, country, league, limit, offset });
  return { ...payload, feed_version: snapshot.feed_version };
}

async function feedRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const { window = 'all', sport, country, league, limit, offset, feed_version: requestedVersion } = request.query;
    const loader = fastify.feedLoader || defaultFeedLoader;

    if (requestedVersion) {
      const requestedSnapshot = await readSnapshotByVersion(fastify.feedRedis, requestedVersion);
      if (requestedSnapshot) {
        return buildFeedResponse(requestedSnapshot, { window, sport, country, league, limit, offset });
      }

      const currentSnapshot = await readCurrentSnapshot(fastify.feedRedis) || await getOrBuildSnapshot(fastify.feedRedis, loader);
      return reply.code(409).send({
        error: 'STALE_FEED_VERSION',
        message: 'Лента обновилась',
        reload_from_start: true,
        current_feed_version: currentSnapshot?.feed_version || null,
      });
    }

    const snapshot = await getOrBuildSnapshot(fastify.feedRedis, loader);
    if (snapshot) {
      return buildFeedResponse(snapshot, { window, sport, country, league, limit, offset });
    }

    const rawItems = await loader();
    return buildFeedPayload(rawItems, { window, sport, country, league, limit, offset });
  });
}

module.exports = feedRoutes;
