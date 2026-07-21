const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../../webapp/services/globalRecommendedPickService');

const NOW = new Date('2026-07-21T09:00:00+03:00');

function candidate(overrides = {}) {
  return {
    id: 'm1',
    match_id: 'm1',
    sport_slug: 'football',
    starts_at: '2026-07-21T18:00:00+03:00',
    status: 'scheduled',
    league_label: 'Лига чемпионов',
    home_team: 'Team A',
    away_team: 'Team B',
    odds: {
      one_x_two: { w1: 1.9, x: 3.2, w2: 2.2 },
      both_to_score: { yes: 1.82, no: 1.95 },
      totals: [{ line: 2.5, over: 1.88, under: 1.92 }],
    },
    analytics_features: {
      coverage: { home_team_stats: true, away_team_stats: true, home_recent_form: true, away_recent_form: true },
      home: { form_points_per_game: 2.1, avg_scored: 1.9, avg_conceded: 0.9, xg_for: 1.8, xg_against: 0.8 },
      away: { form_points_per_game: 1.2, avg_scored: 1.2, avg_conceded: 1.6, xg_for: 1.1, xg_against: 1.6 },
    },
    ...overrides,
  };
}

test('exports global recommended pick service functions', () => {
  assert.equal(typeof service.selectGlobalRecommendedPick, 'function');
  assert.equal(typeof service.runGlobalRecommendedPick, 'function');
});

test('filters only prematch football candidates for today Moscow with odds', () => {
  const matches = [
    candidate({ id: 'good' }),
    candidate({ id: 'basket', sport_slug: 'basketball' }),
    candidate({ id: 'tomorrow', starts_at: '2026-07-22T18:00:00+03:00' }),
    candidate({ id: 'started', starts_at: '2026-07-21T08:00:00+03:00' }),
    candidate({ id: 'live', status: 'live' }),
    candidate({ id: 'no-odds', odds: null }),
  ];

  const filtered = service.filterGlobalFootballCandidates(matches, { now: NOW });
  assert.deepEqual(filtered.map((item) => item.id), ['good']);
});

test('excludes minor leagues and allows major football leagues', () => {
  assert.equal(service.isMeaningfulFootballLeague(candidate({ league_label: 'Лига чемпионов' })), true);
  assert.equal(service.isMeaningfulFootballLeague(candidate({ league_label: 'Молодежная лига округа' })), false);
});

test('normalizes odds-only analytical bet candidates', () => {
  const bets = service.collectEligibleBets(candidate({
    odds: {
      one_x_two: { w1: 1.72, x: 3.2, w2: 2.4 },
      both_to_score: { yes: 1.83, no: 1.98 },
      totals: [{ line: 2.5, over: 1.88, under: 1.92 }],
    },
    popular_bets: [
      { type: 'correct_score', label: '2:1 со Ставки', rate: 2.0, risk: 'low' },
    ],
  }));

  assert.deepEqual(bets.map((bet) => bet.market), ['one_x_two', 'both_to_score', 'total']);
  assert.ok(bets.every((bet) => bet.source === 'analytics_odds'));
  assert.ok(!bets.some((bet) => bet.label.includes('Ставки')));
});

test('runGlobalRecommendedPick uses LLM selector as forecast maker and keeps runtime as validator', async () => {
  let calls = 0;
  const result = await service.runGlobalRecommendedPick({
    dryRun: true,
    now: NOW,
    matches: [candidate({ id: 'llm-match' })],
    llmSelector: async ({ candidates }) => {
      calls += 1;
      assert.equal(candidates.length, 1);
      return {
        match_id: 'llm-match',
        market: 'both_to_score',
        selection_code: 'yes',
        label: 'Обе забьют — да',
        odds_decimal: 1.82,
        confidence: 74,
        risk: 'medium',
        headline: 'Обе команды выглядят достаточно активными впереди',
        brief: 'LLM выбрал рынок обе забьют на основе SStats и доступного коэффициента.',
        risk_note: 'Основной риск — ограниченность свежей формы в payload.',
        reason: 'Обе команды имеют атакующий профиль, а коэффициент 1.82 есть в Stavka odds.',
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.selected.match.id, 'llm-match');
  assert.equal(result.selected.selectedBet.market, 'both_to_score');
  assert.equal(result.selected.selectedBet.source, 'llm_forecast');
  assert.equal(result.selected.selectedBet.label, 'Обе забьют — да');
});

test('runGlobalRecommendedPick rejects invalid LLM-selected odds instead of falling back to code-made forecast', async () => {
  const result = await service.runGlobalRecommendedPick({
    dryRun: true,
    now: NOW,
    matches: [candidate({ id: 'invalid-llm' })],
    llmSelector: async () => ({
      match_id: 'invalid-llm',
      market: 'both_to_score',
      selection_code: 'yes',
      label: 'Обе забьют — да',
      odds_decimal: 1.77,
      confidence: 74,
      risk: 'medium',
      reason: 'bad odds',
    }),
  });

  assert.equal(result.selected, null);
  assert.equal(result.reason, 'llm_selection_invalid');
});

test('selects one best eligible analytical bet and marks weak fallback with warning', () => {
  const selected = service.selectGlobalRecommendedPick([
    candidate({ id: 'a', odds: { one_x_two: { w1: 2.15 } } }),
    candidate({ id: 'b', starts_at: '2026-07-21T16:00:00+03:00', odds: { both_to_score: { yes: 1.82 } } }),
  ], { now: NOW });

  assert.equal(selected.match.id, 'b');
  assert.equal(selected.selectedBet.market, 'both_to_score');
  assert.equal(selected.quality, 'strong');

  const weak = service.selectGlobalRecommendedPick([
    candidate({
      id: 'weak',
      league_label: 'Лига чемпионов',
      odds: { handicap: { home: { '-1.5': 2.28 } } },
      analytics_features: {
        coverage: {},
        home: { form_points_per_game: 1.8, avg_scored: 1.7, xg_for: 1.5 },
        away: { form_points_per_game: 0.8, avg_scored: 0.9, xg_for: 0.8 },
      },
    }),
  ], { now: NOW });

  assert.equal(weak.quality, 'low_confidence');
  assert.ok(weak.warnings.some((warning) => warning.includes('сильной ставки')));
});
