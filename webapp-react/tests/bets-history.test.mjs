import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatProfitUnits,
  getHistoryStatusPresentation,
  mapHistoryBet,
  mapHistoryCard,
  getHistorySummaryPresentation,
  hasNextHistoryPage,
  getRecentBetStreak,
  getAverageOdds,
  filterHistoryCardsByPeriod,
  getHistoryStatsFromCards,
  aggregateBetsByMarketType,
  aggregateBetsByDirection,
  aggregateBetsByProbability,
  aggregateBetsByReferenceDirection,
  getProfitBuckets,
  getHistoryRecords,
  flattenHistoryBets,
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

test('mapHistoryBet preserves a real stake field without inventing one', () => {
  const withStake = mapHistoryBet({ prediction_bet_id: '203', stake_units: '25' });
  const withoutStake = mapHistoryBet({ prediction_bet_id: '204' });

  assert.equal(withStake.stake_units, 25);
  assert.equal(Object.hasOwn(withoutStake, 'stake_units'), false);
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

test('getRecentBetStreak maps real bet outcomes to compact reference markers', () => {
  const streak = getRecentBetStreak([
    { bets: [{ result_code: 'won' }, { result_code: 'lost' }, { result_code: 'void' }, { result_code: 'pending' }, { result_code: 'not_supported' }] },
  ]);

  assert.deepEqual(streak.map((item) => item.marker), ['В', 'П', '↩', '·', '?']);
  assert.deepEqual(streak.map((item) => item.code), ['won', 'lost', 'void', 'pending', 'not_supported']);
});

test('getAverageOdds averages only finite decimal odds from nested history bets', () => {
  assert.equal(getAverageOdds([
    { bets: [{ odds_decimal: 1.5 }, { odds_decimal: '2.5' }] },
    { bets: [{ odds_decimal: null }, { odds_decimal: 'bad' }] },
  ]), 2);
  assert.equal(getAverageOdds([]), null);
});

test('filterHistoryCardsByPeriod filters by published_at within the selected rolling window', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const cards = [
    { id: 'week', published_at: '2026-07-10T12:00:00.000Z' },
    { id: 'month', published_at: '2026-06-20T12:00:00.000Z' },
    { id: 'old', published_at: '2026-06-14T11:59:59.000Z' },
    { id: 'future', starts_at: '2026-07-20T12:00:00.000Z' },
    { id: 'fallback', published_at: 'not-a-date', starts_at: '2026-07-12T12:00:00.000Z' },
    { id: 'invalid', published_at: 'not-a-date' },
  ];

  assert.deepEqual(filterHistoryCardsByPeriod(cards, 'Неделя', now).map((card) => card.id), ['week', 'fallback']);
  assert.deepEqual(filterHistoryCardsByPeriod(cards, 'Месяц', now).map((card) => card.id), ['week', 'month', 'fallback']);
  assert.deepEqual(filterHistoryCardsByPeriod(cards, 'Всё время', now).map((card) => card.id), cards.map((card) => card.id));
});

test('getHistoryStatsFromCards recomputes filtered counts, hit rate and profit', () => {
  const stats = getHistoryStatsFromCards([
    { bets_count: 2, won_count: 2, lost_count: 0, void_count: 0, pending_count: 0, not_supported_count: 0, profit_units: 1.5 },
    { bets_count: 3, won_count: 1, lost_count: 2, void_count: 1, pending_count: 1, not_supported_count: 0, profit_units: -0.5 },
  ]);

  assert.deepEqual(stats, {
    total_cards: 2,
    total_bets: 5,
    won_count: 3,
    lost_count: 2,
    void_count: 1,
    pending_count: 1,
    not_supported_count: 0,
    profit_units: 1,
    hit_rate_percent: 60,
    profit_label: '+1.00',
    hit_rate_label: '60.00%',
  });
});

test('aggregateBetsByMarketType groups nested bets and keeps unsupported neutral', () => {
  const groups = aggregateBetsByMarketType([
    { bets: [
      { market_type: 'one_x_two', market_name: 'Победа', result_code: 'won', profit_units: 0.8 },
      { market_type: 'one_x_two', market_name: 'Победа', result_code: 'lost', profit_units: -1 },
      { market_type: 'total_over', market_name: 'Тотал больше', result_code: 'not_supported', profit_units: 0 },
    ] },
    { bets: [{ market_type: 'total_over', market_name: 'Тотал больше', result_code: 'pending', profit_units: 0 }] },
  ]);

  assert.deepEqual(groups, [
    {
      key: 'one_x_two|Победа', label: 'Исход матча', total: 2, won: 1, lost: 1, void: 0,
      pending: 0, not_supported: 0, profit_units: -0.2, hit_rate_percent: 50,
    },
    {
      key: 'total_over|Тотал больше', label: 'Тотал матча', total: 2, won: 0, lost: 0, void: 0,
      pending: 1, not_supported: 1, profit_units: 0, hit_rate_percent: null,
    },
  ]);
});

test('aggregateBetsByMarketType uses Russian labels for known market types and falls back safely', () => {
  const marketTypes = [
    ['one_x_two', 'Исход матча'],
    ['double_chance', 'Двойной шанс'],
    ['total_over', 'Тотал матча'],
    ['total_under', 'Тотал матча'],
    ['total', 'Тотал матча'],
    ['match_total', 'Тотал матча'],
    ['team_total', 'Индивидуальный тотал'],
    ['both_to_score', 'Обе забьют'],
    ['correct_score', 'Точный счёт'],
    ['handicap', 'Фора'],
    ['asian_handicap', 'Фора'],
  ];
  const cards = [{ bets: marketTypes.map(([market_type]) => ({ market_type, market_name: 'API English label' })) }];
  cards[0].bets.push(
    { market_type: 'unknown_type', market_name: 'Название рынка' },
    { market_type: 'unknown_without_name', market_name: '' },
  );

  assert.deepEqual(
    aggregateBetsByMarketType(cards).map(({ key, label, total }) => ({ key, label, total })),
    [
      ...marketTypes.map(([market_type, label]) => ({ key: `${market_type}|API English label`, label, total: 1 })),
      { key: 'unknown_type|Название рынка', label: 'Название рынка', total: 1 },
      { key: 'unknown_without_name|', label: 'unknown_without_name', total: 1 },
    ],
  );
});

test('aggregateBetsByMarketType translates the live total market contract', () => {
  const [group] = aggregateBetsByMarketType([
    { bets: [{ market_type: 'total', market_name: 'Match total' }] },
  ]);

  assert.equal(group.label, 'Тотал матча');
});

test('aggregateBetsByDirection classifies every total_ market as totals', () => {
  const groups = aggregateBetsByDirection([
    { bets: [
      { market_type: 'total_corners', market_name: 'Угловые', result_code: 'won', profit_units: 0.5 },
      { market_type: 'total_foo', market_name: 'Особый рынок', result_code: 'lost', profit_units: -1 },
    ] },
  ]);

  assert.deepEqual(groups.map(({ key, label, total, won, lost, profit_units, hit_rate_percent }) => ({
    key, label, total, won, lost, profit_units, hit_rate_percent,
  })), [
    { key: 'Тоталы', label: 'Тоталы', total: 2, won: 1, lost: 1, profit_units: -0.5, hit_rate_percent: 50 },
  ]);
});

test('aggregateBetsByDirection classifies requested market families and calculates metrics', () => {
  const groups = aggregateBetsByDirection([
    { bets: [
      { market_type: 'double_chance', market_name: 'X2', result_code: 'won', profit_units: 0.5 },
      { market_type: 'total_under', market_name: 'ТМ 2.5', result_code: 'lost', profit_units: -1 },
      { market_type: 'asian_handicap', market_name: 'Фора -1', result_code: 'void', profit_units: 0 },
      { market_type: 'both_to_score', market_name: 'Обе забьют', result_code: 'pending', profit_units: 0 },
      { market_type: 'correct_score', market_name: 'Точный счёт 2:1', result_code: 'not_supported', profit_units: 0 },
      { market_type: 'corners', market_name: 'Угловые', result_code: 'won', profit_units: 0.25 },
    ] },
  ]);

  assert.deepEqual(groups.map(({ key, label, total, won, lost, void: voidCount, pending, not_supported, profit_units, hit_rate_percent }) => ({
    key, label, total, won, lost, void: voidCount, pending, not_supported, profit_units, hit_rate_percent,
  })), [
    { key: 'Победа/исходы', label: 'Победа/исходы', total: 1, won: 1, lost: 0, void: 0, pending: 0, not_supported: 0, profit_units: 0.5, hit_rate_percent: 100 },
    { key: 'Тоталы', label: 'Тоталы', total: 1, won: 0, lost: 1, void: 0, pending: 0, not_supported: 0, profit_units: -1, hit_rate_percent: 0 },
    { key: 'Фора', label: 'Фора', total: 1, won: 0, lost: 0, void: 1, pending: 0, not_supported: 0, profit_units: 0, hit_rate_percent: null },
    { key: 'Обе забьют', label: 'Обе забьют', total: 1, won: 0, lost: 0, void: 0, pending: 1, not_supported: 0, profit_units: 0, hit_rate_percent: null },
    { key: 'Точный счёт', label: 'Точный счёт', total: 1, won: 0, lost: 0, void: 0, pending: 0, not_supported: 1, profit_units: 0, hit_rate_percent: null },
    { key: 'Прочее', label: 'Прочее', total: 1, won: 1, lost: 0, void: 0, pending: 0, not_supported: 0, profit_units: 0.25, hit_rate_percent: 100 },
  ]);
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

test('aggregateBetsByProbability groups risk levels and keeps neutral bets out of hit rate', () => {
  const groups = aggregateBetsByProbability([{ bets: [
    { risk_level: 'low', result_code: 'won' },
    { risk_level: 'medium', result_code: 'lost' },
    { confidence: 75, result_code: 'won' },
    { confidence: 50, result_code: 'not_supported' },
    { confidence: 20, result_code: 'pending' },
  ] }]);
  assert.deepEqual(groups.map(({ key, label, total, hit_rate_percent }) => ({ key, label, total, hit_rate_percent })), [
    { key: 'low', label: 'Надёжные', total: 2, hit_rate_percent: 100 },
    { key: 'medium', label: 'Средние', total: 2, hit_rate_percent: 0 },
    { key: 'high', label: 'Рискованные', total: 1, hit_rate_percent: null },
  ]);
});

test('aggregateBetsByReferenceDirection uses exact screenshot labels', () => {
  const groups = aggregateBetsByReferenceDirection([{ bets: [
    { market_type: 'one_x_two' }, { market_type: 'double_chance' },
    { market_type: 'total_over' }, { market_type: 'total' },
    { market_type: 'both_to_score' }, { market_type: 'handicap' },
    { market_type: 'correct_score' },
  ] }]);
  assert.deepEqual(groups.map(({ key, label, total }) => ({ key, label, total })), [
    { key: 'win', label: 'Победа', total: 2 },
    { key: 'total', label: 'Тотал', total: 2 },
    { key: 'btts', label: 'Обе забьют', total: 1 },
    { key: 'handicap', label: 'Фора', total: 1 },
    { key: 'correct_score', label: 'Точный счёт', total: 1 },
  ]);
});

test('aggregateBetsByReferenceDirection keeps all reference rows for no data', () => {
  assert.deepEqual(
    aggregateBetsByReferenceDirection([]).map(({ key, label, total }) => ({ key, label, total })),
    [
      { key: 'win', label: 'Победа', total: 0 },
      { key: 'total', label: 'Тотал', total: 0 },
      { key: 'btts', label: 'Обе забьют', total: 0 },
      { key: 'handicap', label: 'Фора', total: 0 },
      { key: 'correct_score', label: 'Точный счёт', total: 0 },
    ],
  );
});

test('getProfitBuckets creates chronological buckets from real bet profit', () => {
  const buckets = getProfitBuckets([
    { date: '2026-07-01T00:00:00Z', profit_units: 1.6 },
    { date: '2026-07-02T00:00:00Z', profit_units: 0.2 },
    { date: '2026-07-03T00:00:00Z', profit_units: -0.9 },
  ]);
  assert.deepEqual(buckets, [
    { label: 'W1', value: 160 },
    { label: 'W2', value: 20 },
    { label: 'W3', value: -90 },
  ]);
});

test('flattenHistoryBets and getHistoryRecords expose flat screenshot-ready records', () => {
  const cards = [{ id: 'card-1', match: 'A — B', published_at: '2026-07-15T10:00:00Z', bets: [
    { id: 'bet-1', label: 'П1', odds_decimal: 1.8, result_code: 'won', profit_units: 0.8 },
  ] }];
  const flat = flattenHistoryBets(cards);
  assert.equal(flat[0].match, 'A — B');
  assert.equal(flat[0].date, '2026-07-15T10:00:00Z');
  assert.equal(Object.hasOwn(flat[0], 'stake_units'), false);
  assert.equal(Object.hasOwn(getHistoryRecords(cards)[0], 'stake_units'), false);
});
