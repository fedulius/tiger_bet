const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');
const { buildTestApp, createFakePg, makeAuthHeaders } = require('./testHelpers');

test('GET /history returns favorite-based items when user has favorite sports', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM bet\.v_prediction_card_history/i.test(query)) {
        return [];
      }
      if (/FROM public\.user_tournament ut/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
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
      url: '/history',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.empty_state, null);
    assert.ok(payload.items.every((item) => /Premier League|La Liga/.test(item.league)));
  } finally {
    await app.close();
  }
});

test('GET /history returns published Tiger Bet prediction history from bet views', async () => {
  const fakePg = createFakePg({
    handler(query, params) {
      if (/FROM public\.user_tournament ut/i.test(query)) {
        return [];
      }
      if (/FROM bet\.v_prediction_card_history/i.test(query)) {
        assert.deepEqual(params, ['public', 20, 0]);
        return [{
          prediction_card_id: '101',
          card_type_code: 'daily',
          card_status_code: 'published',
          published_at: '2026-07-15T10:00:00.000Z',
          published_date: '2026-07-15',
          match_id: 55,
          match_title: 'France — Spain',
          league: 'Чемпионат мира',
          sport_name: 'Футбол',
          headline: 'Испания сильнее по форме',
          brief: 'Проверяем историю опубликованных ставок.',
          risk_note: 'Средний риск',
          bets_count: '3',
          won_count: '2',
          lost_count: '1',
          void_count: '0',
          pending_count: '0',
          not_supported_count: '0',
          profit_units: '0.740000',
          hit_rate_percent: '66.67',
        }];
      }
      if (/FROM bet\.v_prediction_bet_settlements/i.test(query)) {
        assert.deepEqual(params, [[101]]);
        return [
          {
            prediction_card_id: '101',
            prediction_bet_id: '201',
            ordinal: 1,
            kind: 'single',
            market_type_code: 'double_chance',
            market_type_name: 'Double chance',
            period_code: 'full_time',
            display_label: 'X2',
            selection_code: 'away_or_draw',
            odds_decimal: '1.62',
            risk_level_code: 'low',
            confidence: '71.5',
            reason: 'Испания не проиграет.',
            settlement_status_code: 'settled',
            settlement_result_code: 'win',
            ui_result_code: 'won',
            ui_result_label: 'Зашло',
            profit_factor: '0.620000',
            reason_text: 'Испания выиграла, X2 зашёл.',
          },
          {
            prediction_card_id: '101',
            prediction_bet_id: '202',
            ordinal: 2,
            kind: 'single',
            market_type_code: 'total',
            market_type_name: 'Total',
            period_code: 'full_time',
            display_label: 'ТБ 2.5',
            selection_code: 'over',
            line_value: '2.5',
            odds_decimal: '1.95',
            settlement_status_code: 'settled',
            settlement_result_code: 'loss',
            ui_result_code: 'lost',
            ui_result_label: 'Не зашло',
            profit_factor: '-1.000000',
          },
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
      url: '/history',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.items.length, 1);
    assert.equal(payload.empty_state, null);
    assert.equal(payload.summary.total_cards, 1);
    assert.equal(payload.summary.total_bets, 3);
    assert.equal(payload.summary.won_count, 2);
    assert.equal(payload.summary.lost_count, 1);
    assert.equal(payload.summary.profit_units, 0.74);

    const item = payload.items[0];
    assert.equal(item.id, 'prediction-card:101');
    assert.equal(item.match, 'France — Spain');
    assert.equal(item.league, 'Чемпионат мира');
    assert.equal(item.main_thought, 'Испания сильнее по форме');
    assert.equal(item.result_code, 'mixed');
    assert.equal(item.result_label, '2 из 3');
    assert.equal(item.bets.length, 2);
    assert.equal(item.bets[0].result_code, 'won');
    assert.equal(item.bets[1].result_code, 'lost');
  } finally {
    await app.close();
  }
});

test('GET /history returns empty-state payload', async () => {
  const fakePg = createFakePg({ rows: [] });
  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/history',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 0);
    assert.equal(payload.empty_state?.message, 'Здесь появятся ваши последние прогнозы');
    assert.equal(payload.empty_state?.cta?.label, 'Открыть рекомендации');
    assert.equal(payload.empty_state?.cta?.target, '#recommendations');
  } finally {
    await app.close();
  }
});

test('GET /history item shape uses format A fields', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      headers: makeAuthHeaders(app),
      method: 'GET',
      url: '/history?sample=1',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.ok(payload.items.length >= 1);

    const item = payload.items[0];
    assert.ok(item.id);
    assert.ok(item.match);
    assert.ok(item.league);
    assert.ok(item.starts_at);
    assert.ok(item.main_thought);
    assert.equal(typeof item.confidence, 'number');
  } finally {
    await app.close();
  }
});

test('GET /history returns 401 without JWT', async () => {
  const app = buildTestApp(buildApp);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/history',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
