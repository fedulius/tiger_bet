const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendations, invalidateRecommendationsCache, loadLiveRecommendations, loadWideFeedRecommendations } = require('../../webapp/services/recommendationService');
const { extractRecommendationZones, extractEditorialForecast, analyzeForecastFromHtml, parseCanonicalMarket, normalizeMarketText, buildMarketKey, formatCanonicalForecast, buildBetCandidate, resolveLocalCoeffNearForecast, extractBetCandidatesFromZone, collectCandidatesAcrossZones, sanitizeCandidateDescription, scoreBetCandidate, isCandidateAcceptable } = require('../../lib/forecastAnalyzer');

test('extractRecommendationZones (line-before-article): articleZone does not capture betting line before article anchor', () => {
  const html = `
    <div class="odds">П1 1.80 Х 3.50 П2 4.20</div>
    <a href="/line">Смотреть всю линию</a>
    <h2>Прогноз на матч</h2>
    <p>Команда А в хорошей форме последние пять матчей.</p>
  `;
  const zones = extractRecommendationZones(html);
  assert.equal(typeof zones.articleZone, 'string', 'articleZone must be string');
  assert.equal(typeof zones.mainForecastZone, 'string', 'mainForecastZone must be string');
  assert.equal(typeof zones.editorChoiceZone, 'string', 'editorChoiceZone must be string');
  assert.ok(!zones.articleZone.includes('1.80'), 'articleZone must not contain betting odds from before the anchor');
  assert.ok(!zones.articleZone.includes('Смотреть всю линию'), 'articleZone must not contain line link preceding the anchor');
  assert.ok(zones.articleZone.includes('Команда А'), 'articleZone must contain actual forecast text');
});

test('extractRecommendationZones (footer-after-article): articleZone truncates before footer and contact details', () => {
  const html = `
    <h2>Прогноз на матч</h2>
    <p>Матч обещает быть напряжённым. Хозяева должны взять три очка.</p>
    <div class="footer">
      <span>Телефон редакции: +7 (495) 123-45-67</span>
      <span>Почта редакции: info@example.ru</span>
      <span>Адрес: Москва, ул. Примерная, 1</span>
    </div>
  `;
  const zones = extractRecommendationZones(html);
  assert.ok(!zones.articleZone.includes('Телефон редакции'), 'articleZone must not include phone section');
  assert.ok(!zones.articleZone.includes('Почта редакции'), 'articleZone must not include email section');
  assert.ok(!zones.articleZone.includes('Адрес:'), 'articleZone must not include address section');
  assert.ok(zones.articleZone.includes('Хозяева'), 'articleZone must retain forecast content before footer');
});

test('extractRecommendationZones (community/service junk): articleZone strips participation and service phrases', () => {
  const html = `
    <h2>Прогноз на матч</h2>
    <p>Фаворит явно выражен в этом противостоянии.</p>
    <a>Принять участие</a>
    <div>Статистика отсутствует</div>
    <button>Повторить</button>
    <p>Ставка на победу гостей выглядит разумной.</p>
  `;
  const zones = extractRecommendationZones(html);
  assert.ok(!zones.articleZone.includes('Принять участие'), 'articleZone must not include community participation link');
  assert.ok(!zones.articleZone.includes('Статистика отсутствует'), 'articleZone must not include stats-absent notice');
  assert.ok(!zones.articleZone.includes('Повторить'), 'articleZone must not include retry button text');
  assert.ok(zones.articleZone.includes('Фаворит'), 'articleZone must retain actual forecast text');
  assert.ok(zones.articleZone.includes('Ставка'), 'articleZone must retain text after junk phrases');
});

test('extractRecommendationZones (time-service-fragment): articleZone strips "Сегодня в HH:MM по МСК" fragments', () => {
  const html = `
    <h2>Прогноз на матч</h2>
    <p>Встреча пройдёт на стадионе. Сегодня в 18:30 по МСК начнётся матч.</p>
    <p>Фаворит имеет преимущество по xG за сезон.</p>
  `;
  const zones = extractRecommendationZones(html);
  assert.ok(!zones.articleZone.includes('Сегодня в 18:30 по МСК'), 'articleZone must not include time-service fragments');
  assert.ok(zones.articleZone.includes('Фаворит'), 'articleZone must retain forecast text after the stripped fragment');
});

test('extractRecommendationZones (contest-stop-marker): articleZone truncates before contest footer', () => {
  const html = `
    <h2>Прогноз на матч</h2>
    <p>Команда хозяев выглядит свежее и стабильнее по последним турам.</p>
    <div>Бесплатный конкурс прогнозистов</div>
    <p>ЭТО_НЕ_ДОЛЖНО_ПОПАСТЬ_В_ARTICLE_ZONE</p>
  `;
  const zones = extractRecommendationZones(html);
  assert.ok(!zones.articleZone.includes('Бесплатный конкурс прогнозистов'), 'contest footer marker must be excluded');
  assert.ok(!zones.articleZone.includes('ЭТО_НЕ_ДОЛЖНО_ПОПАСТЬ_В_ARTICLE_ZONE'), 'text after contest footer marker must be truncated');
  assert.ok(zones.articleZone.includes('Команда хозяев'), 'forecast text before contest footer must remain');
});

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
      <h3>Основной прогноз</h3>
      <p>Победа хозяев с коэффициентом 2.00. Тотал больше 2.5 с коэффициентом 1.95.</p>
      <h3>Выбор редакции</h3>
      <p>Обе забьют с коэффициентом 1.88.</p>
    `,
  });

  assert.equal(payload.source, 'stavka-live');
  assert.equal(payload.items.length, 3);
  assert.match(payload.items[0].match, /vs/);
  assert.match(payload.items[0].source_url, /^https:\/\/stavka\.tv\//);
  assert.match(payload.items[0].main_thought, /Победа хозяев|П1|Обе забьют/i);
  assert.equal(payload.items[0].bets[0].coeff, 1.9, 'editorial coeff should drive primary bet coeff when present');
});

test('loadLiveRecommendations populates editorial_rationale from match page when rationale sentences present', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 1,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Alpha - Beta', link: '/matches/soccer/alpha-beta', time: '19:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => `
      <h3>Основной прогноз</h3>
      <p>Победа хозяев с кэфом 1.72. Тотал больше 2.5 с коэффициентом 1.91. Команда в хорошей форме последние 4 матча. Гости ослаблены травмами.</p>
      <h3>Выбор редакции</h3>
      <p>Обе забьют с коэффициентом 1.87.</p>
    `,
  });

  assert.equal(items.length, 1);
  const rationale = items[0].editorial_rationale;
  assert.equal(typeof rationale, 'string', 'editorial_rationale must be a string');
  assert.ok(rationale.length > 0, 'editorial_rationale must not be empty when rationale sentences present in page');
  assert.ok(!rationale.includes('Победа хозяев'), 'editorial_rationale must not repeat the main pick sentence');
});

test('loadLiveRecommendations builds structured primary bet from candidate pipeline when forecast and coeff exist', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 1,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Alpha - Beta', link: '/matches/soccer/alpha-beta', time: '19:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => `
      <h3>Основной прогноз</h3>
      <p>Ставим на П1 с коэффициентом 1.85. Тотал больше 2.5 с коэффициентом 1.95.</p>
      <h3>Выбор редакции</h3>
      <p>Обе забьют с коэффициентом 1.88.</p>
    `,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].source_coeff, 1.85);
  assert.ok(Array.isArray(items[0].bets));
  assert.equal(items[0].bets[0].type, 'primary');
  assert.equal(items[0].bets[0].risk_order, 1);
  assert.equal(items[0].bets[0].risk_label, 'low');
  assert.equal(items[0].bets[0].forecast, 'П1');
  assert.equal(items[0].bets[0].coeff, 1.85);
});

test('loadLiveRecommendations dedupes duplicate market across zones in final bets', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 1,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Alpha - Beta', link: '/matches/soccer/alpha-beta', time: '19:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => `
      <h3>Выбор редакции</h3>
      <p>П1 с коэффициентом 1.90. Обе забьют с коэффициентом 1.88.</p>
      <h3>Прогноз на матч</h3>
      <p>П1 с коэффициентом 2.10. Тотал больше 2.5 с коэффициентом 1.95.</p>
    `,
  });

  assert.equal(items.length, 1);
  const forecasts = items[0].bets.map((bet) => bet.forecast);
  assert.equal(forecasts.filter((x) => x === 'П1').length, 1, 'duplicate P1 must not survive as duplicate final bets');
});

test('loadLiveRecommendations excludes item when quality filter leaves fewer than 3 acceptable candidates', async () => {
  // Only one acceptable candidate survives (П1 with coeff). The other extracted candidate has no coeff.
  // Phase 4.2a fail-closed: editorial candidate-driven item must be excluded instead of falling back.
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 1,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Alpha - Beta', link: '/matches/soccer/alpha-beta', time: '19:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => `
      <h3>Основной прогноз</h3>
      <p>Ставим на П1 с коэффициентом 1.85.</p>
      <h3>Выбор редакции</h3>
      <p>П2</p>
    `,
  });

  assert.equal(items.length, 0, 'item must be excluded when fewer than 3 acceptable candidate-driven bets remain');
});

test('loadLiveRecommendations keeps item when 3 acceptable candidate-driven bets exist', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 1,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([{
      league: 'Test League',
      matches: [{ team: 'Alpha - Beta', link: '/matches/soccer/alpha-beta', time: '19:00', date: '23 июн' }],
    }]),
    matchPageLoader: async () => `
      <h3>Основной прогноз</h3>
      <p>Ставим на П1 с коэффициентом 1.85. Тотал больше 2.5 с коэффициентом 1.95.</p>
      <h3>Выбор редакции</h3>
      <p>Обе забьют с коэффициентом 1.88.</p>
    `,
  });

  assert.equal(items.length, 1, 'item must survive when 3 acceptable candidate-driven bets exist');
  assert.ok(Array.isArray(items[0].bets));
  assert.equal(items[0].bets.length, 3);
  assert.deepEqual(items[0].bets.map((bet) => bet.type), ['primary', 'value', 'additional']);
  assert.deepEqual(items[0].bets.map((bet) => bet.risk_order), [1, 2, 3]);
  assert.deepEqual(items[0].bets.map((bet) => bet.risk_label), ['low', 'medium', 'high']);
  const forecasts = items[0].bets.map((bet) => bet.forecast);
  assert.deepEqual(forecasts, ['П1', 'Обе забьют — да', 'Тотал больше 2.5']);
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
          { team: 'Past One - Past Two', link: '/matches/soccer/past', time: '14:00', date: '23 июн' },
          { team: 'Soon One - Soon Two', link: '/matches/soccer/soon', time: '19:30', date: '23 июн' },
          { team: 'Tomorrow One - Tomorrow Two', link: '/matches/soccer/tomorrow', time: '11:00', date: '24 июн' },
        ],
      },
    ]),
    matchPageLoader: async () => '',
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.match), ['Soon One vs Soon Two', 'Tomorrow One vs Tomorrow Two']);
  assert.ok(items.every((item) => new Date(item.starts_at).getTime() > now));
});

test('loadWideFeedRecommendations uses global /matches source and keeps only next 2 hours', async () => {
  const now = new Date('2026-06-23T15:00:00.000Z').getTime();
  const items = await loadWideFeedRecommendations({
    now,
    horizonMs: 2 * 60 * 60 * 1000,
    liveLoader: async () => ([
      {
        league: 'England: Premier League',
        matches: [
          { team: 'Arsenal - Chelsea', link: '/matches/soccer/arsenal-chelsea', time: '16:50', date: '23 июн' },
          { team: 'Late Match - Later Opponent', link: '/matches/soccer/late-match', time: '18:30', date: '23 июн' },
        ],
      },
      {
        league: 'ATP Halle',
        matches: [
          { team: 'Sinner - Medvedev', link: '/matches/tennis/sinner-medvedev', time: '16:30', date: '23 июн' },
        ],
      },
    ]),
    matchPageLoader: async () => '',
  });

  assert.deepEqual(items.map((item) => item.match), ['Sinner vs Medvedev', 'Arsenal vs Chelsea']);
  assert.deepEqual(items.map((item) => item.sport_name), ['Теннис', 'Футбол']);
  assert.ok(items.every((item) => new Date(item.starts_at).getTime() > now));
  assert.ok(items.every((item) => new Date(item.starts_at).getTime() <= now + (2 * 60 * 60 * 1000)));
});

test('loadLiveRecommendations rechecks recently-started rows against match page header before dropping them from feed', async () => {
  const now = new Date('2026-06-23T16:00:00.000Z').getTime();
  const items = await loadLiveRecommendations({
    now,
    limit: 10,
    upcomingOnly: true,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол', leagues: [] }],
    liveLoader: async () => ([
      {
        league: 'Мир: Чемпионат мира',
        matches: [
          { team: 'Португалия - Узбекистан', link: '/matches/soccer/portugal-uzbekistan', time: '17:00', date: '23 июн' },
          { team: 'Англия - Гана', link: '/matches/soccer/england-ghana', time: '20:00', date: '23 июн' },
        ],
      },
    ]),
    matchPageLoader: async (url) => {
      if (url.includes('portugal-uzbekistan')) {
        return `
          <div class="text-h1 info-top">17:00</div>
          <div class="info-bottom">23 июня</div>
          <script type="application/ld+json">{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [{
              "@type": "Question",
              "name": "Когда состоится матч Португалия – Узбекистан?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Матч второго тура группового этапа чемпионата мира между сборными Португалии и Узбекистана пройдёт 23 июня 2026 года в 20:00 по московскому времени."
              }
            }]
          }</script>
        `;
      }
      return `
        <div class="text-h1 info-top">20:00</div>
        <div class="info-bottom">23 июня</div>
      `;
    },
  });

  assert.deepEqual(items.map((item) => item.match), ['Португалия vs Узбекистан', 'Англия vs Гана']);
  assert.equal(items[0].starts_at, '2026-06-23T17:00:00.000Z');
  assert.equal(items[1].starts_at, '2026-06-23T20:00:00.000Z');
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
    matchPageLoader: async () => '',
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

test('extractEditorialForecast (zones): mainThought excludes text outside forecast zones', () => {
  const html = `
    <p>ДОЛЖЕН_БЫТЬ_ИСКЛЮЧЁН — вводный текст до блоков прогноза.</p>
    <h3>Основной прогноз</h3>
    <p>Победа хозяев выглядит вероятной. Гости ослаблены.</p>
  `;
  const result = extractEditorialForecast(html);
  assert.ok(result !== null, 'should return a result');
  assert.ok(!result.mainThought.includes('ДОЛЖЕН_БЫТЬ_ИСКЛЮЧЁН'), 'mainThought must not include text from outside forecast zones');
  assert.ok(result.mainThought.includes('Победа хозяев'), 'mainThought must include text from mainForecastZone');
});

test('extractEditorialForecast (zones): editorChoiceZone drives mainThought over mainForecastZone', () => {
  const html = `
    <h3>Основной прогноз</h3>
    <p>Победа хозяев. Команда в форме.</p>
    <h3>Выбор редакции</h3>
    <p>Ставим на П1 — явный фаворит матча.</p>
  `;
  const result = extractEditorialForecast(html);
  assert.ok(result !== null, 'should return a result');
  assert.ok(
    result.mainThought.includes('Ставим') || result.mainThought.includes('П1'),
    'mainThought must prefer editorChoiceZone content when present',
  );
});

test('extractEditorialForecast (zones): rationale comes from mainForecastZone sentences only', () => {
  const html = `
    <p>НЕ_ДОЛЖНО_БЫТЬ_В_RATIONALE — преамбула страницы.</p>
    <h3>Основной прогноз</h3>
    <p>Главный вывод аналитиков. Команда в отличной форме. Гости нестабильны.</p>
  `;
  const result = extractEditorialForecast(html);
  assert.ok(result !== null, 'should return a result');
  assert.ok(!result.rationale.includes('НЕ_ДОЛЖНО_БЫТЬ_В_RATIONALE'), 'rationale must not include preamble from outside mainForecastZone');
  assert.ok(
    result.rationale.includes('Команда в отличной форме') || result.rationale.includes('Гости нестабильны'),
    'rationale must come from sentences within mainForecastZone',
  );
});

test('analyzeForecastFromHtml (zones): pre-zone betting line percents do not leak into bets result', () => {
  const html = `
    <div class="odds-line">П1: 80% Х: 10% П2: 10%</div>
    <h3>Основной прогноз</h3>
    <p>Победа гостей выглядит вероятной. П2: 65%</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'П2', 'zone-internal П2:65% must win over pre-zone П1:80%');
  assert.equal(result.source, 'percent-signals');
});

test('analyzeForecastFromHtml (zones): pre-zone odds widget does not override zone-internal odds signals', () => {
  const html = `
    <div class="odds-widget">П1 1.20 Х 5.00 П2 9.00</div>
    <h3>Основной прогноз</h3>
    <p>Аутсайдер имеет шансы. П2 2.10 Х 3.20 П1 4.50</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'П2', 'zone-internal odds must determine result, not pre-zone widget');
  assert.equal(result.source, 'odds-implied');
});

test('analyzeForecastFromHtml (zones): returns no-signal when all percent signals are outside any zone', () => {
  const html = `
    <div class="community">П1: 70% Х: 15% П2: 15%</div>
    <p>Матч обещает быть интересным без явного фаворита.</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.source, 'no-signal', 'must return no-signal when signals exist only outside zones');
  assert.equal(result.bestOutcome, 'нет сигнала');
});

test('parseCanonicalMarket: 1x2 — П1/П2/Х and their aliases', () => {
  assert.deepEqual(parseCanonicalMarket('П1'), { type: '1x2', pick: 'П1' });
  assert.deepEqual(parseCanonicalMarket('1'), { type: '1x2', pick: 'П1' });
  assert.deepEqual(parseCanonicalMarket('П2'), { type: '1x2', pick: 'П2' });
  assert.deepEqual(parseCanonicalMarket('2'), { type: '1x2', pick: 'П2' });
  assert.deepEqual(parseCanonicalMarket('Х'), { type: '1x2', pick: 'Х' });
  assert.deepEqual(parseCanonicalMarket('X'), { type: '1x2', pick: 'Х' }, 'Latin X must map to Х draw');
  assert.deepEqual(parseCanonicalMarket('ничья'), { type: '1x2', pick: 'Х' });
});

test('parseCanonicalMarket: double chance — 1X/X2/12 with Latin and Cyrillic X', () => {
  assert.deepEqual(parseCanonicalMarket('1X'), { type: 'double-chance', pick: '1Х' }, 'Latin 1X');
  assert.deepEqual(parseCanonicalMarket('1Х'), { type: 'double-chance', pick: '1Х' }, 'Cyrillic 1Х');
  assert.deepEqual(parseCanonicalMarket('X2'), { type: 'double-chance', pick: 'Х2' }, 'Latin X2');
  assert.deepEqual(parseCanonicalMarket('Х2'), { type: 'double-chance', pick: 'Х2' }, 'Cyrillic Х2');
  assert.deepEqual(parseCanonicalMarket('12'), { type: 'double-chance', pick: '12' });
});

test('parseCanonicalMarket: totals — ТБ/ТМ with parentheses and without', () => {
  assert.deepEqual(parseCanonicalMarket('ТБ(2.5)'), { type: 'total-over', value: 2.5 });
  assert.deepEqual(parseCanonicalMarket('ТБ 2.5'), { type: 'total-over', value: 2.5 });
  assert.deepEqual(parseCanonicalMarket('ТМ(2.5)'), { type: 'total-under', value: 2.5 });
  assert.deepEqual(parseCanonicalMarket('ТМ 3'), { type: 'total-under', value: 3 });
  assert.deepEqual(parseCanonicalMarket('ТБ(3,5)'), { type: 'total-over', value: 3.5 }, 'comma decimal');
});

test('parseCanonicalMarket: totals — text form "тотал больше/меньше N"', () => {
  assert.deepEqual(parseCanonicalMarket('тотал больше 2.5'), { type: 'total-over', value: 2.5 });
  assert.deepEqual(parseCanonicalMarket('Тотал Меньше 3'), { type: 'total-under', value: 3 });
});

test('parseCanonicalMarket: BTTS — обе забьют / ОЗ да/нет / обе не забьют', () => {
  assert.deepEqual(parseCanonicalMarket('ОЗ'), { type: 'btts', pick: 'да' });
  assert.deepEqual(parseCanonicalMarket('Обе забьют'), { type: 'btts', pick: 'да' });
  assert.deepEqual(parseCanonicalMarket('ОЗ да'), { type: 'btts', pick: 'да' });
  assert.deepEqual(parseCanonicalMarket('ОЗ (ДА)'), { type: 'btts', pick: 'да' });
  assert.deepEqual(parseCanonicalMarket('обе не забьют'), { type: 'btts', pick: 'нет' });
  assert.deepEqual(parseCanonicalMarket('ОЗ нет'), { type: 'btts', pick: 'нет' });
  assert.deepEqual(parseCanonicalMarket('ОЗ (НЕТ)'), { type: 'btts', pick: 'нет' });
  assert.equal(parseCanonicalMarket('фора(-1)'), null, 'unsupported market returns null');
  assert.equal(parseCanonicalMarket(''), null, 'empty input returns null');
});

test('parseCanonicalMarket: handicap — Ф1/Ф2 short forms and text фора N forms', () => {
  assert.deepEqual(parseCanonicalMarket('Ф1(-1.5)'), { type: 'handicap', team: 1, value: -1.5 });
  assert.deepEqual(parseCanonicalMarket('Ф2(+1.5)'), { type: 'handicap', team: 2, value: 1.5 });
  assert.deepEqual(parseCanonicalMarket('фора 1 (-1)'), { type: 'handicap', team: 1, value: -1 });
  assert.deepEqual(parseCanonicalMarket('Фора 2 (0)'), { type: 'handicap', team: 2, value: 0 });
  assert.equal(parseCanonicalMarket('фора(-1)'), null, 'фора without team number must remain null');
});

test('parseCanonicalMarket: individual totals — ИТБ/ИТМ short forms and text forms', () => {
  assert.deepEqual(parseCanonicalMarket('ИТБ1(0.5)'), { type: 'indiv-total-over', team: 1, value: 0.5 });
  assert.deepEqual(parseCanonicalMarket('ИТМ2(1.5)'), { type: 'indiv-total-under', team: 2, value: 1.5 });
  assert.deepEqual(parseCanonicalMarket('индивидуальный тотал 2 больше 0.5'), { type: 'indiv-total-over', team: 2, value: 0.5 });
  assert.deepEqual(parseCanonicalMarket('индивидуальный тотал 1 меньше 1,5'), { type: 'indiv-total-under', team: 1, value: 1.5 }, 'comma decimal');
});

test('analyzeForecastFromHtml (canonical): Latin X percent label normalizes to Cyrillic Х via parseCanonicalMarket', () => {
  const html = `
    <h3>Основной прогноз</h3>
    <p>Ничья вероятна. X: 62% П1: 25% П2: 13%</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'Х', 'Latin X must be normalized to Cyrillic Х via canonical market path');
  assert.equal(result.source, 'percent-signals');
});

test('analyzeForecastFromHtml (canonical): "Ничья" percent label normalizes to Х via parseCanonicalMarket', () => {
  const html = `
    <h3>Основной прогноз</h3>
    <p>Ничья: 60% П1: 22% П2: 18%</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'Х', '"Ничья" label must map to canonical Х');
  assert.equal(result.source, 'percent-signals');
});

test('analyzeForecastFromHtml (canonical): Latin X and Cyrillic Х odds in zone merge to same outcome key', () => {
  const html = `
    <h3>Основной прогноз</h3>
    <p>Шансы: П2 2.10 X 3.50 Х 3.80</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'П2', 'П2 must win; Latin X and Cyrillic Х must merge to Х via canonical path');
  assert.equal(result.source, 'odds-implied');
});

test('analyzeForecastFromHtml (canonical): canonical П1/П2/Х labels produce correct bestOutcome', () => {
  const html = `
    <h3>Основной прогноз</h3>
    <p>Прогноз: П1 — 68%, Х — 18%, П2 — 14%.</p>
  `;
  const result = analyzeForecastFromHtml(html);
  assert.equal(result.bestOutcome, 'П1', 'П1 must be top canonical outcome');
  assert.equal(result.source, 'percent-signals');
});

test('parseCanonicalMarket: verbose aliases — победа хозяев/гостей map to П1/П2', () => {
  assert.deepEqual(parseCanonicalMarket('победа хозяев'), { type: '1x2', pick: 'П1' });
  assert.deepEqual(parseCanonicalMarket('Победа Хозяев'), { type: '1x2', pick: 'П1' });
  assert.deepEqual(parseCanonicalMarket('ПОБЕДА ХОЗЯЕВ'), { type: '1x2', pick: 'П1' });
  assert.deepEqual(parseCanonicalMarket('победа гостей'), { type: '1x2', pick: 'П2' });
  assert.deepEqual(parseCanonicalMarket('ПОБЕДА ГОСТЕЙ'), { type: '1x2', pick: 'П2' });
});

test('parseCanonicalMarket: unambiguous "не проиграют" aliases map to double chance', () => {
  assert.deepEqual(parseCanonicalMarket('хозяева не проиграют'), { type: 'double-chance', pick: '1Х' });
  assert.deepEqual(parseCanonicalMarket('ХОЗЯЕВА НЕ ПРОИГРАЮТ'), { type: 'double-chance', pick: '1Х' });
  assert.deepEqual(parseCanonicalMarket('гости не проиграют'), { type: 'double-chance', pick: 'Х2' });
  assert.deepEqual(parseCanonicalMarket('Гости не проиграют'), { type: 'double-chance', pick: 'Х2' });
});

test('normalizeMarketText: trims, uppercases, collapses whitespace and maps Ё to Е', () => {
  assert.equal(normalizeMarketText('  победа хозяев  '), 'ПОБЕДА ХОЗЯЕВ');
  assert.equal(normalizeMarketText('тотал  больше   2.5'), 'ТОТАЛ БОЛЬШЕ 2.5');
  assert.equal(normalizeMarketText('Фёдор'), 'ФЕДОР');
  assert.equal(normalizeMarketText(''), '');
  assert.equal(normalizeMarketText(null), '');
});

test('buildMarketKey: returns readable key string for known market types', () => {
  assert.equal(buildMarketKey({ type: '1x2', pick: 'П1' }), '1x2:П1');
  assert.equal(buildMarketKey({ type: 'double-chance', pick: '1Х' }), 'double-chance:1Х');
  assert.equal(buildMarketKey({ type: 'total-over', value: 2.5 }), 'total-over:2.5');
  assert.equal(buildMarketKey({ type: 'total-under', value: 3 }), 'total-under:3');
  assert.equal(buildMarketKey({ type: 'handicap', team: 1, value: -1.5 }), 'handicap:1:-1.5');
  assert.equal(buildMarketKey({ type: 'btts', pick: 'да' }), 'btts:да');
  assert.equal(buildMarketKey(null), null);
  assert.equal(buildMarketKey({}), null);
});

test('formatCanonicalForecast: returns human-readable canonical forecast strings', () => {
  assert.equal(formatCanonicalForecast({ type: 'btts', pick: 'да' }), 'Обе забьют — да');
  assert.equal(formatCanonicalForecast({ type: 'total-over', value: 2.5 }), 'Тотал больше 2.5');
  assert.equal(formatCanonicalForecast({ type: 'double-chance', pick: 'Х2' }), 'Х2');
  assert.equal(formatCanonicalForecast({ type: 'indiv-total-under', team: 2, value: 1.5 }), 'Индивидуальный тотал 2 меньше 1.5');
  assert.equal(formatCanonicalForecast(null), null);
});

test('parseCanonicalMarket: malformed line-table fragments do not canonicalize', () => {
  assert.equal(parseCanonicalMarket('60 ФОРА 2 ('), null, 'leading number + keyword + unclosed paren');
  assert.equal(parseCanonicalMarket('44 ФОРА 1 ('), null, 'leading number + keyword + unclosed paren');
  assert.equal(parseCanonicalMarket('ТБ(2.5'), null, 'unclosed parenthesis in total');
  assert.equal(parseCanonicalMarket('фора 1 (+1.5'), null, 'unclosed parenthesis in handicap');
  assert.equal(parseCanonicalMarket('12 ТБ(2.5)'), null, 'number-prefixed market keyword');
});

test('buildBetCandidate: happy path with recognized canonical market', () => {
  const market = { type: '1x2', pick: 'П1' };
  const result = buildBetCandidate('П1', market, 1.85, 'mainForecastZone', 1, 'Победа хозяев', 'Команда в форме');
  assert.equal(result.rawForecast, 'П1');
  assert.equal(result.canonicalForecast, 'П1');
  assert.equal(result.marketKey, '1x2:П1');
  assert.equal(result.marketType, '1x2');
  assert.equal(result.coeff, 1.85);
  assert.equal(result.sourceZone, 'mainForecastZone');
  assert.equal(result.sourcePriority, 1);
  assert.equal(result.description, 'Победа хозяев');
  assert.equal(result.evidenceSnippet, 'Команда в форме');
});

test('buildBetCandidate: null market produces null canonicalForecast, marketKey, marketType', () => {
  const result = buildBetCandidate('что-то', null, 2.0, 'editorChoiceZone', 2, 'Описание', 'Фрагмент');
  assert.equal(result.rawForecast, 'что-то');
  assert.equal(result.canonicalForecast, null);
  assert.equal(result.marketKey, null);
  assert.equal(result.marketType, null);
  assert.equal(result.coeff, 2.0);
});

test('buildBetCandidate: invalid coeff normalizes to null', () => {
  assert.equal(buildBetCandidate('П2', { type: '1x2', pick: 'П2' }, 'abc', 'z', 0, '', '').coeff, null);
  assert.equal(buildBetCandidate('П2', { type: '1x2', pick: 'П2' }, null, 'z', 0, '', '').coeff, null);
  assert.equal(buildBetCandidate('П2', { type: '1x2', pick: 'П2' }, undefined, 'z', 0, '', '').coeff, null);
  assert.equal(buildBetCandidate('П2', { type: '1x2', pick: 'П2' }, NaN, 'z', 0, '', '').coeff, null);
});

test('resolveLocalCoeffNearForecast: finds coeff in same sentence as forecast', () => {
  const zoneText = 'Команда нестабильна. Ставим на П1 с кэфом 1.85. Подтверждено анализом.';
  assert.equal(resolveLocalCoeffNearForecast('П1', zoneText), 1.85);
});

test('resolveLocalCoeffNearForecast: finds coeff in adjacent sentence when same sentence has none', () => {
  const zoneText = 'Рекомендуем победу хозяев. Коэффициент 1.72 выглядит привлекательно.';
  assert.equal(resolveLocalCoeffNearForecast('победа хозяев', zoneText), 1.72);
});

test('resolveLocalCoeffNearForecast: returns null when multiple different coefficients are nearby', () => {
  const zoneText = 'Матч сложный: П1 с кэфом 1.85 или П2 с кэфом 2.10 — оба варианта обсуждаются.';
  assert.equal(resolveLocalCoeffNearForecast('П1', zoneText), null);
});

test('resolveLocalCoeffNearForecast: distant number does not bind to forecast as coeff', () => {
  const zoneText = [
    'Ставим на П1.',
    'Хозяева выглядят уверенно.',
    'Статистика позитивная.',
    'Гости нестабильны.',
    'Подробности ниже.',
    'Шансы оцениваются низко.',
    'В прошлом сезоне соотношение составляло 3.80.',
  ].join(' ');
  assert.equal(resolveLocalCoeffNearForecast('П1', zoneText), null);
});

test('extractBetCandidatesFromZone: extracts П1 candidate with coeff from zone', () => {
  const zone = 'Ставим на П1 с коэффициентом 1.85. Команда в хорошей форме.';
  const candidates = extractBetCandidatesFromZone(zone, 'mainForecastZone', 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].marketKey, '1x2:П1');
  assert.equal(candidates[0].coeff, 1.85);
  assert.equal(candidates[0].sourceZone, 'mainForecastZone');
  assert.equal(candidates[0].sourcePriority, 1);
});

test('extractBetCandidatesFromZone: "победа хозяев" alias canonicalizes to П1 candidate', () => {
  const zone = 'Победа хозяев выглядит вероятной. Гости нестабильны.';
  const candidates = extractBetCandidatesFromZone(zone, 'editorChoiceZone', 2);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].marketKey, '1x2:П1');
  assert.equal(candidates[0].marketType, '1x2');
  assert.equal(candidates[0].canonicalForecast, 'П1');
});

test('extractBetCandidatesFromZone: noisy/non-canonical zone produces no candidates', () => {
  const zone = 'Завтра состоится интересная игра. Команды готовятся к матчу. Стадион полностью заполнен.';
  const candidates = extractBetCandidatesFromZone(zone, 'articleZone', 3);
  assert.equal(candidates.length, 0);
});

test('extractBetCandidatesFromZone: two valid forecasts in one zone produce two candidates', () => {
  const zone = 'Прогноз: ставим на П1. Тотал больше 2.5 также выглядит привлекательно.';
  const candidates = extractBetCandidatesFromZone(zone, 'mainForecastZone', 1);
  assert.equal(candidates.length, 2);
  const keys = candidates.map((c) => c.marketKey).sort();
  assert.deepEqual(keys, ['1x2:П1', 'total-over:2.5']);
});

test('collectCandidatesAcrossZones: collects candidates from multiple zones', () => {
  const candidates = collectCandidatesAcrossZones({
    mainForecastZone: 'Ставим на П1 с коэффициентом 1.85.',
    editorChoiceZone: 'Тотал больше 2.5 выглядит привлекательно.',
    articleZone: '',
  });
  const keys = candidates.map((c) => c.marketKey).sort();
  assert.deepEqual(keys, ['1x2:П1', 'total-over:2.5']);
});

test('collectCandidatesAcrossZones: duplicate marketKey deduped in favor of editorChoiceZone over articleZone', () => {
  const candidates = collectCandidatesAcrossZones({
    mainForecastZone: '',
    editorChoiceZone: 'Выбор: П1 с кэфом 1.90.',
    articleZone: 'Прогноз: П1 с кэфом 2.10.',
  });
  const p1 = candidates.filter((c) => c.marketKey === '1x2:П1');
  assert.equal(p1.length, 1);
  assert.equal(p1[0].sourceZone, 'editorChoiceZone');
});

test('collectCandidatesAcrossZones: same sourcePriority — candidate with coeff wins over coeff=null', () => {
  // mainForecastZone and editorChoiceZone share priority 1; П1 appears in both:
  // main produces П1 without coeff, editor produces П1 with coeff → editor's candidate wins
  const candidates = collectCandidatesAcrossZones({
    mainForecastZone: 'Победа хозяев — наш выбор.',
    editorChoiceZone: 'П1 с кэфом 1.85.',
    articleZone: '',
  });
  const p1 = candidates.filter((c) => c.marketKey === '1x2:П1');
  assert.equal(p1.length, 1);
  assert.equal(p1[0].coeff, 1.85, 'candidate with coeff must win over candidate with coeff=null at same priority');
  assert.equal(p1[0].sourceZone, 'editorChoiceZone');
});

test('collectCandidatesAcrossZones: different marketKeys are all preserved simultaneously', () => {
  const candidates = collectCandidatesAcrossZones({
    mainForecastZone: 'Ставим на П1 с коэффициентом 1.80.',
    editorChoiceZone: 'Тотал больше 2.5 с кэфом 1.90.',
    articleZone: 'Обе забьют — интересный вариант.',
  });
  const keys = candidates.map((c) => c.marketKey).sort();
  assert.deepEqual(keys, ['1x2:П1', 'btts:да', 'total-over:2.5']);
});

test('isCandidateAcceptable: valid candidate returns true', () => {
  const candidate = {
    marketKey: '1x2:П1',
    marketType: '1x2',
    coeff: 1.85,
    sourceZone: 'mainForecastZone',
    description: 'Хозяева выглядят сильнее',
  };
  assert.equal(isCandidateAcceptable(candidate), true);
});

test('isCandidateAcceptable: missing coeff returns false', () => {
  const candidate = {
    marketKey: '1x2:П1',
    marketType: '1x2',
    coeff: null,
    sourceZone: 'mainForecastZone',
  };
  assert.equal(isCandidateAcceptable(candidate), false);
});

test('isCandidateAcceptable: missing marketKey or marketType returns false', () => {
  assert.equal(isCandidateAcceptable({ marketType: '1x2', coeff: 1.8 }), false);
  assert.equal(isCandidateAcceptable({ marketKey: '1x2:П1', coeff: 1.8 }), false);
});

test('scoreBetCandidate: mainForecastZone scores higher than articleZone when other fields match', () => {
  const base = {
    marketKey: '1x2:П1',
    marketType: '1x2',
    coeff: 1.85,
    description: 'Хозяева выглядят сильнее',
  };
  const mainScore = scoreBetCandidate({ ...base, sourceZone: 'mainForecastZone' });
  const articleScore = scoreBetCandidate({ ...base, sourceZone: 'articleZone' });
  assert.ok(mainScore > 0, 'valid candidate should get positive score');
  assert.ok(mainScore > articleScore, 'mainForecastZone must score above articleZone');
});

test('scoreBetCandidate: clean description scores higher than junk description', () => {
  const base = {
    marketKey: '1x2:П1',
    marketType: '1x2',
    coeff: 1.85,
    sourceZone: 'mainForecastZone',
  };
  const cleanScore = scoreBetCandidate({ ...base, description: 'Хозяева выглядят сильнее' });
  const junkScore = scoreBetCandidate({ ...base, description: 'Показать еще' });
  assert.ok(cleanScore > junkScore, 'clean description must score higher than junk description');
});

test('scoreBetCandidate: service time fragment in description lowers score', () => {
  const base = {
    marketKey: '1x2:П1',
    marketType: '1x2',
    coeff: 1.85,
    sourceZone: 'mainForecastZone',
  };
  const cleanScore = scoreBetCandidate({ ...base, description: 'Победа хозяев выглядит вероятной' });
  const junkScore = scoreBetCandidate({ ...base, description: 'Сегодня в 18:30 по МСК начнётся матч' });
  assert.ok(cleanScore > junkScore, 'service time fragment must lower description score');
});

test('scoreBetCandidate: footer/contact fragment in description lowers score', () => {
  const base = {
    marketKey: '1x2:П2',
    marketType: '1x2',
    coeff: 2.10,
    sourceZone: 'articleZone',
  };
  const cleanScore = scoreBetCandidate({ ...base, description: 'Гости демонстрируют хорошую игру' });
  const phoneScore = scoreBetCandidate({ ...base, description: 'Телефон редакции: +7 (495) 123-45-67' });
  const emailScore = scoreBetCandidate({ ...base, description: 'Почта редакции: info@example.ru' });
  assert.ok(cleanScore > phoneScore, 'phone footer fragment must lower description score');
  assert.ok(cleanScore > emailScore, 'email footer fragment must lower description score');
});

test('sanitizeCandidateDescription: removes junk service fragment but keeps meaningful forecast text', () => {
  const result = sanitizeCandidateDescription('Победа хозяев — основной вывод. Показать еще');
  assert.ok(!result.includes('Показать еще'), 'service fragment must be removed');
  assert.ok(result.includes('Победа хозяев'), 'meaningful forecast wording must be preserved');
});

test('sanitizeCandidateDescription: collapses whitespace and trims result', () => {
  const result = sanitizeCandidateDescription('  Прогноз   аналитиков  ');
  assert.equal(result, 'Прогноз аналитиков');
});

test('scoreBetCandidate: junk-only description sanitizes to empty and does not score above no-description baseline', () => {
  const base = { marketKey: '1x2:П1', marketType: '1x2', coeff: 1.85, sourceZone: 'mainForecastZone' };
  const noDescScore = scoreBetCandidate({ ...base, description: null });
  const junkScore = scoreBetCandidate({ ...base, description: 'Показать еще' });
  assert.ok(junkScore < noDescScore, 'junk-only description must score below no-description baseline after sanitization');
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
