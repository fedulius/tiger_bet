const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

function makeInitData({ userId = 123, botToken = 'test-bot-token', authDate = Math.floor(Date.now() / 1000) } = {}) {
  const user = JSON.stringify({ id: userId, first_name: 'T', username: 'u' });
  const data = {
    auth_date: String(authDate),
    query_id: 'AAEAAAE',
    user,
  };

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams();
  params.set('auth_date', data.auth_date);
  params.set('query_id', data.query_id);
  params.set('user', data.user);
  params.set('hash', hash);
  return params.toString();
}

test('GET /auth writes auth.login_success event', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM external\.public_user/i.test(query)) {
        return [{ user_id: 1 }];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
      }
      return [];
    },
  });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: {
        'x-telegram-init-data': makeInitData({ botToken: process.env.TELEGRAM_BOT_TOKEN, userId: 777 }),
      },
    });

    assert.equal(response.statusCode, 200);
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'auth.login_success');
    assert.equal(logCall.params[1], 777);
    assert.equal(logCall.params[2], 1);
    assert.equal(logCall.params[3], '/auth');
    assert.equal(logCall.params[4], 'GET');
    assert.equal(logCall.params[5], 200);
    assert.equal(logCall.params[6], 'jwt');
  } finally {
    await app.close();
  }
});

test('GET /favorites writes screen.favorites_open event', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport us/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer', tournament_id: null, tournament_name: null, tournament_name_en: null },
        ];
      }
      if (/FROM public\.sport/i.test(query)) {
        return [
          { sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' },
        ];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
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
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'screen.favorites_open');
    assert.equal(logCall.params[1], 777);
    assert.equal(logCall.params[2], 77);
    assert.equal(logCall.params[3], '/favorites');
    assert.equal(logCall.params[6], 'favorites');

    const meta = JSON.parse(logCall.params[9]);
    assert.equal(meta.screen, 'favorites');
    assert.equal(meta.sports_count, 1);
  } finally {
    await app.close();
  }
});

test('GET /history writes screen.history_open event', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport fs/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
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
      url: '/history?sample=1',
    });

    assert.equal(response.statusCode, 200);
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'screen.history_open');
    assert.equal(logCall.params[3], '/history');
    const meta = JSON.parse(logCall.params[9]);
    assert.equal(meta.screen, 'history');
    assert.equal(meta.sample, true);
  } finally {
    await app.close();
  }
});

test('GET /home/daily-picks writes screen.daily_picks_open event', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport us/i.test(query)) {
        return [];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
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
      url: '/home/daily-picks',
    });

    assert.equal(response.statusCode, 200);
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'screen.daily_picks_open');
    assert.equal(logCall.params[3], '/home/daily-picks');
    const meta = JSON.parse(logCall.params[9]);
    assert.equal(meta.screen, 'daily_picks');
    assert.equal(meta.today_exists, false);
  } finally {
    await app.close();
  }
});

test('GET /recommendations writes screen.recommendations_open event', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport us/i.test(query)) {
        return [];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
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
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'screen.recommendations_open');
    assert.equal(logCall.params[3], '/recommendations');
    const meta = JSON.parse(logCall.params[9]);
    assert.equal(meta.screen, 'recommendations');
  } finally {
    await app.close();
  }
});

test('GET /prediction/:slug writes prediction.open event', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.match_analysis ma/i.test(query)) {
        return [{
          match_analysis_id: 11,
          analysis_headline: 'Сегодняшний пик',
          analysis_brief: 'Короткий бриф',
          analysis_risk_note: 'Риск умеренный',
          recommended_bets: [{ type: 'winner', label: 'Победа 1', rate: 1.91 }],
          model_name: 'gpt',
          prompt_version: 'v1',
          analysis_create_at: '2026-07-03T10:00:00.000Z',
          analysis_update_at: '2026-07-03T10:05:00.000Z',
          match_id: 101,
          home_team: 'Alpha FC',
          away_team: 'Beta FC',
          match_start_at: '2026-07-03T15:00:00.000Z',
          sport_name: 'Футбол',
          sport_url: 'soccer',
          tournament_name: 'Чемпионат мира',
          tournament_name_en: 'World Cup',
          system_match_id: 'sys-101',
        }];
      }
      if (/logger\.user_event_log_create/i.test(query)) {
        return [{ ok: true }];
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
      url: '/prediction/alpha-beta',
    });

    assert.equal(response.statusCode, 200);
    const logCall = fakePg.calls.find((call) => /logger\.user_event_log_create/i.test(call.query));
    assert.ok(logCall);
    assert.equal(logCall.params[0], 'prediction.open');
    assert.equal(logCall.params[3], '/prediction/:slug');
    assert.equal(logCall.params[6], 'alpha-beta');
    const meta = JSON.parse(logCall.params[9]);
    assert.equal(meta.match_slug, 'alpha-beta');
    assert.equal(meta.match_id, 101);
  } finally {
    await app.close();
  }
});
