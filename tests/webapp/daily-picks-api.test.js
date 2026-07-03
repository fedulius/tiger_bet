const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

test('GET /home/daily-picks returns today/tomorrow picks from DB-backed feed', async () => {
  const fakePg = createFakePg({
    rows: [
      {
        slot_date: '2026-07-03',
        match_analysis_id: 11,
        match_id: 101,
        system_match_id: 'sys-101',
        home_team: 'Alpha FC',
        away_team: 'Beta FC',
        sport_name: 'Футбол',
        tournament_name: 'Лига 1',
        tournament_name_en: 'Ligue 1',
        match_start_at: '2026-07-03T15:00:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Сегодняшний пик',
        analysis_brief: 'Короткий бриф',
        analysis_risk_note: 'Риск умеренный',
        recommended_bets: [{ market: '1X2', selection: 'home', odds: 1.91 }],
        source_payload: { match_slug: 'alpha-beta', source_url: 'https://example.test/m/101', source_refs: ['card'] },
        model_name: 'gpt',
        prompt_version: 'v1',
        analysis_create_at: '2026-07-03T10:00:00.000Z',
        analysis_update_at: '2026-07-03T10:05:00.000Z',
      },
      {
        slot_date: '2026-07-04',
        match_analysis_id: 21,
        match_id: 201,
        system_match_id: 'sys-201',
        home_team: 'Gamma FC',
        away_team: 'Delta FC',
        sport_name: 'Футбол',
        tournament_name: 'АПЛ',
        tournament_name_en: 'Premier League',
        match_start_at: '2026-07-04T18:30:00.000Z',
        analysis_status_name: 'ready',
        analysis_headline: 'Завтрашний пик',
        analysis_brief: 'Ещё один бриф',
        analysis_risk_note: '',
        recommended_bets: [],
        source_payload: { match_slug: 'gamma-delta' },
        model_name: 'gpt',
        prompt_version: 'v2',
        analysis_create_at: '2026-07-03T11:00:00.000Z',
        analysis_update_at: '2026-07-03T11:10:00.000Z',
      },
    ],
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
    const payload = response.json();
    assert.equal(payload.today?.headline, 'Сегодняшний пик');
    assert.equal(payload.tomorrow?.headline, 'Завтрашний пик');
    assert.equal(payload.today?.match, 'Alpha FC — Beta FC');
    assert.equal(payload.tomorrow?.match_slug, 'gamma-delta');
    assert.equal(payload.updated_at, '2026-07-03T11:10:00.000Z');
    assert.match(fakePg.calls[0].query, /match_analysis/);
  } finally {
    await app.close();
  }
});

test('GET /home/daily-picks returns null slots when DB has no ready picks', async () => {
  const app = buildTestApp(buildApp, { pg: createFakePg({ rows: [] }) });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/home/daily-picks',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.today, null);
    assert.equal(payload.tomorrow, null);
    assert.equal(payload.updated_at, null);
    assert.ok(payload.today_date);
    assert.ok(payload.tomorrow_date);
  } finally {
    await app.close();
  }
});
