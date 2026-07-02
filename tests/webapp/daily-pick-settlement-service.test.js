'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolvePredictionOutcome,
  settleDailyPickSnapshots,
} = require('../../webapp/services/dailyPickSettlementService');

// --- helpers ---

function makePrediction(overrides = {}) {
  return {
    match_id: '42',
    user_id: 1,
    slot_date: '2026-07-02',
    primary_forecast: 'home_win',
    ...overrides,
  };
}

function makeMatchResult(overrides = {}) {
  return {
    match_id: '42',
    status: 'finished',
    outcome: 'home_win',
    ...overrides,
  };
}

// --- resolvePredictionOutcome: pending ---

test('resolvePredictionOutcome: pending when matchResult is null', () => {
  const result = resolvePredictionOutcome({ prediction: makePrediction(), matchResult: null });
  assert.equal(result.status, 'pending');
  assert.equal(result.settled_outcome, null);
  assert.equal(result.settled_reason, 'no_result');
});

test('resolvePredictionOutcome: pending when matchResult is undefined', () => {
  const result = resolvePredictionOutcome({ prediction: makePrediction(), matchResult: undefined });
  assert.equal(result.status, 'pending');
  assert.equal(result.settled_reason, 'no_result');
});

test('resolvePredictionOutcome: pending when match not finished (in_progress)', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'in_progress' }),
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.settled_reason, 'match_not_finished');
});

test('resolvePredictionOutcome: pending when match not finished (scheduled)', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'scheduled' }),
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.settled_reason, 'match_not_finished');
});

test('resolvePredictionOutcome: pending when outcome field missing on finished match', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'home_win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: undefined, result_key: undefined }),
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.settled_reason, 'missing_outcome_field');
});

// --- resolvePredictionOutcome: won / lost ---

test('resolvePredictionOutcome: won on exact outcome match', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'home_win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: 'home_win' }),
  });
  assert.equal(result.status, 'won');
  assert.equal(result.settled_outcome, 'home_win');
  assert.equal(result.settled_reason, 'outcome_match');
});

test('resolvePredictionOutcome: lost on outcome mismatch', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'home_win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: 'away_win' }),
  });
  assert.equal(result.status, 'lost');
  assert.equal(result.settled_outcome, 'away_win');
  assert.equal(result.settled_reason, 'outcome_mismatch');
});

test('resolvePredictionOutcome: won with status=completed', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'draw' }),
    matchResult: makeMatchResult({ status: 'completed', outcome: 'draw' }),
  });
  assert.equal(result.status, 'won');
});

test('resolvePredictionOutcome: won with status=ft (short form)', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'away_win' }),
    matchResult: makeMatchResult({ status: 'ft', outcome: 'away_win' }),
  });
  assert.equal(result.status, 'won');
});

// --- resolvePredictionOutcome: void ---

test('resolvePredictionOutcome: void on cancelled match', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'cancelled' }),
  });
  assert.equal(result.status, 'void');
  assert.equal(result.settled_outcome, null);
  assert.equal(result.settled_reason, 'cancelled');
});

test('resolvePredictionOutcome: void on postponed match', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'postponed' }),
  });
  assert.equal(result.status, 'void');
  assert.equal(result.settled_reason, 'postponed');
});

test('resolvePredictionOutcome: void on abandoned match', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'abandoned' }),
  });
  assert.equal(result.status, 'void');
  assert.equal(result.settled_reason, 'abandoned');
});

test('resolvePredictionOutcome: void on void status', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction(),
    matchResult: makeMatchResult({ status: 'void' }),
  });
  assert.equal(result.status, 'void');
});

// --- fallback field resolution ---

test('resolvePredictionOutcome: falls back to predicted_outcome when primary_forecast absent', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: undefined, predicted_outcome: 'draw' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: 'draw' }),
  });
  assert.equal(result.status, 'won');
});

test('resolvePredictionOutcome: falls back to pick_value when primary_forecast and predicted_outcome absent', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: undefined, predicted_outcome: undefined, pick_value: 'away_win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: 'away_win' }),
  });
  assert.equal(result.status, 'won');
});

test('resolvePredictionOutcome: falls back to result_key when outcome absent in matchResult', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'home_win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: undefined, result_key: 'home_win' }),
  });
  assert.equal(result.status, 'won');
  assert.equal(result.settled_outcome, 'home_win');
});

test('resolvePredictionOutcome: case-insensitive outcome comparison', () => {
  const result = resolvePredictionOutcome({
    prediction: makePrediction({ primary_forecast: 'Home_Win' }),
    matchResult: makeMatchResult({ status: 'finished', outcome: 'home_win' }),
  });
  assert.equal(result.status, 'won');
});

// --- settleDailyPickSnapshots ---

test('settleDailyPickSnapshots: returns empty array for empty predictions list', async () => {
  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: [], resultLoader: async () => null });
  assert.deepEqual(settlements, []);
});

test('settleDailyPickSnapshots: won and lost are processed independently', async () => {
  const predictions = [
    makePrediction({ match_id: '1', primary_forecast: 'home_win' }),
    makePrediction({ match_id: '2', primary_forecast: 'away_win' }),
  ];

  const resultLoader = async (matchId) => {
    if (matchId === '1') return makeMatchResult({ match_id: '1', status: 'finished', outcome: 'home_win' });
    if (matchId === '2') return makeMatchResult({ match_id: '2', status: 'finished', outcome: 'home_win' });
    return null;
  };

  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: predictions, resultLoader });

  assert.equal(settlements.length, 2);
  assert.equal(settlements.find(s => s.match_id === '1').status, 'won');
  assert.equal(settlements.find(s => s.match_id === '2').status, 'lost');
});

test('settleDailyPickSnapshots: processes predictions independently (pending, void, no result)', async () => {
  const predictions = [
    makePrediction({ match_id: '10', primary_forecast: 'home_win' }),
    makePrediction({ match_id: '20', primary_forecast: 'draw' }),
    makePrediction({ match_id: '30', primary_forecast: 'away_win' }),
  ];

  const resultLoader = async (matchId) => {
    if (matchId === '10') return makeMatchResult({ match_id: '10', status: 'in_progress', outcome: null });
    if (matchId === '20') return makeMatchResult({ match_id: '20', status: 'cancelled', outcome: null });
    if (matchId === '30') return null;
    return null;
  };

  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: predictions, resultLoader });

  assert.equal(settlements.length, 3);
  assert.equal(settlements.find(s => s.match_id === '10').status, 'pending');
  assert.equal(settlements.find(s => s.match_id === '20').status, 'void');
  assert.equal(settlements.find(s => s.match_id === '30').status, 'pending');
});

test('settleDailyPickSnapshots: handles resultLoader error gracefully as pending', async () => {
  const predictions = [makePrediction({ match_id: '99' })];

  const resultLoader = async () => { throw new Error('network_error'); };

  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: predictions, resultLoader });

  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].status, 'pending');
  assert.equal(settlements[0].settled_reason, 'result_loader_error');
  assert.equal(settlements[0].error, 'network_error');
});

test('settleDailyPickSnapshots: error in one loader does not affect next prediction', async () => {
  const predictions = [
    makePrediction({ match_id: '1' }),
    makePrediction({ match_id: '2', primary_forecast: 'draw' }),
  ];

  const resultLoader = async (matchId) => {
    if (matchId === '1') throw new Error('timeout');
    return makeMatchResult({ match_id: '2', status: 'finished', outcome: 'draw' });
  };

  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: predictions, resultLoader });

  assert.equal(settlements.length, 2);
  assert.equal(settlements.find(s => s.match_id === '1').status, 'pending');
  assert.equal(settlements.find(s => s.match_id === '2').status, 'won');
});

test('settleDailyPickSnapshots: preserves user_id and slot_date in settlement', async () => {
  const prediction = makePrediction({ match_id: '5', user_id: 7, slot_date: '2026-07-02', primary_forecast: 'draw' });
  const resultLoader = async () => makeMatchResult({ match_id: '5', status: 'finished', outcome: 'draw' });

  const settlements = await settleDailyPickSnapshots({ unsettledPredictions: [prediction], resultLoader });

  assert.equal(settlements[0].user_id, 7);
  assert.equal(settlements[0].slot_date, '2026-07-02');
  assert.equal(settlements[0].match_id, '5');
  assert.equal(settlements[0].status, 'won');
});
