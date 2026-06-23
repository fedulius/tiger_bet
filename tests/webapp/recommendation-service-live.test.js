const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendations, invalidateRecommendationsCache, loadLiveRecommendations } = require('../../webapp/services/recommendationService');

function makeFakeRedis({ store = {}, getError = null, setError = null } = {}) {
  const deletedKeys = [];

  return {
    deletedKeys,
    async get(key) {
      if (getError) throw getError;
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async set(key, value) {
      if (setError) throw setError;
      store[key] = value;
    },
    async del(...keys) {
      for (const key of keys.flat()) {
        deletedKeys.push(key);
        delete store[key];
      }
    },
  };
}

test('getRecommendations uses live loader data from stavka when available', async () => {
  const payload = await getRecommendations({
    enableLive: true,
    disableCache: true,
    liveLoader: async () => ([
      {
        league: 'England: Premier League',
        matches: [
          {
            team: 'Arsenal - Chelsea',
            link: '/matches/soccer/22-04-2026-arsenal-chelsea',
            time: '19:30',
            date: '22 апр',
          },
        ],
      },
      {
        league: 'Spain: La Liga',
        matches: [
          {
            team: 'Real Madrid - Sevilla',
            link: '/matches/soccer/22-04-2026-real-madrid-sevilla',
            time: '21:00',
            date: '22 апр',
          },
        ],
      },
      {
        league: 'Germany: Bundesliga',
        matches: [
          {
            team: 'Bayern - Dortmund',
            link: '/matches/soccer/22-04-2026-bayern-dortmund',
            time: '22:00',
            date: '22 апр',
          },
        ],
      },
    ]),
    matchPageLoader: async () => `
      <div>Основной прогноз: Победа хозяев с коэффициентом 2.00</div>
      <div>Выбор редакции П1</div>
    `,
  });

  assert.equal(payload.source, 'stavka-live');
  assert.equal(payload.items.length, 3);
  assert.match(payload.items[0].match, /vs/);
  assert.match(payload.items[0].source_url, /^https:\/\/stavka\.tv\//);
  assert.match(payload.items[0].main_thought, /Победа хозяев|П1/i);
});

test('getRecommendations falls back to fallback-top when live loader returns empty', async () => {
  const payload = await getRecommendations({
    enableLive: true,
    disableCache: true,
    liveLoader: async () => [],
  });

  assert.equal(payload.source, 'fallback-top');
  assert.equal(payload.items.length, 3);
});

test('loadLiveRecommendations prefers upcoming matches for feed-oriented consumers', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 10,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([
      {
        league: 'Mixed League',
        matches: [
          { team: 'Past One - Past Two', link: '/matches/soccer/past', time: '16:00', date: '23 июн' },
          { team: 'Soon One - Soon Two', link: '/matches/soccer/soon', time: '19:30', date: '23 июн' },
          { team: 'Tomorrow One - Tomorrow Two', link: '/matches/soccer/tomorrow', time: '11:00', date: '24 июн' },
        ],
      },
    ]),
    matchPageLoader: async () => '<div>Основной прогноз: П1</div>',
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.match), ['Soon One vs Soon Two', 'Tomorrow One vs Tomorrow Two']);
  assert.ok(items.every((item) => new Date(item.starts_at).getTime() > now));
});

test('getRecommendations returns Redis-cached payload on cache hit without calling live loader', async () => {
  const generationTime = '2026-06-23T10:00:00.000Z';
  const cachedPayload = {
    items: [{ id: 'cached-1', match: 'Cached vs Other', starts_at: '2026-06-23T12:00:00.000Z', is_new: false, bets: [] }],
    source: 'stavka-live',
    updated_at: generationTime,
  };
  const store = { 'recommendations:default': JSON.stringify(cachedPayload) };
  const redis = makeFakeRedis({ store });

  let liveLoaderCalled = false;
  const payload = await getRecommendations({
    enableLive: true,
    disableCache: false,
    redisClient: redis,
    liveLoader: async () => { liveLoaderCalled = true; return []; },
  });

  assert.deepEqual(payload, cachedPayload);
  assert.equal(payload.updated_at, generationTime, 'updated_at must be original generation time, not serve time');
  assert.equal(liveLoaderCalled, false, 'live loader must not be called on cache hit');
});

test('getRecommendations stores live result in Redis on cache miss', async () => {
  const store = {};
  const redis = makeFakeRedis({ store });
  // Use sport_id 55 so hasFavoriteSports=true, which bypasses the shared module-level liveCache
  const favoriteSports = [{ sport_id: 55, sport_name: 'TestSport', leagues: [] }];

  const payload = await getRecommendations({
    enableLive: true,
    disableCache: false,
    redisClient: redis,
    favoriteSports,
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Team A - Team B', link: '/matches/test/test-store', time: '20:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => '<div>Основной прогноз: Победа хозяев</div>',
  });

  assert.equal(payload.source, 'favorites');
  const keys = Object.keys(store);
  assert.equal(keys.length, 1, 'result must be written to Redis');
  const stored = JSON.parse(store[keys[0]]);
  assert.equal(stored.source, 'favorites');
  assert.equal(stored.updated_at, payload.updated_at, 'stored updated_at must match generation time');
});

test('getRecommendations falls through to live fetch when Redis get throws', async () => {
  // Use sport_id 57 so hasFavoriteSports=true, bypassing the shared module-level liveCache
  const redis = makeFakeRedis({ getError: new Error('connection refused') });
  const favoriteSports = [{ sport_id: 57, sport_name: 'TestSport3', leagues: [] }];

  const payload = await getRecommendations({
    enableLive: true,
    disableCache: false,
    redisClient: redis,
    favoriteSports,
    liveLoader: async () => ([{
      league: 'La Liga',
      matches: [{ team: 'Real - Barca', link: '/matches/soccer/test-get-err', time: '21:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => '',
  });

  assert.equal(payload.source, 'favorites', 'must still return live data after Redis get error');
  assert.equal(payload.items.length, 1);
});

test('getRecommendations returns result even when Redis set throws', async () => {
  // Use sport_id 56 so hasFavoriteSports=true, bypassing the shared module-level liveCache
  const redis = makeFakeRedis({ setError: new Error('write failed') });
  const favoriteSports = [{ sport_id: 56, sport_name: 'TestSport2', leagues: [] }];

  const payload = await getRecommendations({
    enableLive: true,
    disableCache: false,
    redisClient: redis,
    favoriteSports,
    liveLoader: async () => ([{
      league: 'Bundesliga',
      matches: [{ team: 'Bayern - Dortmund', link: '/matches/soccer/test-set-err', time: '18:30', date: '23 июн' }],
    }]),
    matchPageLoader: async () => '',
  });

  assert.equal(payload.source, 'favorites', 'result must be returned even if cache write fails');
  assert.equal(payload.items.length, 1);
});

test('getRecommendations with favoriteSports uses a different cache key than default', async () => {
  const store = {};
  const redis = makeFakeRedis({ store });

  await getRecommendations({
    enableLive: true,
    disableCache: false,
    redisClient: redis,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Premier League',
      matches: [{ team: 'Arsenal - Chelsea', link: '/matches/soccer/test-fav', time: '20:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => '',
  });

  const keys = Object.keys(store);
  assert.equal(keys.length, 1);
  assert.notEqual(keys[0], 'recommendations:default', 'favoriteSports must use a distinct cache key');
  assert.ok(keys[0].startsWith('recommendations:'), 'cache key must use recommendations: namespace');
});

test('getRecommendations skips Redis entirely when disableCache is true', async () => {
  let getCalled = false;
  const redis = {
    async get() { getCalled = true; return null; },
    async set() {},
  };

  await getRecommendations({
    enableLive: true,
    disableCache: true,
    redisClient: redis,
    liveLoader: async () => [],
  });

  assert.equal(getCalled, false, 'Redis must not be queried when disableCache is true');
});

test('invalidateRecommendationsCache deletes old and new favorites keys', async () => {
  const store = {
    'recommendations:1:Premier League': JSON.stringify({ ok: true }),
    'recommendations:1:La Liga': JSON.stringify({ ok: true }),
  };
  const redis = makeFakeRedis({ store });

  const result = await invalidateRecommendationsCache({
    favoriteSportsSets: [
      [{ sport_id: 1, sport_name: 'Футбол', leagues: ['Premier League'] }],
      [{ sport_id: 1, sport_name: 'Футбол', leagues: ['La Liga'] }],
    ],
    redisClient: redis,
  });

  assert.deepEqual(redis.deletedKeys.sort(), ['recommendations:1:La Liga', 'recommendations:1:Premier League']);
  assert.deepEqual(result.invalidated_keys.sort(), ['recommendations:1:La Liga', 'recommendations:1:Premier League']);
  assert.deepEqual(store, {});
});
