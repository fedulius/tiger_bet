const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

function makeFakeRedis() {
  const deletedKeys = [];
  return {
    deletedKeys,
    async del(...keys) {
      deletedKeys.push(...keys.flat());
    },
  };
}

test('GET /favorites returns DB-backed favorites', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport us/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer', tournament_id: null, tournament_name: null, tournament_name_en: null },
          { sport_id: 3, sport_name: 'Теннис', sport_url: 'tennis', tournament_id: null, tournament_name: null, tournament_name_en: null },
        ];
      }
      if (/FROM public\.sport/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' },
          { sport_id: 2, sport_name: 'Хоккей', sport_url: 'ice-hockey' },
          { sport_id: 3, sport_name: 'Теннис', sport_url: 'tennis' },
        ];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 77, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'GET',
      url: '/favorites',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fakePg.calls.length, 2);
    assert.deepEqual(response.json(), {
      sports: [
        {
          name: 'Футбол',
          sport_url: 'soccer',
          leagues: [],
          all_leagues: true,
          available_leagues: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League', 'World Cup', 'FIFA Club World Cup'],
          leagues_summary: 'Все лиги',
        },
        {
          name: 'Теннис',
          sport_url: 'tennis',
          leagues: [],
          all_leagues: true,
          available_leagues: ['ATP', 'WTA', 'Challenger'],
          leagues_summary: 'Все лиги',
        },
      ],
      profile: 'telegram:777',
      available_sports: [
        { sport_name: 'Футбол', sport_url: 'soccer' },
        { sport_name: 'Хоккей', sport_url: 'ice-hockey' },
        { sport_name: 'Теннис', sport_url: 'tennis' },
      ],
      leagues_catalog: {
        'Футбол': ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League', 'World Cup', 'FIFA Club World Cup'],
        'Хоккей': ['KHL', 'NHL', 'World Championship'],
        'Теннис': ['ATP', 'WTA', 'Challenger'],
      },
    });
  } finally {
    await app.close();
  }
});

test('PUT /favorites replaces user favorite sports in DB and persists selected leagues in user_tournament', async () => {
  const fakeRedis = makeFakeRedis();
  let phase = 'before';
  const fakePg = createFakePg({
    handler(query, params) {
      if (/FROM public\.user_sport us/i.test(query)) {
        assert.deepEqual(params, [55]);
        return phase === 'before'
          ? [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer', tournament_id: null, tournament_name: null, tournament_name_en: null }]
          : [
              { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer', tournament_id: 10, tournament_name: 'АПЛ', tournament_name_en: 'Premier League' },
              { sport_id: 3, sport_name: 'Теннис', sport_url: 'tennis', tournament_id: null, tournament_name: null, tournament_name_en: null },
            ];
      }
      if (/SELECT\s+sport_id,\s+sport_name,\s+sport_url\s+FROM public\.sport/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' },
          { sport_id: 3, sport_name: 'Теннис', sport_url: 'tennis' },
        ];
      }
      if (/SELECT\s+tournament_id,\s+sport_id,\s+tournament_name,\s+tournament_name_en\s+FROM public\.tournament/i.test(query)) {
        return [
          { tournament_id: 10, sport_id: 1, tournament_name: 'АПЛ', tournament_name_en: 'Premier League' },
          { tournament_id: 11, sport_id: 1, tournament_name: 'Ла Лига', tournament_name_en: 'La Liga' },
          { tournament_id: 30, sport_id: 3, tournament_name: 'ATP', tournament_name_en: 'ATP' },
        ];
      }
      if (/DELETE FROM public\.user_tournament/i.test(query)) {
        assert.deepEqual(params, [55]);
        return [];
      }
      if (/DELETE FROM public\.user_sport/i.test(query)) {
        assert.deepEqual(params, [55]);
        return [];
      }
      if (/INSERT INTO public\.user_sport/i.test(query)) {
        return [];
      }
      if (/INSERT INTO public\.user_tournament/i.test(query)) {
        phase = 'after';
        return [];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg, recommendationsRedis: fakeRedis });
  await app.ready();

  try {
    const putResponse = await app.inject({
      headers: makeAuthHeaders(app, { userId: 55, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: [
          { name: 'Футбол', leagues: ['Premier League', 'Unknown League'] },
          { name: 'Теннис', leagues: [] },
        ],
      },
    });

    assert.equal(putResponse.statusCode, 200);
    assert.deepEqual(putResponse.json(), {
      sports: [
        {
          name: 'Футбол',
          sport_url: 'soccer',
          leagues: ['Premier League'],
          all_leagues: false,
          available_leagues: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League', 'World Cup', 'FIFA Club World Cup'],
          leagues_summary: 'Premier League',
        },
        {
          name: 'Теннис',
          sport_url: 'tennis',
          leagues: [],
          all_leagues: true,
          available_leagues: ['ATP', 'WTA', 'Challenger'],
          leagues_summary: 'Все лиги',
        },
      ],
      profile: 'telegram:777',
    });

    assert.ok(fakePg.calls.some((call) => /DELETE FROM public\.user_tournament/i.test(call.query)));
    assert.ok(fakePg.calls.some((call) => /DELETE FROM public\.user_sport/i.test(call.query)));
    assert.ok(fakePg.calls.some((call) => /INSERT INTO public\.user_sport/i.test(call.query) && JSON.stringify(call.params) === JSON.stringify([55, 1])));
    assert.ok(fakePg.calls.some((call) => /INSERT INTO public\.user_sport/i.test(call.query) && JSON.stringify(call.params) === JSON.stringify([55, 3])));
    assert.ok(fakePg.calls.some((call) => /INSERT INTO public\.user_tournament/i.test(call.query) && JSON.stringify(call.params) === JSON.stringify([55, 10])));
    assert.deepEqual(fakeRedis.deletedKeys.sort(), [
      'recommendations:1:',
      'recommendations:1::current_version',
      'recommendations:1:Premier League|3:',
      'recommendations:1:Premier League|3::current_version',
    ]);
  } finally {
    await app.close();
  }
});

test('PUT /favorites validates sports array payload', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app, { userId: 1, telegram_user_id: 777, profile: 'telegram:777' }),
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: 'football',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /sports must be an array/i);
  } finally {
    await app.close();
  }
});

test('GET /favorites returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/favorites',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('PUT /favorites returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/favorites',
      payload: {
        sports: [{ name: 'football', leagues: [] }],
      },
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
