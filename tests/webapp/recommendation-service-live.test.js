const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendations } = require('../../webapp/services/recommendationService');

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
