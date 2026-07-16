'use strict';

const sstatsApi = require('../../lib/sstatsApi');

const SUPPORTED_MARKETS = new Set(['one_x_two', 'double_chance', 'total', 'both_to_score', 'correct_score']);
const FINAL_STATUSES = new Set(['finished', 'completed', 'ft', 'full_time', 'final']);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseScorePair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const home = numberOrNull(value[0]); const away = numberOrNull(value[1]);
    return home !== null && away !== null ? { home_score: home, away_score: away } : null;
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    return match ? { home_score: Number(match[1]), away_score: Number(match[2]) } : null;
  }
  if (value && typeof value === 'object') {
    const home = numberOrNull(value.home_score ?? value.home ?? value.homeScore ?? value.home_team);
    const away = numberOrNull(value.away_score ?? value.away ?? value.awayScore ?? value.away_team);
    return home !== null && away !== null ? { home_score: home, away_score: away } : null;
  }
  return null;
}

function extractFinalScore(sourcePayload, matchRow = {}) {
  const payload = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {};
  const game = payload.game || payload;
  const candidates = [
    payload.final_score, payload.finalScore, payload.score, payload.scores,
    payload.full_time, payload.fullTime, payload.result,
    payload.sstats_data && (payload.sstats_data.final_score || payload.sstats_data.score || payload.sstats_data.scores),
    game && { home_score: game.homeResult, away_score: game.awayResult },
    game && { home_score: game.homeScore, away_score: game.awayScore },
  ];
  for (const candidate of candidates) {
    const score = parseScorePair(candidate);
    if (score) return score;
  }
  return parseScorePair({
    home_score: matchRow.home_score ?? matchRow.homeScore,
    away_score: matchRow.away_score ?? matchRow.awayScore,
  });
}

function isFinalSourcePayload(sourcePayload = {}) {
  const payload = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {};
  const rawStatus = payload.statusName || payload.game?.statusName || payload.game?.status?.name || (typeof payload.status === 'string' ? payload.status : '') || '';
  const status = String(rawStatus).toLowerCase().replace(/\s+/g, '_');
  const statusId = Number(
    payload.status?.id
      ?? payload.game?.status?.id
      ?? (typeof payload.status === 'number' ? payload.status : undefined)
      ?? (typeof payload.game?.status === 'number' ? payload.game.status : undefined)
      ?? payload.statusId
      ?? payload.game?.statusId,
  );
  return FINAL_STATUSES.has(status) || [8, 9, 10].includes(statusId);
}

async function resolveFinalScore(row, { fetchSstatsGame = null } = {}) {
  const sourcePayload = row.match_source_payload || row.source_payload;
  const localScore = extractFinalScore(sourcePayload, row);
  if (localScore && isFinalSourcePayload(sourcePayload)) return { score: localScore, sourcePayload };

  const sstatsId = row.sstats_match_id == null ? null : Number(row.sstats_match_id);
  if (!sstatsId) return { score: null, sourcePayload };

  const fetcher = fetchSstatsGame || (sstatsApi.hasApiKey() ? sstatsApi.getGame : null);
  if (!fetcher) return { score: null, sourcePayload };
  const livePayload = await fetcher(sstatsId);
  const liveScore = extractFinalScore(livePayload, row);
  if (liveScore && isFinalSourcePayload(livePayload)) return { score: liveScore, sourcePayload: livePayload };
  return { score: null, sourcePayload: livePayload || sourcePayload };
}

function parseMarket(row) {
  const parts = String(row.market_key || '').split('|');
  return {
    market: row.market_type_code || parts[0] || null,
    period: row.period_code || parts[1] || null,
    selection: row.selection_code || parts[3] || null,
    line: numberOrNull(row.line_value ?? parts[4]),
  };
}

function unsupported(reason_code) {
  return { settlement_status_code: 'not_supported', settlement_result_code: 'unknown', reason_code };
}

function settleEarlyPredictionBet(row, liveScore) {
  const market = parseMarket(row);
  if (!liveScore || numberOrNull(liveScore.home_score) === null || numberOrNull(liveScore.away_score) === null) {
    return { settlement_status_code: 'pending', settlement_result_code: 'unknown', reason_code: 'no_live_score' };
  }
  if (market.period !== 'full_time') return { settlement_status_code: 'pending', settlement_result_code: 'unknown', reason_code: 'early_period_not_supported' };
  const home = Number(liveScore.home_score); const away = Number(liveScore.away_score);
  const total = home + away;
  if (market.market === 'total' && market.line !== null && total > market.line) {
    if (market.selection === 'over') return { settlement_status_code: 'settled', settlement_result_code: 'win', reason_code: 'early_total_over_locked' };
    if (market.selection === 'under') return { settlement_status_code: 'settled', settlement_result_code: 'loss', reason_code: 'early_total_under_locked_loss' };
  }
  if (market.market === 'both_to_score' && market.selection === 'yes' && home > 0 && away > 0) return { settlement_status_code: 'settled', settlement_result_code: 'win', reason_code: 'early_btts_yes_locked' };
  if (market.market === 'team_total' && market.line !== null) {
    const scope = String(row.participant_scope || row.team_scope || row.selection_participant || '').toLowerCase();
    const teamScore = ['home', 'home_team', '1'].includes(scope) ? home : ['away', 'away_team', '2'].includes(scope) ? away : null;
    if (teamScore !== null && teamScore > market.line) {
      if (market.selection === 'over') return { settlement_status_code: 'settled', settlement_result_code: 'win', reason_code: 'early_team_total_over_locked' };
      if (market.selection === 'under') return { settlement_status_code: 'settled', settlement_result_code: 'loss', reason_code: 'early_team_total_under_locked_loss' };
    }
  }
  return { settlement_status_code: 'pending', settlement_result_code: 'unknown', reason_code: 'not_mathematically_locked' };
}

function settlePredictionBet(row, finalScore) {
  const market = parseMarket(row);
  if (!finalScore || numberOrNull(finalScore.home_score) === null || numberOrNull(finalScore.away_score) === null) {
    return { settlement_status_code: 'pending', settlement_result_code: 'unknown', reason_code: 'no_final_score' };
  }
  if (market.period !== 'full_time') return unsupported('unsupported_period');
  if (!SUPPORTED_MARKETS.has(market.market)) return unsupported('unsupported_market');

  const home = Number(finalScore.home_score); const away = Number(finalScore.away_score);
  const total = home + away;
  let won;
  if (market.market === 'one_x_two') {
    const actual = home === away ? 'draw' : home > away ? 'home' : 'away';
    won = actual === market.selection;
  } else if (market.market === 'double_chance') {
    const actual = home === away ? 'draw' : home > away ? 'home' : 'away';
    const selections = {
      home_or_draw: ['home', 'draw'],
      away_or_draw: ['away', 'draw'],
      home_or_away: ['home', 'away'],
      x1: ['home', 'draw'],
      '1x': ['home', 'draw'],
      x2: ['away', 'draw'],
      '12': ['home', 'away'],
    };
    if (!selections[market.selection]) return unsupported('unsupported_selection');
    won = selections[market.selection].includes(actual);
  } else if (market.market === 'total') {
    if (market.line === null || !['over', 'under'].includes(market.selection)) return unsupported('invalid_total');
    if (total === market.line) return { settlement_status_code: 'settled', settlement_result_code: 'push', reason_code: 'total_equals_line' };
    won = market.selection === 'over' ? total > market.line : total < market.line;
  } else if (market.market === 'both_to_score') {
    if (!['yes', 'no'].includes(market.selection)) return unsupported('unsupported_selection');
    const actual = home > 0 && away > 0;
    won = market.selection === 'yes' ? actual : !actual;
  } else {
    const expectedHome = numberOrNull(row.score_home);
    const expectedAway = numberOrNull(row.score_away);
    if (market.selection !== 'exact_score' || expectedHome === null || expectedAway === null) return unsupported('invalid_correct_score');
    won = home === expectedHome && away === expectedAway;
  }
  return { settlement_status_code: 'settled', settlement_result_code: won ? 'win' : 'loss', reason_code: won ? 'rule_match' : 'rule_mismatch' };
}

function buildPendingQuery({ limit, predictionBetId }) {
  return {
    sql: `SELECT pbs.*, ms.source_payload AS match_source_payload, m.match_update_at, epm.system_match_id AS sstats_match_id
          FROM bet.v_prediction_bet_settlements pbs
          LEFT JOIN LATERAL (
            SELECT source_payload FROM public.match_source
            WHERE match_id = pbs.match_id ORDER BY source_update_at DESC NULLS LAST, match_source_id DESC LIMIT 1
          ) ms ON true
          LEFT JOIN public.match m ON m.match_id = pbs.match_id
          LEFT JOIN external.public_match epm ON epm.match_id = pbs.match_id AND epm.system_id = 3
          WHERE pbs.settlement_status_code = 'pending'
            AND ($2::bigint IS NULL OR pbs.prediction_bet_id = $2)
          ORDER BY pbs.prediction_bet_id
          LIMIT $1`,
    params: [limit, predictionBetId],
  };
}

async function writeSettlement(pg, row, outcome, finalScore, sourcePayload) {
  await pg.connection(
    `SELECT bet.bet_settlement_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [row.prediction_bet_id, outcome.settlement_status_code, outcome.settlement_result_code,
      outcome.settlement_status_code === 'settled' ? new Date().toISOString() : null, 'v1',
      finalScore || {}, outcome, profitFactorFor(row, outcome),
      outcome.reason_code, outcome.reason_code, 'rule_engine', sourcePayload || {}, true],
  );
}

function accumulateSettlementSummary(summary, row, outcome, finalScore) {
  summary.processed += 1;
  if (outcome.settlement_status_code === 'settled') summary.settled += 1;
  else if (outcome.settlement_status_code === 'not_supported') summary.not_supported += 1;
  else summary.pending += 1;
  summary.results.push({ prediction_bet_id: row.prediction_bet_id, ...outcome, score: finalScore });
}

async function settlePredictionBets(pg, { dryRun = true, limit = 100, predictionBetId = null, fetchSstatsGame = null } = {}) {
  const query = buildPendingQuery({ limit, predictionBetId });
  const rows = await pg.connection(query.sql, query.params);
  const summary = { processed: 0, settled: 0, pending: 0, not_supported: 0, dry_run: dryRun, results: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    const resolved = await resolveFinalScore(row, { fetchSstatsGame });
    const finalScore = resolved.score;
    const sourcePayload = resolved.sourcePayload;
    const outcome = settlePredictionBet(row, finalScore);
    accumulateSettlementSummary(summary, row, outcome, finalScore);
    if (!dryRun && outcome.settlement_status_code !== 'pending') await writeSettlement(pg, row, outcome, finalScore, sourcePayload);
  }
  summary.would_settle = summary.settled + summary.not_supported;
  return summary;
}

async function settlePredictionBetsForMatch(pg, { matchId, finalScore, sourcePayload = {}, dryRun = false, early = false } = {}) {
  if (!matchId) throw new Error('matchId is required');
  const rows = await pg.connection(`
    SELECT *
    FROM bet.v_prediction_bet_settlements
    WHERE settlement_status_code = 'pending'
      AND match_id = $1
    ORDER BY prediction_bet_id
  `, [matchId]);
  const summary = { processed: 0, settled: 0, pending: 0, not_supported: 0, dry_run: dryRun, results: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    const outcome = early ? settleEarlyPredictionBet(row, finalScore) : settlePredictionBet(row, finalScore);
    accumulateSettlementSummary(summary, row, outcome, finalScore);
    if (!dryRun && outcome.settlement_status_code !== 'pending') await writeSettlement(pg, row, outcome, finalScore, sourcePayload);
  }
  summary.would_settle = summary.settled + summary.not_supported;
  return summary;
}

function profitFactorFor(row, outcome) {
  if (outcome.settlement_result_code === 'win') return Number(row.odds_decimal || 1) - 1;
  if (outcome.settlement_result_code === 'loss') return -1;
  return 0;
}

function parseArgs(argv) {
  const args = { dryRun: true, limit: 100, predictionBetId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--limit' || arg === '--prediction-bet-id') {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${arg}: ${raw}`);
      if (arg === '--limit') args.limit = value;
      else args.predictionBetId = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

module.exports = { extractFinalScore, isFinalSourcePayload, resolveFinalScore, settlePredictionBet, settleEarlyPredictionBet, settlePredictionBets, settlePredictionBetsForMatch, parseArgs, buildPendingQuery };
