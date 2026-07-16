'use strict';

const { FALLBACK_TOP_MATCHES } = require('./recommendationService');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getEmptyHistoryPayload() {
  return {
    items: [],
    pagination: { limit: DEFAULT_LIMIT, offset: 0, returned: 0, total_cards: 0 },
    summary: {
      total_cards: 0,
      total_bets: 0,
      won_count: 0,
      lost_count: 0,
      void_count: 0,
      pending_count: 0,
      not_supported_count: 0,
      profit_units: 0,
      hit_rate_percent: null,
    },
    empty_state: {
      message: 'Здесь появятся ваши последние прогнозы',
      cta: {
        label: 'Открыть рекомендации',
        target: '#recommendations',
      },
    },
    updated_at: new Date().toISOString(),
  };
}

function getSampleHistoryPayload() {
  return {
    items: [
      {
        id: 'history-1',
        match: 'Arsenal vs Chelsea',
        league: 'Premier League',
        starts_at: '2026-04-22T17:30:00.000Z',
        main_thought: 'Победа Arsenal',
        confidence: 68,
      },
    ],
    pagination: { limit: 1, offset: 0, returned: 1, total_cards: 1 },
    summary: {
      total_cards: 1,
      total_bets: 1,
      won_count: 0,
      lost_count: 0,
      void_count: 0,
      pending_count: 1,
      not_supported_count: 0,
      profit_units: 0,
      hit_rate_percent: null,
    },
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

function buildUserHistoryPayload(favoriteSports = []) {
  const ids = new Set((Array.isArray(favoriteSports) ? favoriteSports : [])
    .map((item) => Number(item?.sport_id))
    .filter(Number.isFinite));

  const items = FALLBACK_TOP_MATCHES
    .filter((item) => ids.has(Number(item.sport_id)))
    .slice(0, 3)
    .map((item, index) => ({
      id: `history-${item.id || index + 1}`,
      match: item.match,
      league: item.league,
      starts_at: item.starts_at,
      main_thought: item.main_thought,
      confidence: Number(item.confidence) || 0,
    }));

  if (items.length === 0) {
    return getEmptyHistoryPayload();
  }

  return {
    items,
    pagination: { limit: items.length, offset: 0, returned: items.length, total_cards: items.length },
    summary: {
      total_cards: items.length,
      total_bets: items.length,
      won_count: 0,
      lost_count: 0,
      void_count: 0,
      pending_count: items.length,
      not_supported_count: 0,
      profit_units: 0,
      hit_rate_percent: null,
    },
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

function normalizeLimit(limit) {
  const parsed = Number(limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function getCardResult({ wonCount, lostCount, voidCount, pendingCount, notSupportedCount, betsCount }) {
  if (betsCount <= 0) return { result_code: 'empty', result_label: 'Нет ставок' };
  if (lostCount > 0 && wonCount > 0) return { result_code: 'mixed', result_label: `${wonCount} из ${betsCount}` };
  if (lostCount > 0) return { result_code: 'lost', result_label: 'Не зашло' };
  if (wonCount > 0 && wonCount === betsCount) return { result_code: 'won', result_label: 'Зашло' };
  if (wonCount > 0) return { result_code: 'mixed', result_label: `${wonCount} из ${betsCount}` };
  if (pendingCount > 0) return { result_code: 'pending', result_label: 'Ждём результат' };
  if (notSupportedCount > 0) return { result_code: 'not_supported', result_label: 'Пока не рассчитываем' };
  if (voidCount > 0) return { result_code: 'void', result_label: 'Возврат' };
  return { result_code: 'unknown', result_label: 'Неизвестно' };
}

function mapBetRow(row) {
  return {
    id: `prediction-bet:${row.prediction_bet_id}`,
    prediction_bet_id: toNumber(row.prediction_bet_id, null),
    ordinal: toNumber(row.ordinal, 0),
    kind: row.kind || 'single',
    market_type: row.market_type_code || null,
    market_name: row.market_type_name || null,
    period: row.period_code || null,
    label: row.display_label || row.market_key || '',
    selection_code: row.selection_code || null,
    line_value: row.line_value == null ? null : toNumber(row.line_value, null),
    odds_decimal: row.odds_decimal == null ? null : toNumber(row.odds_decimal, null),
    risk_level: row.risk_level_code || null,
    confidence: row.confidence == null ? null : toNumber(row.confidence, null),
    reason: row.reason || '',
    settlement_status: row.settlement_status_code || 'pending',
    settlement_result: row.settlement_result_code || null,
    result_code: row.ui_result_code || 'pending',
    result_label: row.ui_result_label || 'Ждём результат',
    profit_factor: row.profit_factor == null ? null : toNumber(row.profit_factor, null),
    reason_text: row.reason_text || '',
  };
}

function buildSummary(items, totalCards = items.length) {
  const base = {
    total_cards: totalCards,
    total_bets: 0,
    won_count: 0,
    lost_count: 0,
    void_count: 0,
    pending_count: 0,
    not_supported_count: 0,
    profit_units: 0,
    hit_rate_percent: null,
  };

  for (const item of items) {
    base.total_bets += toNumber(item.bets_count, 0);
    base.won_count += toNumber(item.won_count, 0);
    base.lost_count += toNumber(item.lost_count, 0);
    base.void_count += toNumber(item.void_count, 0);
    base.pending_count += toNumber(item.pending_count, 0);
    base.not_supported_count += toNumber(item.not_supported_count, 0);
    base.profit_units += toNumber(item.profit_units, 0);
  }

  base.profit_units = Number(base.profit_units.toFixed(6));
  const settled = base.won_count + base.lost_count;
  base.hit_rate_percent = settled > 0 ? Number(((base.won_count / settled) * 100).toFixed(2)) : null;
  return base;
}

async function loadPredictionHistory(pg, { visibilityScope = 'public', limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  const safeLimit = normalizeLimit(limit);
  const safeOffset = Math.max(0, Math.trunc(toNumber(offset, 0)));

  const [totalRow] = await pg.connection(
    `SELECT
       COUNT(*) AS total_cards,
       COALESCE(SUM(bets_count), 0) AS total_bets,
       COALESCE(SUM(won_count), 0) AS won_count,
       COALESCE(SUM(lost_count), 0) AS lost_count,
       COALESCE(SUM(void_count), 0) AS void_count,
       COALESCE(SUM(pending_count), 0) AS pending_count,
       COALESCE(SUM(not_supported_count), 0) AS not_supported_count,
       COALESCE(SUM(profit_units), 0) AS profit_units
     FROM bet.v_prediction_card_history
     WHERE card_status_code = 'published'
       AND visibility_scope = $1`,
    [visibilityScope],
  );
  const totalCards = toNumber(totalRow?.total_cards, 0);

  const pageCardRows = await pg.connection(
    `SELECT *
     FROM bet.v_prediction_card_history
     WHERE card_status_code = 'published'
       AND visibility_scope = $1
     ORDER BY published_at DESC, prediction_card_id DESC
     LIMIT $2 OFFSET $3`,
    [visibilityScope, safeLimit, safeOffset],
  );

  if (!Array.isArray(pageCardRows) || pageCardRows.length === 0) {
    const emptyPayload = getEmptyHistoryPayload();
    const summary = {
      ...emptyPayload.summary,
      total_cards: totalCards,
      total_bets: toNumber(totalRow?.total_bets, 0),
      won_count: toNumber(totalRow?.won_count, 0),
      lost_count: toNumber(totalRow?.lost_count, 0),
      void_count: toNumber(totalRow?.void_count, 0),
      pending_count: toNumber(totalRow?.pending_count, 0),
      not_supported_count: toNumber(totalRow?.not_supported_count, 0),
      profit_units: Number(toNumber(totalRow?.profit_units, 0).toFixed(6)),
    };
    const settled = summary.won_count + summary.lost_count;
    summary.hit_rate_percent = settled > 0 ? Number(((summary.won_count / settled) * 100).toFixed(2)) : null;
    return {
      ...emptyPayload,
      pagination: { limit: safeLimit, offset: safeOffset, returned: 0, total_cards: totalCards },
      summary,
      empty_state: totalCards > 0 ? null : emptyPayload.empty_state,
    };
  }

  const pageMatchIds = [...new Set(pageCardRows
    .map((row) => toNumber(row.primary_match_id, null))
    .filter((id) => id != null))];
  const siblingCardRows = pageMatchIds.length > 0
    ? await pg.connection(
      `SELECT *
       FROM bet.v_prediction_card_history
       WHERE card_status_code = 'published'
         AND visibility_scope = $1
         AND primary_match_id = ANY($2::bigint[])
       ORDER BY published_at DESC, prediction_card_id DESC`,
      [visibilityScope, pageMatchIds],
    )
    : [];
  const cardRowsById = new Map();
  for (const row of [...pageCardRows, ...(Array.isArray(siblingCardRows) ? siblingCardRows : [])]) {
    const cardId = toNumber(row.prediction_card_id, null);
    if (cardId != null && !cardRowsById.has(cardId)) cardRowsById.set(cardId, row);
  }
  const cardRows = Array.from(cardRowsById.values());
  const cardIds = cardRows.map((row) => toNumber(row.prediction_card_id, null)).filter((id) => id != null);
  const betRows = cardIds.length > 0
    ? await pg.connection(
      `SELECT *
       FROM bet.v_prediction_bet_settlements
       WHERE prediction_card_id = ANY($1::bigint[])
       ORDER BY prediction_card_id DESC, ordinal ASC, prediction_bet_id ASC`,
      [cardIds],
    )
    : [];

  const betsByCard = new Map();
  for (const row of Array.isArray(betRows) ? betRows : []) {
    const cardId = toNumber(row.prediction_card_id, null);
    if (cardId == null) continue;
    if (!betsByCard.has(cardId)) betsByCard.set(cardId, []);
    betsByCard.get(cardId).push(mapBetRow(row));
  }

  const items = cardRows.map((row) => {
    const cardId = toNumber(row.prediction_card_id, null);
    const betsCount = toNumber(row.bets_count, 0);
    const wonCount = toNumber(row.won_count, 0);
    const lostCount = toNumber(row.lost_count, 0);
    const voidCount = toNumber(row.void_count, 0);
    const pendingCount = toNumber(row.pending_count, 0);
    const notSupportedCount = toNumber(row.not_supported_count, 0);
    const result = getCardResult({ wonCount, lostCount, voidCount, pendingCount, notSupportedCount, betsCount });

    return {
      id: `prediction-card:${row.prediction_card_id}`,
      prediction_card_id: cardId,
      card_type: row.card_type_code || null,
      card_status: row.card_status_code || null,
      published_at: row.published_at || null,
      published_date: row.published_date || null,
      primary_match_id: row.primary_match_id == null ? null : toNumber(row.primary_match_id, null),
      match: [row.home_team, row.away_team].filter(Boolean).join(' — '),
      tournament_name: row.tournament_name || '',
      league: row.tournament_name || '',
      sport_name: row.sport_name || row.snapshot?.match?.sport_name || row.snapshot?.sport_name || '',
      starts_at: row.match_start_at || null,
      main_thought: row.headline || row.title || '',
      headline: row.headline || row.title || '',
      brief: row.snapshot?.analysis_brief || row.snapshot?.brief || '',
      risk_note: row.snapshot?.analysis_risk_note || row.snapshot?.risk_note || '',
      bets_count: betsCount,
      won_count: wonCount,
      lost_count: lostCount,
      void_count: voidCount,
      pending_count: pendingCount,
      not_supported_count: notSupportedCount,
      profit_units: toNumber(row.profit_units, 0),
      hit_rate_percent: row.hit_rate_percent == null ? null : toNumber(row.hit_rate_percent, null),
      result_code: result.result_code,
      result_label: result.result_label,
      bets: betsByCard.get(cardId) || [],
    };
  });

  const summary = buildSummary(items, totalCards);
  summary.total_bets = toNumber(totalRow?.total_bets, summary.total_bets);
  summary.won_count = toNumber(totalRow?.won_count, summary.won_count);
  summary.lost_count = toNumber(totalRow?.lost_count, summary.lost_count);
  summary.void_count = toNumber(totalRow?.void_count, summary.void_count);
  summary.pending_count = toNumber(totalRow?.pending_count, summary.pending_count);
  summary.not_supported_count = toNumber(totalRow?.not_supported_count, summary.not_supported_count);
  summary.profit_units = Number(toNumber(totalRow?.profit_units, summary.profit_units).toFixed(6));
  const settled = summary.won_count + summary.lost_count;
  summary.hit_rate_percent = settled > 0 ? Number(((summary.won_count / settled) * 100).toFixed(2)) : null;

  return {
    items,
    pagination: { limit: safeLimit, offset: safeOffset, returned: pageCardRows.length, total_cards: totalCards },
    summary,
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

function getHistory({ pg = null, sample = false, favoriteSports = [], limit, offset } = {}) {
  if (sample) {
    return getSampleHistoryPayload();
  }

  if (pg && typeof pg.connection === 'function') {
    return loadPredictionHistory(pg, { limit, offset }).then((history) => {
      if (Array.isArray(history.items) && history.items.length > 0) {
        return history;
      }

      if (toNumber(history?.pagination?.total_cards, 0) > 0) {
        return history;
      }

      if (Array.isArray(favoriteSports) && favoriteSports.length > 0) {
        return buildUserHistoryPayload(favoriteSports);
      }

      return getEmptyHistoryPayload();
    });
  }

  if (Array.isArray(favoriteSports) && favoriteSports.length > 0) {
    return buildUserHistoryPayload(favoriteSports);
  }

  return getEmptyHistoryPayload();
}

module.exports = {
  getHistory,
  loadPredictionHistory,
  __private: {
    getCardResult,
    mapBetRow,
    buildSummary,
    normalizeLimit,
  },
};
