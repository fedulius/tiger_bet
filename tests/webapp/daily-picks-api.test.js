const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

function withTempFavoritesFile(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiger-bet-daily-picks-'));
  const filePath = path.join(dir, 'favorites.json');
  process.env.WEBAPP_FAVORITES_FILE = filePath;
  fs.writeFileSync(filePath, JSON.stringify(payload || {}, null, 2));
  return () => {
    delete process.env.WEBAPP_FAVORITES_FILE;
    fs.rmSync(dir, { force: true, recursive: true });
  };
}

test('GET /home/daily-picks returns today/tomorrow picks from DB-backed feed', async () => {
  const cleanup = withTempFavoritesFile({
    'telegram:777': {
      sport_settings: [
        { name: 'Футбол', leagues: [] },
      ],
    },
  });

  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport fs\s+JOIN public\.sport s/i.test(query)) {
        return [];
      }
      if (/SELECT sport_id, sport_name, sport_url\s+FROM public\.sport/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      return [
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
      ];
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
    const payload = response.json();
    assert.equal(payload.today?.headline, 'Сегодняшний пик');
    assert.equal(payload.tomorrow?.headline, 'Завтрашний пик');
    assert.equal(payload.today?.match, 'Alpha FC — Beta FC');
    assert.equal(payload.tomorrow?.match_slug, 'gamma-delta');
    assert.equal(payload.updated_at, '2026-07-03T11:10:00.000Z');
    assert.match(fakePg.calls[0].query, /user_sport/);
    assert.match(fakePg.calls[1].query, /FROM public\.sport/);
    assert.match(fakePg.calls[2].query, /match_analysis/);
  } finally {
    await app.close();
    cleanup();
  }
});

test('GET /home/daily-picks filters out picks outside favorite leagues', async () => {
  const cleanup = withTempFavoritesFile({
    'telegram:777': {
      sport_settings: [
        { name: 'Футбол', leagues: ['Premier League'] },
      ],
    },
  });

  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_sport fs\s+JOIN public\.sport s/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      return [
        {
          slot_date: '2026-07-03',
          match_analysis_id: 11,
          match_id: 101,
          system_match_id: 'sys-101',
          home_team: 'Alpha FC',
          away_team: 'Beta FC',
          sport_name: 'Футбол',
          tournament_name: 'Йккослиига',
          tournament_name_en: 'Ykkosliiga',
          match_start_at: '2026-07-03T15:00:00.000Z',
          analysis_status_name: 'ready',
          analysis_headline: 'Финский пик',
          analysis_brief: 'Не должен пройти',
          analysis_risk_note: '',
          recommended_bets: [],
          source_payload: { match_slug: 'alpha-beta' },
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
          analysis_headline: 'Английский пик',
          analysis_brief: 'Должен пройти',
          analysis_risk_note: '',
          recommended_bets: [],
          source_payload: { match_slug: 'gamma-delta' },
          model_name: 'gpt',
          prompt_version: 'v2',
          analysis_create_at: '2026-07-03T11:00:00.000Z',
          analysis_update_at: '2026-07-03T11:10:00.000Z',
        },
      ];
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
    const payload = response.json();
    assert.equal(payload.today, null);
    assert.equal(payload.tomorrow?.headline, 'Английский пик');
  } finally {
    await app.close();
    cleanup();
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
