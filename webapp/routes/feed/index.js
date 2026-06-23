const { buildFeedPayload, buildFeedPayloadFromNormalized } = require('../../services/feedService');
const { FALLBACK_TOP_MATCHES, loadLiveRecommendations } = require('../../services/recommendationService');
const { getOrBuildSnapshot } = require('../../services/feedSnapshotService');

const DEFAULT_FEED_SPORTS = [
  { sport_id: 1, sport_name: 'Футбол' },
  { sport_id: 2, sport_name: 'Хоккей' },
  { sport_id: 3, sport_name: 'Теннис' },
  { sport_id: 4, sport_name: 'Баскетбол' },
  { sport_id: 5, sport_name: 'Волейбол' },
  { sport_id: 6, sport_name: 'Бейсбол' },
  { sport_id: 7, sport_name: 'Гандбол' },
  { sport_id: 8, sport_name: 'Футзал' },
  { sport_id: 9, sport_name: 'Снукер' },
  { sport_id: 10, sport_name: 'КС:ГО' },
  { sport_id: 11, sport_name: 'Дота2' },
  { sport_id: 12, sport_name: 'Американский футбол' },
  { sport_id: 13, sport_name: 'MMA' },
  { sport_id: 14, sport_name: 'Бокс' },
];

async function defaultFeedLoader() {
  const liveItems = await loadLiveRecommendations({
    favoriteSports: DEFAULT_FEED_SPORTS,
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
