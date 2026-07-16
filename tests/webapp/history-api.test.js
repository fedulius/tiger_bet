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
        if (/COUNT\(\*\)/i.test(query)) {
          assert.deepEqual(params, ['public']);
          return [{ total_cards: '4', total_bets: '4', won_count: '3', lost_count: '1', void_count: '0', pending_count: '0', not_supported_count: '0', profit_units: '1.240000' }];
        }
        if (/primary_match_id = ANY/i.test(query)) {
          assert.deepEqual(params, ['public', [55]]);
          return [
            {
              prediction_card_id: '101',
              card_type_code: 'daily',
              card_status_code: 'published',
              published_at: '2026-07-15T10:00:00.000Z',
              published_date: '2026-07-15',
              primary_match_id: 55,
              home_team: 'France',
              away_team: 'Spain',
              tournament_name: 'Чемпионат мира',
              title: 'France — Spain',
              headline: 'Испания сильнее по форме',
              bets_count: '3',
              won_count: '2',
              lost_count: '1',
              void_count: '0',
              pending_count: '0',
              not_supported_count: '0',
              profit_units: '0.740000',
              hit_rate_percent: '66.67',
            },
            {
              prediction_card_id: '102',
              card_type_code: 'live',
              card_status_code: 'published',
              published_at: '2026-07-15T10:05:00.000Z',
              published_date: '2026-07-15',
              primary_match_id: 55,
              home_team: 'France',
              away_team: 'Spain',
              tournament_name: 'Чемпионат мира',
              title: 'France — Spain',
              headline: 'Live ставка по матчу',
              bets_count: '1',
              won_count: '1',
              lost_count: '0',
              void_count: '0',
              pending_count: '0',
              not_supported_count: '0',
              profit_units: '0.500000',
              hit_rate_percent: '100',
            },
          ];
        }
        assert.deepEqual(params, ['public', 5, 2]);
        return [{
          prediction_card_id: '101',
          card_type_code: 'daily',
          card_status_code: 'published',
          published_at: '2026-07-15T10:00:00.000Z',
          published_date: '2026-07-15',
          primary_match_id: 55,
          home_team: 'France',
          away_team: 'Spain',
          tournament_name: 'Чемпионат мира',
          title: 'France — Spain',
          headline: 'Испания сильнее по форме',
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
        assert.deepEqual(params, [[101, 102]]);
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
          {
            prediction_card_id: '102',
            prediction_bet_id: '203',
            ordinal: 1,
            kind: 'single',
            market_type_code: 'both_to_score',
            market_type_name: 'Обе забьют',
            period_code: 'full_time',
            display_label: 'ОЗ да',
            selection_code: 'yes',
            odds_decimal: '1.50',
            settlement_status_code: 'settled',
            settlement_result_code: 'win',
            ui_result_code: 'won',
            ui_result_label: 'Зашло',
            profit_factor: '0.500000',
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
      url: '/history?limit=5&offset=2',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.items.length, 2);
    assert.equal(payload.empty_state, null);
    assert.equal(payload.summary.total_cards, 4);
    assert.equal(payload.summary.total_bets, 4);
    assert.equal(payload.summary.won_count, 3);
    assert.equal(payload.summary.lost_count, 1);
    assert.equal(payload.summary.profit_units, 1.24);
    assert.deepEqual(payload.pagination, { limit: 5, offset: 2, returned: 1, total_cards: 4 });

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
    const sibling = payload.items[1];
    assert.equal(sibling.id, 'prediction-card:102');
    assert.equal(sibling.primary_match_id, 55);
    assert.equal(sibling.bets.length, 1);
    assert.equal(sibling.bets[0].result_code, 'won');
  } finally {
    await app.close();
  }
});

test('GET /history keeps empty paginated read-model page instead of falling back', async () => {
  const fakePg = createFakePg({
    handler(query) {
      if (/FROM public\.user_tournament ut/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      if (/FROM bet\.v_prediction_card_history/i.test(query)) {
        if (/COUNT\(\*\)/i.test(query)) return [{ total_cards: '13', total_bets: '33', pending_count: '33' }];
        return [];
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
      url: '/history?limit=5&offset=13',
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.deepEqual(payload.items, []);
    assert.deepEqual(payload.pagination, { limit: 5, offset: 13, returned: 0, total_cards: 13 });
    assert.equal(payload.empty_state, null);
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
