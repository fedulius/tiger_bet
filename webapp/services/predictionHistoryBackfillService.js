'use strict';

const crypto = require('crypto');

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseLineValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(',', '.').replace('_', '.');
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseCorrectScore(value) {
  const match = String(value || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!match) return { score_home: null, score_away: null };
  return { score_home: Number(match[1]), score_away: Number(match[2]) };
}

function normalizeRecommendedBet(rawBet = {}, ordinal = 1) {
  const type = String(rawBet.type || '').trim().toLowerCase();
  const outcome = String(rawBet.outcome || '').trim().toLowerCase();
  const label = rawBet.label || rawBet.market || rawBet.name || `${type}:${outcome}`;
  const base = {
    ordinal,
    kind: 'single',
    market_type_code: null,
    period_code: 'full_time',
    participant_scope: 'match',
    selection_code: outcome || null,
    line_value: null,
    score_home: null,
    score_away: null,
    market_key: null,
    display_label: label,
    odds_decimal: toNumber(rawBet.rate ?? rawBet.odds, null),
    risk_level_code: rawBet.risk_label || null,
    confidence: toNumber(rawBet.confidence, null),
    reason: rawBet.reason || null,
    source_payload: rawBet,
    selection_snapshot: rawBet,
  };

  if (type === 'one_x_two') {
    base.market_type_code = 'one_x_two';
    base.selection_code = ({ w1: 'home', home: 'home', x: 'draw', draw: 'draw', w2: 'away', away: 'away' })[outcome] || outcome || null;
  } else if (type === 'double_chance') {
    base.market_type_code = 'double_chance';
    base.selection_code = ({ x1: 'home_or_draw', '1x': 'home_or_draw', x2: 'away_or_draw', '2x': 'away_or_draw', 12: 'home_or_away' })[outcome] || outcome || null;
  } else if (type === 'both_to_score') {
    base.market_type_code = 'both_to_score';
    base.selection_code = ({ yes: 'yes', no: 'no' })[outcome] || outcome || null;
  } else if (type === 'total_over' || type === 'total_under') {
    base.market_type_code = 'total';
    base.selection_code = type === 'total_over' ? 'over' : 'under';
    base.line_value = parseLineValue(outcome || label);
  } else if (/^total_t[12]_(over|under)$/.test(type)) {
    base.market_type_code = 'team_total';
    base.participant_scope = type.includes('_t1_') ? 'home_team' : 'away_team';
    base.selection_code = type.endsWith('_over') ? 'over' : 'under';
    base.line_value = parseLineValue(outcome || label);
  } else if (/^handicap[12]$/.test(type)) {
    base.market_type_code = 'handicap';
    base.participant_scope = type === 'handicap1' ? 'home_team' : 'away_team';
    base.selection_code = base.participant_scope;
    base.line_value = parseLineValue(outcome || label);
  } else if (type === 'correct_score') {
    base.market_type_code = 'correct_score';
    base.selection_code = 'exact';
    const score = parseCorrectScore(outcome || label);
    base.score_home = score.score_home;
    base.score_away = score.score_away;
  } else {
    return null;
  }

  base.market_key = [base.market_type_code, base.period_code, base.participant_scope, base.selection_code, base.line_value ?? '', base.score_home ?? '', base.score_away ?? ''].join('|');
  return base;
}

function buildPublicationHash({ matchAnalysisId, analysisHash, editionNo = 1 }) {
  return crypto.createHash('sha256')
    .update(['daily', matchAnalysisId, analysisHash || '', editionNo].join('|'))
    .digest('hex');
}

async function loadDictionary(pg, schema, table, idColumn, codeColumn) {
  const rows = await pg.connection(`SELECT ${idColumn} AS id, ${codeColumn} AS code FROM ${schema}.${table} WHERE is_active = true`);
  return new Map(rows.map((row) => [row.code, row.id]));
}

async function loadDictionaries(pg) {
  const [cardType, cardStatus, marketType, period, riskLevel, settlementStatus] = await Promise.all([
    loadDictionary(pg, 'bet', 'card_type', 'card_type_id', 'card_type_code'),
    loadDictionary(pg, 'bet', 'card_status', 'card_status_id', 'card_status_code'),
    loadDictionary(pg, 'bet', 'market_type', 'market_type_id', 'market_type_code'),
    loadDictionary(pg, 'bet', 'period', 'period_id', 'period_code'),
    loadDictionary(pg, 'bet', 'risk_level', 'risk_level_id', 'risk_level_code'),
    loadDictionary(pg, 'bet', 'settlement_status', 'settlement_status_id', 'settlement_status_code'),
  ]);
  return { cardType, cardStatus, marketType, period, riskLevel, settlementStatus };
}

async function loadReadyAnalyses(pg, { limit = 100, matchAnalysisId = null } = {}) {
  const params = [];
  const where = ["ast.analysis_status_name = 'ready'", 'ma.recommended_bets IS NOT NULL', "jsonb_typeof(ma.recommended_bets) = 'array'", 'jsonb_array_length(ma.recommended_bets) > 0'];
  if (matchAnalysisId != null) {
    params.push(matchAnalysisId);
    where.push(`ma.match_analysis_id = $${params.length}`);
  }
  params.push(limit);

  return pg.connection(
    `SELECT
       ma.match_analysis_id,
       ma.match_source_id,
       ma.analysis_headline,
       ma.analysis_brief,
       ma.analysis_risk_note,
       ma.recommended_bets,
       ma.model_name,
       ma.prompt_version,
       ma.analysis_hash,
       ma.analysis_create_at,
       ma.analysis_update_at,
       ms.match_id,
       ms.source_payload,
       m.home_team,
       m.away_team,
       m.match_start_at,
       t.tournament_name,
       s.sport_name
     FROM public.match_analysis ma
     JOIN public.analysis_status ast ON ast.analysis_status_id = ma.analysis_status_id
     JOIN public.match_source ms ON ms.match_source_id = ma.match_source_id
     JOIN public.match m ON m.match_id = ms.match_id
     JOIN public.sport s ON s.sport_id = m.sport_id
     LEFT JOIN public.tournament t ON t.tournament_id = m.tournament_id
     LEFT JOIN bet.prediction_card_source pcs ON pcs.match_analysis_id = ma.match_analysis_id
     WHERE ${where.join(' AND ')}
       AND pcs.prediction_card_source_id IS NULL
     ORDER BY ma.analysis_create_at ASC, ma.match_analysis_id ASC
     LIMIT $${params.length}`,
    params,
  );
}

async function insertAnalysisCard(pg, row, dictionaries, { dryRun = false } = {}) {
  const rawBets = Array.isArray(row.recommended_bets) ? row.recommended_bets : [];
  const normalizedBets = rawBets.map((bet, index) => normalizeRecommendedBet(bet, index + 1)).filter(Boolean);
  if (normalizedBets.length === 0) {
    return { match_analysis_id: row.match_analysis_id, skipped: true, reason: 'no_supported_bets' };
  }

  if (dryRun) {
    return { match_analysis_id: row.match_analysis_id, dry_run: true, bets_count: normalizedBets.length };
  }

  const snapshot = {
    match_analysis_id: row.match_analysis_id,
    match_source_id: row.match_source_id,
    analysis_hash: row.analysis_hash,
    analysis_headline: row.analysis_headline,
    analysis_brief: row.analysis_brief,
    analysis_risk_note: row.analysis_risk_note,
    recommended_bets: rawBets,
    model_name: row.model_name,
    prompt_version: row.prompt_version,
    analysis_create_at: row.analysis_create_at,
    match: {
      match_id: row.match_id,
      home_team: row.home_team,
      away_team: row.away_team,
      match_start_at: row.match_start_at,
      tournament_name: row.tournament_name,
      sport_name: row.sport_name,
    },
  };

  const publicationHash = buildPublicationHash({ matchAnalysisId: row.match_analysis_id, analysisHash: row.analysis_hash });
  const [card] = await pg.connection(
    `INSERT INTO bet.prediction_card (
       card_type_id, card_status_id, primary_match_id, primary_match_analysis_id,
       published_at, published_date, edition_no, title, headline, brief, risk_note,
       visibility_scope, publication_hash, snapshot
     ) VALUES ($1,$2,$3,$4,$5,(($5 AT TIME ZONE 'Europe/Moscow')::date),1,$6,$7,$8,$9,'public',$10,$11)
     RETURNING prediction_card_id`,
    [
      dictionaries.cardType.get('daily'),
      dictionaries.cardStatus.get('published'),
      row.match_id,
      row.match_analysis_id,
      row.analysis_create_at || new Date().toISOString(),
      row.analysis_headline,
      row.analysis_headline,
      row.analysis_brief,
      row.analysis_risk_note,
      publicationHash,
      snapshot,
    ],
  );

  await pg.connection(
    `INSERT INTO bet.prediction_card_source (prediction_card_id, match_analysis_id, source_role, ordinal)
     VALUES ($1,$2,'primary',1)`,
    [card.prediction_card_id, row.match_analysis_id],
  );

  const pendingStatusId = dictionaries.settlementStatus.get('pending');
  let createdBets = 0;
  for (const bet of normalizedBets) {
    const [insertedBet] = await pg.connection(
      `INSERT INTO bet.prediction_bet (
         prediction_card_id, kind, ordinal, match_id, match_analysis_id,
         market_type_id, period_id, participant_scope, selection_code, line_value,
         score_home, score_away, market_key, display_label, odds_decimal,
         risk_level_id, confidence, reason, source_payload, selection_snapshot
       ) VALUES ($1,'single',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING prediction_bet_id`,
      [
        card.prediction_card_id,
        bet.ordinal,
        row.match_id,
        row.match_analysis_id,
        dictionaries.marketType.get(bet.market_type_code),
        dictionaries.period.get(bet.period_code),
        bet.participant_scope,
        bet.selection_code,
        bet.line_value,
        bet.score_home,
        bet.score_away,
        bet.market_key,
        bet.display_label,
        bet.odds_decimal,
        bet.risk_level_code ? dictionaries.riskLevel.get(bet.risk_level_code) : null,
        bet.confidence,
        bet.reason,
        bet.source_payload,
        bet.selection_snapshot,
      ],
    );

    await pg.connection(
      `INSERT INTO bet.bet_settlement (prediction_bet_id, settlement_status_id, settlement_result_id, calculated_by, reason_code, reason_text)
       VALUES ($1,$2,NULL,'backfill','awaiting_settlement','Ожидает расчёта результата')`,
      [insertedBet.prediction_bet_id, pendingStatusId],
    );
    createdBets += 1;
  }

  return { match_analysis_id: row.match_analysis_id, prediction_card_id: card.prediction_card_id, bets_count: createdBets };
}

async function backfillPredictionHistory(pg, { limit = 100, dryRun = false, matchAnalysisId = null } = {}) {
  const dictionaries = await loadDictionaries(pg);
  const rows = await loadReadyAnalyses(pg, { limit, matchAnalysisId });
  const results = [];
  for (const row of rows) {
    results.push(await insertAnalysisCard(pg, row, dictionaries, { dryRun }));
  }
  return {
    dry_run: dryRun,
    candidates: rows.length,
    cards_created: results.filter((item) => item.prediction_card_id != null).length,
    bets_created: results.reduce((sum, item) => sum + toNumber(item.bets_count, 0), 0),
    skipped: results.filter((item) => item.skipped).length,
    results,
  };
}

module.exports = {
  normalizeRecommendedBet,
  parseLineValue,
  parseCorrectScore,
  buildPublicationHash,
  backfillPredictionHistory,
  __private: { loadReadyAnalyses, loadDictionaries, insertAnalysisCard },
};
