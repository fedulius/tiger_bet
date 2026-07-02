'use strict';

const FINISHED_STATUSES = new Set(['finished', 'completed', 'full_time', 'ft', 'ended']);
const VOID_STATUSES = new Set(['cancelled', 'postponed', 'void', 'abandoned', 'walkover']);

function resolvePickValue(prediction) {
  return prediction.primary_forecast ?? prediction.predicted_outcome ?? prediction.pick_value ?? null;
}

function resolveActualOutcome(matchResult) {
  return matchResult.outcome ?? matchResult.result_key ?? null;
}

function resolvePredictionOutcome({ prediction, matchResult }) {
  if (!matchResult) {
    return { status: 'pending', settled_outcome: null, settled_reason: 'no_result' };
  }

  const matchStatus = (matchResult.status || '').toLowerCase();

  if (VOID_STATUSES.has(matchStatus)) {
    return { status: 'void', settled_outcome: null, settled_reason: matchStatus };
  }

  if (!FINISHED_STATUSES.has(matchStatus)) {
    return { status: 'pending', settled_outcome: null, settled_reason: 'match_not_finished' };
  }

  const predicted = resolvePickValue(prediction);
  const actual = resolveActualOutcome(matchResult);

  if (predicted === null || actual === null) {
    return { status: 'pending', settled_outcome: actual, settled_reason: 'missing_outcome_field' };
  }

  if (String(predicted).toLowerCase() === String(actual).toLowerCase()) {
    return { status: 'won', settled_outcome: actual, settled_reason: 'outcome_match' };
  }

  return { status: 'lost', settled_outcome: actual, settled_reason: 'outcome_mismatch' };
}

async function settleDailyPickSnapshots({ unsettledPredictions, resultLoader }) {
  const settlements = [];

  for (const prediction of unsettledPredictions) {
    const matchId = prediction.match_id;
    let matchResult = null;

    try {
      matchResult = await resultLoader(matchId);
    } catch (err) {
      settlements.push({
        match_id: matchId,
        user_id: prediction.user_id ?? null,
        slot_date: prediction.slot_date ?? null,
        status: 'pending',
        settled_outcome: null,
        settled_reason: 'result_loader_error',
        error: err && err.message ? err.message : 'result_loader_error',
      });
      continue;
    }

    const outcome = resolvePredictionOutcome({ prediction, matchResult });

    settlements.push({
      match_id: matchId,
      user_id: prediction.user_id ?? null,
      slot_date: prediction.slot_date ?? null,
      ...outcome,
    });
  }

  return settlements;
}

module.exports = { resolvePredictionOutcome, settleDailyPickSnapshots };
