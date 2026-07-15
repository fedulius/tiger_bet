import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatProfitUnits,
  getHistoryStatusPresentation,
  mapHistoryBet,
  mapHistoryCard,
  getHistorySummaryPresentation,
  hasNextHistoryPage,
} from '../src/lib/bets-history.js';

import { getHistory } from '../src/lib/api.js';

test('formatProfitUnits safely formats finite profit with an explicit sign', () => {
  assert.equal(formatProfitUnits(0.74), '+0.74');
  assert.equal(formatProfitUnits(-1), '-1.00');
  assert.equal(formatProfitUnits('bad'), '—');
  assert.equal(formatProfitUnits(undefined), '—');
});

test('getHistoryStatusPresentation is table-driven for every history status', () => {
  const cases = [
    ['won', { code: 'won', label: 'Зашло', tone: 'success', isLossStyle: false }],
    ['lost', { code: 'lost', label: 'Не зашло', tone: 'danger', isLossStyle: true }],
    ['mixed', { code: 'mixed', label: 'Смешанный результат', tone: 'warning', isLossStyle: false }],
    ['pending', { code: 'pending', label: 'Ждём результат', tone: 'neutral', isLossStyle: false }],
    ['void', { code: 'void', label: 'Возврат', tone: 'neutral', isLossStyle: false }],
    ['not_supported', { code: 'not_supported', label: 'Пока не рассчитываем', tone: 'neutral', isLossStyle: false }],
    ['empty', { code: 'empty', label: 'Нет ставок', tone: 'neutral', isLossStyle: false }],
    ['unknown', { code: 'unknown', label: 'Неизвестно', tone: 'neutral', isLossStyle: false }],
  ];

  for (const [status, expected] of cases) {
    assert.deepEqual(getHistoryStatusPresentation(status), expected, status);
  }

  assert.equal(getHistoryStatusPresentation('unexpected').code, 'unknown');
});

test('mapHistoryBet maps the real settled API result shape table-driven', () => {
  const cases = [
    { settlement_result_code: 'win', ui_result_code: 'won', expected: 'won' },
    { settlement_result_code: 'loss', ui_result_code: 'lost', expected: 'lost' },
    { settlement_result_code: 'push', ui_result_code: 'void', expected: 'void' },
    { settlement_result_code: 'win', ui_result_code: null, expected: 'won' },
    { settlement_result_code: 'loss', ui_result_code: '', expected: 'lost' },
    { settlement_result_code: 'push', ui_result_code: '', expected: 'void' },
  ];

  for (const { settlement_result_code, ui_result_code, expected } of cases) {
    const bet = mapHistoryBet({
      prediction_bet_id: 'api-settled-bet',
      settlement_status_code: 'settled',
      settlement_result_code,
      ui_result_code,
      display_label: null,
      odds_decimal: '',
      confidence: null,
      line_value: '',
      reason: null,
      market_type_code: null,
    });

    assert.equal(bet.settlement_status, 'settled', settlement_result_code);
    assert.equal(bet.settlement_result, settlement_result_code, settlement_result_code);
    assert.equal(bet.result_code, expected, settlement_result_code);
    assert.equal(bet.status.code, expected, settlement_result_code);
    assert.equal(bet.odds_decimal, null, settlement_result_code);
    assert.equal(bet.confidence, null, settlement_result_code);
    assert.equal(bet.line_value, null, settlement_result_code);
    assert.equal(Object.values(bet).some((value) => value === undefined), false, settlement_result_code);
  }
});

test('mapHistoryBet normalizes settlement fields without leaking undefined or NaN', () => {
  const bet = mapHistoryBet({
    prediction_bet_id: '202',
    display_label: 'ТБ 2.5',
    odds_decimal: 'bad',
    confidence: undefined,
    settlement_status_code: 'not_supported',
    profit_factor: null,
  });

  assert.equal(bet.id, 'prediction-bet:202');
  assert.equal(bet.label, 'ТБ 2.5');
  assert.equal(bet.odds_decimal, null);
  assert.equal(bet.confidence, null);
  assert.equal(bet.status.code, 'not_supported');
  assert.equal(bet.profit_units, 0);
  assert.equal(Object.values(bet).some((value) => value === undefined), false);
});

test('mapHistoryCard maps nested bets, status and safe hit rate presentation', () => {
  const card = mapHistoryCard({
    prediction_card_id: '101',
    home_team: 'France',
    away_team: 'Spain',
    tournament_name: 'Чемпионат мира',
    bets_count: '2',
    won_count: '1',
    lost_count: '0',
    pending_count: '1',
    profit_units: '0.74',
    hit_rate_percent: null,
    bets: [{ prediction_bet_id: '1', settlement_status_code: 'won' }],
  });

  assert.equal(card.id, 'prediction-card:101');
  assert.equal(card.match, 'France — Spain');
  assert.equal(card.status.code, 'pending');
  assert.equal(card.profit_label, '+0.74');
  assert.equal(card.hit_rate_label, '—');
  assert.equal(card.bets.length, 1);
  assert.equal(Object.values(card).some((value) => value === undefined), false);
});

test('mapHistoryCard preserves the backend empty result presentation', () => {
  const card = mapHistoryCard({
    prediction_card_id: 'empty-card',
    result_code: 'empty',
    result_label: 'Нет ставок',
    bets_count: 0,
  });

  assert.equal(card.result_code, 'empty');
  assert.equal(card.result_label, 'Нет ставок');
  assert.equal(card.status.code, 'empty');
  assert.equal(card.status.label, 'Нет ставок');
});

test('getHistorySummaryPresentation treats not_supported separately from losses', () => {
  const summary = getHistorySummaryPresentation({
    total_cards: '2', total_bets: '3', won_count: '1', lost_count: '1',
    pending_count: '0', not_supported_count: '1', profit_units: '0.5', hit_rate_percent: null,
  });

  assert.equal(summary.total_bets, 3);
  assert.equal(summary.profit_label, '+0.50');
  assert.equal(summary.hit_rate_label, '—');
  assert.equal(summary.not_supported_count, 1);
  assert.equal(summary.loss_count, 1);
});

test('hasNextHistoryPage uses total cards and never returns true for malformed pagination', () => {
  assert.equal(hasNextHistoryPage({ limit: 2, offset: 0, returned: 2, total_cards: 3 }), true);
  assert.equal(hasNextHistoryPage({ limit: 2, offset: 2, returned: 1, total_cards: 3 }), false);
  assert.equal(hasNextHistoryPage(null), false);
});

test('getHistory calls the existing history endpoint with limit and offset', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await getHistory({ limit: 7, offset: 14 });
    assert.deepEqual(calls, ['/history?limit=7&offset=14']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
