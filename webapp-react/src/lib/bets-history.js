const STATUS_PRESENTATIONS = {
  won: { code: 'won', label: 'Зашло', tone: 'success', isLossStyle: false },
  lost: { code: 'lost', label: 'Не зашло', tone: 'danger', isLossStyle: true },
  mixed: { code: 'mixed', label: 'Смешанный результат', tone: 'warning', isLossStyle: false },
  pending: { code: 'pending', label: 'Ждём результат', tone: 'neutral', isLossStyle: false },
  void: { code: 'void', label: 'Возврат', tone: 'neutral', isLossStyle: false },
  not_supported: { code: 'not_supported', label: 'Пока не рассчитываем', tone: 'neutral', isLossStyle: false },
  empty: { code: 'empty', label: 'Нет ставок', tone: 'neutral', isLossStyle: false },
  unknown: { code: 'unknown', label: 'Неизвестно', tone: 'neutral', isLossStyle: false },
};

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeText(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function normalizeStatus(value) {
  const code = safeText(value).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_PRESENTATIONS, code) ? code : 'unknown';
}

export function formatProfitUnits(value) {
  const number = nullableNumber(value);
  if (number == null) return '—';
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

export function getHistoryStatusPresentation(status) {
  const code = normalizeStatus(status);
  return { ...STATUS_PRESENTATIONS[code] };
}

function getBetStatus(row) {
  const explicit = row?.ui_result_code || row?.result_code;
  if (explicit) return normalizeStatus(explicit);
  const settlementStatus = safeText(row?.settlement_status_code ?? row?.settlement_status).toLowerCase();
  if (['won', 'lost', 'mixed', 'pending', 'void', 'not_supported'].includes(settlementStatus)) {
    return settlementStatus;
  }
  const result = safeText(row?.settlement_result_code).toLowerCase();
  if (result === 'win' || result === 'won') return 'won';
  if (result === 'loss' || result === 'lost') return 'lost';
  if (result === 'push' || result === 'void') return 'void';
  if (settlementStatus === 'not_supported') return 'not_supported';
  if (settlementStatus === 'pending') return 'pending';
  return 'unknown';
}

export function mapHistoryBet(row = {}) {
  const statusCode = getBetStatus(row);
  const idValue = row.prediction_bet_id ?? row.id;
  const profitUnits = nullableNumber(row.profit_units ?? row.profit_factor) ?? 0;
  return {
    id: idValue == null ? 'prediction-bet:unknown' : `prediction-bet:${idValue}`,
    prediction_bet_id: nullableNumber(row.prediction_bet_id),
    ordinal: finiteNumber(row.ordinal, 0),
    kind: safeText(row.kind, 'single'),
    market_type: row.market_type_code ?? row.market_type ?? null,
    market_name: row.market_type_name ?? row.market_name ?? null,
    period: row.period_code ?? row.period ?? null,
    label: safeText(row.display_label ?? row.label ?? row.market_key),
    selection_code: row.selection_code ?? null,
    line_value: nullableNumber(row.line_value),
    odds_decimal: nullableNumber(row.odds_decimal),
    risk_level: row.risk_level_code ?? row.risk_level ?? null,
    confidence: nullableNumber(row.confidence),
    reason: safeText(row.reason),
    settlement_status: safeText(row.settlement_status_code ?? row.settlement_status, 'pending'),
    settlement_result: row.settlement_result_code ?? row.settlement_result ?? null,
    status: getHistoryStatusPresentation(statusCode),
    result_code: statusCode,
    result_label: getHistoryStatusPresentation(statusCode).label,
    profit_units: profitUnits,
    profit_label: formatProfitUnits(profitUnits),
    reason_text: safeText(row.reason_text),
  };
}

function deriveCardStatus(row) {
  if (row.result_code) return normalizeStatus(row.result_code);
  const won = finiteNumber(row.won_count);
  const lost = finiteNumber(row.lost_count);
  const pending = finiteNumber(row.pending_count);
  const unsupported = finiteNumber(row.not_supported_count);
  const voidCount = finiteNumber(row.void_count);
  const bets = finiteNumber(row.bets_count);
  if (won > 0 && lost > 0) return 'mixed';
  if (lost > 0) return 'lost';
  if (won > 0 && won === bets) return 'won';
  if (pending > 0) return 'pending';
  if (unsupported > 0) return 'not_supported';
  if (voidCount > 0) return 'void';
  return 'unknown';
}

export function mapHistoryCard(row = {}) {
  const statusCode = deriveCardStatus(row);
  const status = getHistoryStatusPresentation(statusCode);
  const bets = Array.isArray(row.bets) ? row.bets.map(mapHistoryBet) : [];
  const profitUnits = nullableNumber(row.profit_units) ?? 0;
  const hitRate = nullableNumber(row.hit_rate_percent);
  const match = row.match ?? [row.home_team, row.away_team].filter(Boolean).join(' — ');
  return {
    id: row.id ?? (row.prediction_card_id == null ? 'prediction-card:unknown' : `prediction-card:${row.prediction_card_id}`),
    prediction_card_id: nullableNumber(row.prediction_card_id),
    match: safeText(match),
    card_type: row.card_type_code ?? row.card_type ?? null,
    card_status: row.card_status_code ?? row.card_status ?? null,
    published_at: row.published_at ?? null,
    published_date: row.published_date ?? null,
    primary_match_id: nullableNumber(row.primary_match_id),
    starts_at: row.starts_at ?? row.match_start_at ?? null,
    league: safeText(row.league ?? row.tournament_name),
    tournament_name: safeText(row.tournament_name ?? row.league),
    sport_name: safeText(row.sport_name),
    headline: safeText(row.headline ?? row.main_thought),
    main_thought: safeText(row.main_thought ?? row.headline),
    brief: safeText(row.brief),
    risk_note: safeText(row.risk_note),
    bets_count: finiteNumber(row.bets_count, bets.length),
    won_count: finiteNumber(row.won_count),
    lost_count: finiteNumber(row.lost_count),
    void_count: finiteNumber(row.void_count),
    pending_count: finiteNumber(row.pending_count),
    not_supported_count: finiteNumber(row.not_supported_count),
    profit_units: profitUnits,
    profit_label: formatProfitUnits(profitUnits),
    hit_rate_percent: hitRate,
    hit_rate_label: hitRate == null ? '—' : `${hitRate.toFixed(2)}%`,
    status,
    result_code: status.code,
    result_label: status.label,
    bets,
  };
}

export function getHistorySummaryPresentation(summary = {}) {
  const hitRate = nullableNumber(summary.hit_rate_percent);
  return {
    total_cards: finiteNumber(summary.total_cards),
    total_bets: finiteNumber(summary.total_bets),
    won_count: finiteNumber(summary.won_count),
    loss_count: finiteNumber(summary.lost_count),
    lost_count: finiteNumber(summary.lost_count),
    void_count: finiteNumber(summary.void_count),
    pending_count: finiteNumber(summary.pending_count),
    not_supported_count: finiteNumber(summary.not_supported_count),
    profit_units: nullableNumber(summary.profit_units) ?? 0,
    profit_label: formatProfitUnits(summary.profit_units),
    hit_rate_percent: hitRate,
    hit_rate_label: hitRate == null ? '—' : `${hitRate.toFixed(2)}%`,
  };
}

export function hasNextHistoryPage(pagination = {}) {
  const total = finiteNumber(pagination?.total_cards, 0);
  const offset = finiteNumber(pagination?.offset, 0);
  const returned = finiteNumber(pagination?.returned, 0);
  return total > 0 && offset + returned < total;
}
