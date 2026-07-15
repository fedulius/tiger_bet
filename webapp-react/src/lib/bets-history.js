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
    ...(nullableNumber(row.stake_units) != null ? { stake_units: nullableNumber(row.stake_units) } : {}),
    ...(nullableNumber(row.stake) != null ? { stake: nullableNumber(row.stake) } : {}),
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

const STREAK_MARKERS = {
  won: 'В',
  lost: 'П',
  void: '↩',
  pending: '·',
  not_supported: '?',
};

export function getRecentBetStreak(cards = [], limit = 12) {
  const bets = (Array.isArray(cards) ? cards : [])
    .flatMap((card) => Array.isArray(card?.bets) ? card.bets : [])
    .filter((bet) => Object.prototype.hasOwnProperty.call(STREAK_MARKERS, bet?.result_code))
    .slice(0, Math.max(0, limit));

  return bets.map((bet) => ({
    code: bet.result_code,
    marker: STREAK_MARKERS[bet.result_code],
  }));
}

export function getAverageOdds(cards = []) {
  const odds = (Array.isArray(cards) ? cards : [])
    .flatMap((card) => Array.isArray(card?.bets) ? card.bets : [])
    .map((bet) => nullableNumber(bet?.odds_decimal))
    .filter((value) => value != null);

  if (odds.length === 0) return null;
  return odds.reduce((sum, value) => sum + value, 0) / odds.length;
}

const PERIOD_WINDOWS = {
  'Неделя': 7 * 24 * 60 * 60 * 1000,
  'Месяц': 30 * 24 * 60 * 60 * 1000,
};

export function filterHistoryCardsByPeriod(cards = [], period = 'Всё время', now = new Date()) {
  const source = Array.isArray(cards) ? cards : [];
  const window = PERIOD_WINDOWS[period];
  if (!window) return [...source];

  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(end)) return [];
  const start = end - window;

  return source.filter((card) => {
    const timestamps = [card?.published_at, card?.starts_at]
      .map((value) => new Date(value).getTime())
      .filter((timestamp) => Number.isFinite(timestamp));
    return timestamps.some((timestamp) => timestamp >= start && timestamp <= end);
  });
}

export function getHistoryStatsFromCards(cards = []) {
  const stats = (Array.isArray(cards) ? cards : []).reduce((result, card) => {
    result.total_cards += 1;
    result.total_bets += finiteNumber(card?.bets_count, Array.isArray(card?.bets) ? card.bets.length : 0);
    result.won_count += finiteNumber(card?.won_count);
    result.lost_count += finiteNumber(card?.lost_count);
    result.void_count += finiteNumber(card?.void_count);
    result.pending_count += finiteNumber(card?.pending_count);
    result.not_supported_count += finiteNumber(card?.not_supported_count);
    result.profit_units += finiteNumber(card?.profit_units);
    return result;
  }, {
    total_cards: 0,
    total_bets: 0,
    won_count: 0,
    lost_count: 0,
    void_count: 0,
    pending_count: 0,
    not_supported_count: 0,
    profit_units: 0,
  });

  const settled = stats.won_count + stats.lost_count;
  stats.hit_rate_percent = settled > 0 ? (stats.won_count / settled) * 100 : null;
  stats.profit_label = formatProfitUnits(stats.profit_units);
  stats.hit_rate_label = stats.hit_rate_percent == null ? '—' : `${stats.hit_rate_percent.toFixed(2)}%`;
  return stats;
}

function createBetAggregate(key, label) {
  return {
    key,
    label,
    total: 0,
    won: 0,
    lost: 0,
    void: 0,
    pending: 0,
    not_supported: 0,
    profit_units: 0,
    hit_rate_percent: null,
  };
}

function addBetToAggregate(aggregate, bet) {
  const status = getBetStatus(bet);
  aggregate.total += 1;
  if (status === 'won') aggregate.won += 1;
  if (status === 'lost') aggregate.lost += 1;
  if (status === 'void') aggregate.void += 1;
  if (status === 'pending') aggregate.pending += 1;
  if (status === 'not_supported') aggregate.not_supported += 1;
  aggregate.profit_units += finiteNumber(bet?.profit_units ?? bet?.profit_factor);
}

function finalizeBetAggregate(aggregate) {
  aggregate.profit_units = Number(aggregate.profit_units.toFixed(10));
  const settled = aggregate.won + aggregate.lost;
  aggregate.hit_rate_percent = settled > 0 ? (aggregate.won / settled) * 100 : null;
  return aggregate;
}

function aggregateBets(cards, getGroup) {
  const groups = new Map();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    (Array.isArray(card?.bets) ? card.bets : []).forEach((bet) => {
      const group = getGroup(bet);
      if (!groups.has(group.key)) groups.set(group.key, createBetAggregate(group.key, group.label));
      addBetToAggregate(groups.get(group.key), bet);
    });
  });
  return Array.from(groups.values()).map(finalizeBetAggregate);
}

const MARKET_TYPE_LABELS = {
  one_x_two: 'Исход матча',
  double_chance: 'Двойной шанс',
  total_over: 'Тотал матча',
  total_under: 'Тотал матча',
  total: 'Тотал матча',
  match_total: 'Тотал матча',
  team_total: 'Индивидуальный тотал',
  both_to_score: 'Обе забьют',
  correct_score: 'Точный счёт',
  handicap: 'Фора',
  asian_handicap: 'Фора',
};

export function aggregateBetsByMarketType(cards = []) {
  return aggregateBets(cards, (bet) => {
    const marketType = safeText(bet?.market_type).trim();
    const marketName = safeText(bet?.market_name).trim();
    const key = `${marketType}|${marketName}`;
    const normalizedType = marketType.toLowerCase();
    const label = MARKET_TYPE_LABELS[normalizedType] || marketName || marketType || 'Прочее';
    return { key, label };
  });
}

function getBetDirection(bet) {
  const marketType = safeText(bet?.market_type).trim().toLowerCase();
  const marketText = [bet?.market_name, bet?.label].map((value) => safeText(value).toLowerCase()).join(' ');
  if (['one_x_two', 'double_chance'].includes(marketType)) return 'Победа/исходы';
  if (marketType.startsWith('total_') || ['match_total', 'team_total'].includes(marketType) || marketText.includes('тотал') || marketText.includes('total')) return 'Тоталы';
  if (marketType.includes('handicap') || marketText.includes('фора')) return 'Фора';
  if (marketType === 'both_to_score' || marketText.includes('обе забьют')) return 'Обе забьют';
  if (marketType === 'correct_score' || marketText.includes('точный счёт') || marketText.includes('точный счет')) return 'Точный счёт';
  return 'Прочее';
}

export function aggregateBetsByDirection(cards = []) {
  return aggregateBets(cards, (bet) => {
    const label = getBetDirection(bet);
    return { key: label, label };
  });
}

const PROBABILITY_GROUPS = [
  { key: 'low', label: 'Надёжные' },
  { key: 'medium', label: 'Средние' },
  { key: 'high', label: 'Рискованные' },
];

function getProbabilityGroup(bet) {
  const risk = safeText(bet?.risk_level).trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(risk)) return risk;
  const confidence = nullableNumber(bet?.confidence);
  if (confidence != null && confidence >= 70) return 'low';
  if (confidence != null && confidence >= 50) return 'medium';
  return 'high';
}

export function aggregateBetsByProbability(cards = []) {
  const source = aggregateBets(cards, (bet) => {
    const key = getProbabilityGroup(bet);
    return PROBABILITY_GROUPS.find((item) => item.key === key);
  });
  return PROBABILITY_GROUPS
    .map((group) => source.find((item) => item.key === group.key) || createBetAggregate(group.key, group.label))
    .map(finalizeBetAggregate);
}

const REFERENCE_DIRECTION_GROUPS = [
  { key: 'win', label: 'Победа' },
  { key: 'total', label: 'Тотал' },
  { key: 'btts', label: 'Обе забьют' },
  { key: 'handicap', label: 'Фора' },
  { key: 'correct_score', label: 'Точный счёт' },
];

function getReferenceDirection(bet) {
  const marketType = safeText(bet?.market_type).trim().toLowerCase();
  const marketText = [bet?.market_name, bet?.label].map((value) => safeText(value).toLowerCase()).join(' ');
  if (['one_x_two', 'double_chance'].includes(marketType)) return 'win';
  if (marketType.startsWith('total') || marketText.includes('тотал') || marketText.includes('total')) return 'total';
  if (marketType === 'both_to_score' || marketText.includes('обе забьют')) return 'btts';
  if (marketType.includes('handicap') || marketType.includes('фора') || marketText.includes('фора')) return 'handicap';
  if (marketType === 'correct_score' || marketText.includes('точный счёт') || marketText.includes('точный счет')) return 'correct_score';
  return null;
}

export function aggregateBetsByReferenceDirection(cards = []) {
  const source = aggregateBets(cards, (bet) => {
    const key = getReferenceDirection(bet);
    return REFERENCE_DIRECTION_GROUPS.find((item) => item.key === key) || { key: 'other', label: 'Прочее' };
  });
  return [
    ...REFERENCE_DIRECTION_GROUPS
      .map((group) => source.find((item) => item.key === group.key) || createBetAggregate(group.key, group.label))
      .map(finalizeBetAggregate),
    ...source.filter((item) => item.key === 'other'),
  ];
}

export function flattenHistoryBets(cards = []) {
  return (Array.isArray(cards) ? cards : []).flatMap((card) => {
    const date = card?.published_at || card?.starts_at || null;
    return (Array.isArray(card?.bets) ? card.bets : []).map((bet) => ({
      ...bet,
      card_id: card?.id ?? null,
      match: safeText(card?.match, 'Матч'),
      date,
      league: safeText(card?.league),
    }));
  });
}

export function getHistoryRecords(cards = []) {
  return flattenHistoryBets(cards).map((bet, index) => ({
    ...bet,
    id: bet.id || `history-bet:${bet.card_id || 'unknown'}:${index}`,
  }));
}

export function getProfitBuckets(records = []) {
  const dated = (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, timestamp: new Date(record?.date).getTime() }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (dated.length === 0) return [];
  const bucketSize = Math.max(1, Math.ceil(dated.length / 8));
  const buckets = [];
  for (let index = 0; index < dated.length; index += bucketSize) {
    const value = dated.slice(index, index + bucketSize).reduce((sum, item) => sum + finiteNumber(item.record?.profit_units), 0) * 100;
    buckets.push({ label: `W${buckets.length + 1}`, value: Math.round(value) });
  }
  return buckets;
}
