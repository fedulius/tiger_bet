const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendedPick } = require('../../webapp/services/globalRecommendedPickReadService');

test('getRecommendedPick returns latest recommended pick with first bet', async () => {
  const calls = [];
  const pg = {
    async connection(sql, params) {
      calls.push({ sql, params });
      if (/v_prediction_card_history/.test(sql)) {
        return [{
          prediction_card_id: 17,
          card_type_code: 'recommended_pick',
          card_status_code: 'published',
          visibility_scope: 'public',
          match_start_at: '2026-07-21T18:45:00.000Z',
          home_team: 'Клаксвик',
          away_team: 'Кауно Жальгирис',
          tournament_name: 'Лига чемпионов',
          headline: 'Ставка дня: Обе забьют — да',
          brief: 'Brief',
          risk_note: 'низкий риск',
          snapshot: { selected: { match: { sstats_match_id: 1556508 } }, quality: 'strong', warnings: [] },
        }];
      }
      if (/v_prediction_bet_settlements/.test(sql)) {
        return [{
          prediction_bet_id: 101,
          prediction_card_id: 17,
          display_label: 'Обе забьют — да',
          odds_decimal: '1.85',
          risk_level_code: 'low',
          confidence: '80',
          reason: 'Reason',
          result_code: 'pending',
        }];
      }
      return [];
    },
  };

  const payload = await getRecommendedPick({ pg });
  assert.equal(payload.item.prediction_card_id, 17);
  assert.equal(payload.item.match, 'Клаксвик — Кауно Жальгирис');
  assert.equal(payload.item.match_id, 1556508);
  assert.equal(payload.item.bet.label, 'Обе забьют — да');
  assert.equal(payload.item.bet.odds_decimal, 1.85);
  assert.equal(calls[0].params[0], 'recommended_pick');
});

test('getRecommendedPick ignores stale cards from previous Moscow dates', async () => {
  const pg = {
    async connection(sql) {
      if (/v_prediction_card_history/.test(sql)) {
        assert.match(sql, /AT TIME ZONE 'Europe\/Moscow'/);
        return [];
      }
      throw new Error('bets query must not run without today card');
    },
  };

  const payload = await getRecommendedPick({ pg });
  assert.equal(payload.item, null);
  assert.equal(payload.empty_state.title, 'Ставка дня ещё не готова');
});
