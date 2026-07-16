'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  settlePredictionBet,
  settlePredictionBets,
  resolveFinalScore,
  isFinalSourcePayload,
  parseArgs,
  settleEarlyPredictionBet,
} = require('../../webapp/services/predictionSettlementService');

const score = (home, away) => ({ home_score: home, away_score: away, status: 'finished' });
const bet = (overrides = {}) => ({
  prediction_bet_id: 10,
  match_id: 42,
  period_code: 'full_time',
  market_type_code: 'total',
  participant_scope: 'match',
  selection_code: 'over',
  line_value: '2.5',
  ...overrides,
});

test('pure rules settle total over/under with exact line as push', () => {
  assert.equal(settlePredictionBet(bet({ line_value: '2' }), score(1, 1)).settlement_result_code, 'push');
  assert.equal(settlePredictionBet(bet(), score(2, 1)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ selection_code: 'under' }), score(2, 1)).settlement_result_code, 'loss');
});

test('pure rules settle BTTS and exact correct score', () => {
  assert.equal(settlePredictionBet(bet({ market_type_code: 'both_to_score', selection_code: 'yes', line_value: null }), score(1, 1)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ market_type_code: 'both_to_score', selection_code: 'no', line_value: null }), score(1, 0)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ market_type_code: 'correct_score', selection_code: 'exact_score', score_home: 2, score_away: 1, line_value: null }), score(2, 1)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ market_type_code: 'correct_score', selection_code: 'exact_score', score_home: 2, score_away: 1, line_value: null }), score(1, 1)).settlement_result_code, 'loss');
});

test('pure rules support 1X2 and double chance and reject unsupported period/market', () => {
  assert.equal(settlePredictionBet(bet({ market_type_code: 'one_x_two', selection_code: 'home', line_value: null }), score(2, 0)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ market_type_code: 'double_chance', selection_code: 'home_or_draw', line_value: null }), score(1, 1)).settlement_result_code, 'win');
  assert.equal(settlePredictionBet(bet({ market_type_code: 'double_chance', selection_code: 'x2', line_value: null }), score(0, 2)).settlement_result_code, 'win');
  assert.deepEqual(settlePredictionBet(bet({ market_type_code: 'handicap' }), score(1, 0)), {
    settlement_status_code: 'not_supported', settlement_result_code: 'unknown', reason_code: 'unsupported_market',
  });
  assert.equal(settlePredictionBet(bet({ period_code: 'first_half' }), score(1, 0)).settlement_status_code, 'not_supported');
});

test('missing final score remains pending and unknown, never loss', () => {
  const result = settlePredictionBet(bet(), null);
  assert.equal(result.settlement_status_code, 'pending');
  assert.equal(result.settlement_result_code, 'unknown');
});

test('early settlement closes only mathematically locked wins', () => {
  assert.equal(settleEarlyPredictionBet(bet(), { home_score: 2, away_score: 1 }).settlement_result_code, 'win');
  assert.equal(settleEarlyPredictionBet(bet({ line_value: '3' }), { home_score: 2, away_score: 1 }).settlement_status_code, 'pending');
  assert.equal(settleEarlyPredictionBet(bet({ market_type_code: 'both_to_score', selection_code: 'yes', line_value: null }), { home_score: 1, away_score: 1 }).settlement_result_code, 'win');
  assert.equal(settleEarlyPredictionBet(bet({ market_type_code: 'both_to_score', selection_code: 'no', line_value: null }), { home_score: 1, away_score: 0 }).settlement_status_code, 'pending');
  assert.equal(settleEarlyPredictionBet(bet({ market_type_code: 'team_total', participant_scope: 'home', selection_code: 'over', line_value: 1 }), { home_score: 2, away_score: 0 }).settlement_result_code, 'win');
});

test('service loads pending rows with parameterized SQL and writes settlement through existing upsert', async () => {
  const calls = [];
  const pg = { connection: async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return [{ ...bet({ prediction_bet_id: 99 }), source_payload: { status: 'Finished', final_score: { home: 2, away: 1 } } }];
    return [{ bet_settlement_upsert: 123 }];
  } };
  const result = await settlePredictionBets(pg, { dryRun: false, limit: 5 });
  assert.equal(result.processed, 1);
  assert.equal(result.settled, 1);
  assert.match(calls[0].sql, /FROM bet\.v_prediction_bet_settlements/);
  assert.ok(calls[0].sql.includes('$1'));
  assert.match(calls[1].sql, /bet\.bet_settlement_upsert/);
  assert.deepEqual(calls[1].params.slice(0, 3), [99, 'settled', 'win']);
});

test('dry-run does not write and prediction-bet filter is parameterized', async () => {
  const calls = [];
  const pg = { connection: async (sql, params) => {
    calls.push({ sql, params });
    return [{ ...bet({ prediction_bet_id: 7 }), source_payload: { status: 'Finished', final_score: { home: 0, away: 0 } } }];
  } };
  const result = await settlePredictionBets(pg, { dryRun: true, limit: 1, predictionBetId: 7 });
  assert.equal(result.would_settle, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('$2'));
  assert.deepEqual(calls[0].params, [1, 7]);
});

test('resolver fetches final SStats score when local bundle is stale', async () => {
  const resolved = await resolveFinalScore({
    sstats_match_id: '1585131',
    match_source_payload: { sstats_data: { status: 'Not Started', score: { home: null, away: null } } },
  }, {
    fetchSstatsGame: async () => ({ game: { status: 8, statusName: 'Finished', homeResult: 0, awayResult: 2 } }),
  });
  assert.deepEqual(resolved.score, { home_score: 0, away_score: 2 });
});

test('resolver never settles non-final local or cancelled SStats scores', async () => {
  assert.equal(isFinalSourcePayload({ status: 14, score: { home: 1, away: 0 } }), false);
  assert.equal(isFinalSourcePayload({ status: 15, score: { home: 1, away: 0 } }), false);
  assert.equal(isFinalSourcePayload({ status: 8, score: { home: 1, away: 0 } }), true);

  const liveLocal = await resolveFinalScore({
    match_source_payload: { status: 'Live', final_score: { home: 1, away: 0 } },
  });
  assert.equal(liveLocal.score, null);

  const cancelledRemote = await resolveFinalScore({
    sstats_match_id: '123',
    match_source_payload: { status: 'Not Started' },
  }, {
    fetchSstatsGame: async () => ({ game: { status: 14, homeResult: 1, awayResult: 0 } }),
  });
  assert.equal(cancelledRemote.score, null);
});

test('CLI parser defaults to dry-run and fails fast on invalid arguments', () => {
  assert.deepEqual(parseArgs(['node', 'script']), { dryRun: true, limit: 100, predictionBetId: null });
  assert.deepEqual(parseArgs(['node', 'script', '--apply', '--limit', '33', '--prediction-bet-id', '9']), { dryRun: false, limit: 33, predictionBetId: 9 });
  assert.throws(() => parseArgs(['node', 'script', '--limit', '0']), /Invalid --limit/);
  assert.throws(() => parseArgs(['node', 'script', '--prediction-bet-id', 'x']), /Invalid --prediction-bet-id/);
  assert.throws(() => parseArgs(['node', 'script', '--wat']), /Unknown argument/);
});
