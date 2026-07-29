'use strict';

const CARD_TYPE_CODE = 'recommended_pick';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function emptyPayload() {
  return {
    item: null,
    empty_state: {
      title: 'Ставка дня ещё не готова',
      description: 'Мы обновляем рекомендацию утром в 06:00 МСК.',
    },
    updated_at: new Date().toISOString(),
  };
}

function formatMatch(row) {
  return `${row.home_team || 'Команда 1'} — ${row.away_team || 'Команда 2'}`;
}

async function getRecommendedPick({ pg, cardTypeCode = CARD_TYPE_CODE } = {}) {
  if (!pg) throw new Error('pg is required');
  const [card] = await pg.connection(
    `SELECT prediction_card_id,
            card_type_code,
            card_status_code,
            visibility_scope,
            published_at,
            primary_match_id,
            pm.system_match_id AS sstats_match_id,
            match_start_at,
            home_team,
            away_team,
            tournament_name,
            headline,
            brief,
            risk_note,
            snapshot
     FROM bet.v_prediction_card_history card_history
     LEFT JOIN external.public_match pm
       ON pm.match_id = card_history.primary_match_id AND pm.system_id = 3
     WHERE card_type_code = $1
       AND card_status_code = 'published'
       AND visibility_scope = 'public'
       AND (match_start_at AT TIME ZONE 'Europe/Moscow')::date = (now() AT TIME ZONE 'Europe/Moscow')::date
     ORDER BY published_at DESC, prediction_card_id DESC
     LIMIT 1`,
    [cardTypeCode],
  );

  if (!card) return emptyPayload();

  const [bet] = await pg.connection(
    `SELECT prediction_bet_id,
            prediction_card_id,
            display_label,
            odds_decimal,
            risk_level_code,
            risk_level_name,
            confidence,
            reason,
            settlement_result_code AS result_code,
            settlement_status_code,
            ui_result_code,
            ui_result_label
     FROM bet.v_prediction_bet_settlements
     WHERE prediction_card_id = $1
     ORDER BY ordinal ASC, prediction_bet_id ASC
     LIMIT 1`,
    [card.prediction_card_id],
  );

  return {
    item: {
      prediction_card_id: card.prediction_card_id,
      card_type_code: card.card_type_code,
      match_id: toNumber(card.sstats_match_id)
        || toNumber(card.snapshot?.selected?.match?.sstats_match_id)
        || toNumber(card.snapshot?.sstats_data?.fixture_id)
        || null,
      match: formatMatch(card),
      league: card.tournament_name || '',
      starts_at: card.match_start_at,
      headline: card.headline || 'Ставка дня',
      brief: card.brief || '',
      risk_note: card.risk_note || '',
      quality: card.snapshot?.selected?.quality || card.snapshot?.quality || null,
      warnings: card.snapshot?.selected?.warnings || card.snapshot?.warnings || [],
      bet: bet ? {
        prediction_bet_id: bet.prediction_bet_id,
        label: bet.display_label,
        odds_decimal: toNumber(bet.odds_decimal),
        risk_level: bet.risk_level_code,
        risk_label: bet.risk_level_name,
        confidence: toNumber(bet.confidence),
        reason: bet.reason || '',
        result_code: bet.result_code || bet.ui_result_code || bet.settlement_status_code || null,
        result_label: bet.ui_result_label || '',
      } : null,
    },
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  getRecommendedPick,
  __private: { emptyPayload, formatMatch, toNumber },
};
