const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../../webapp/services/globalRecommendedPickService');
const { normalizeRecommendedBet } = require('../../webapp/services/predictionHistoryBackfillService');

const NOW = new Date('2026-07-21T09:00:00+03:00');

function candidate(overrides = {}) {
  return {
    id: 'm1',
    match_id: overrides.match_id || overrides.id || 'm1',
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

function llmSelection(overrides = {}) {
  return {
    match_id: 'llm-match',
    odds_id: 'llm-match|both_to_score|yes|match|none',
    estimated_probability: 0.61,
    confidence: 74,
    risk: 'medium',
    quality: 'strong',
    warning: null,
    headline: 'Обе команды выглядят достаточно активными впереди',
    brief: 'LLM выбрал рынок обе забьют на основе SStats и доступного коэффициента.',
    risk_note: 'Основной риск — ограниченность свежей формы в payload.',
    reason: 'Обе команды имеют атакующий профиль.',
    evidence: [
      { path: 'analytics_features.home.avg_scored', value: 1.9, interpretation: 'Хозяева регулярно забивают.' },
      { path: 'analytics_features.away.avg_scored', value: 1.2, interpretation: 'Гости тоже способны забить.' },
    ],
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
      return llmSelection();
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

test('builds deterministic odds ids and server assembles the selected Stavka odd with edge', async () => {
  const raw = candidate({ id: 'llm-match' });
  const payload = service.__private.buildLlmCandidatePayload(raw);
  const odd = payload.available_odds.find((item) => item.market === 'both_to_score' && item.selection_code === 'yes');
  assert.deepEqual(odd, {
    odds_id: 'llm-match|both_to_score|yes|match|none',
    market: 'both_to_score',
    selection_code: 'yes',
    participant_scope: 'match',
    line: 'none',
    label: 'Обе забьют — да',
    odds_decimal: 1.82,
    implied_probability: 1 / 1.82,
  });

  const result = await service.__private.selectGlobalRecommendedPickWithLlm([raw], {
    now: NOW,
    llmSelector: async () => llmSelection(),
  });
  assert.equal(result.selected.selectedBet.market, 'both_to_score');
  assert.equal(result.selected.selectedBet.selection_code, 'yes');
  assert.equal(result.selected.selectedBet.odds_decimal, 1.82);
  assert.equal(result.selected.selectedBet.implied_probability, 1 / 1.82);
  assert.equal(result.selected.selectedBet.estimated_edge_pp, 6.05);
});

test('v2 selector sends strict JSON schema and exact odds allowlist to the LLM provider', async () => {
  const raw = candidate({ id: 'llm-match' });
  let request = null;
  const selection = await service.__private.defaultLlmSelector({
    candidates: [raw],
    now: NOW,
    provider: async (input) => {
      request = input;
      return { text: JSON.stringify(llmSelection()) };
    },
  });

  assert.deepEqual(selection, llmSelection());
  assert.match(request.userPrompt, /VALID_ODDS_ID_ALLOWLIST/);
  assert.match(request.userPrompt, /llm-match\|both_to_score\|yes\|match\|none/);
  assert.deepEqual(request.responseFormat, {
    type: 'json_schema',
    json_schema: {
      name: 'global_recommended_pick_v2',
      strict: true,
      schema: request.responseFormat.json_schema.schema,
    },
  });
  const schema = request.responseFormat.json_schema.schema;
  assert.deepEqual(schema.required, ['match_id', 'odds_id', 'estimated_probability', 'confidence', 'risk', 'quality', 'warning', 'headline', 'brief', 'risk_note', 'reason', 'evidence']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.warning.type, ['string', 'null']);
  assert.equal(schema.properties.evidence.minItems, 2);
  assert.equal(schema.properties.evidence.maxItems, 5);
  assert.equal(schema.properties.evidence.items.additionalProperties, false);
  assert.deepEqual(schema.properties.odds_id.enum, ['llm-match|one_x_two|home|match|none', 'llm-match|one_x_two|away|match|none', 'llm-match|both_to_score|yes|match|none', 'llm-match|both_to_score|no|match|none', 'llm-match|total|over|match|2.5', 'llm-match|total|under|match|2.5']);
  assert.equal(Object.hasOwn(schema.properties, 'odds_decimal'), false);
  assert.equal(Object.hasOwn(schema.properties, 'market'), false);
});

test('strictly rejects extra fields, invalid quality-warning coupling, and evidence not backed by payload scalar', () => {
  const raw = candidate({ id: 'llm-match' });
  assert.equal(service.__private.validateLlmSelection(llmSelection({ market: 'both_to_score' }), [raw]), null);
  assert.equal(service.__private.validateLlmSelection(llmSelection({ warning: 'warning is forbidden for strong' }), [raw]), null);
  assert.equal(service.__private.validateLlmSelection(llmSelection({ evidence: [{ path: 'analytics_features.home', value: 1.9, interpretation: 'not scalar' }, llmSelection().evidence[1]] }), [raw]), null);
});

test('retries once with concrete validation errors and exposes v2 data quality coverage', async () => {
  const raw = candidate({ id: 'llm-match' });
  const attempts = [];
  const result = await service.__private.selectGlobalRecommendedPickWithLlm([raw], {
    now: NOW,
    llmSelector: async (input) => {
      attempts.push(input);
      return attempts.length === 1 ? llmSelection({ market: 'both_to_score' }) : llmSelection();
    },
  });
  assert.equal(result.selected.selectedBet.source, 'llm_forecast');
  assert.equal(attempts.length, 2);
  assert.match(attempts[1].validationError, /unexpected field: market/);
  assert.deepEqual(attempts[0].candidates[0].data_quality, {
    team_stats: 'complete',
    recent_form: 'complete',
    lineups: 'missing',
    h2h: 'missing',
    ratings: 'missing',
    overall_coverage: 0.4,
  });
});

test('builds data quality from explicit coverage and lineup source states', () => {
  const cases = [
    {
      name: 'both team sources are complete and confirmed lineup maps explicitly',
      coverage: {
        home_team_stats: true, away_team_stats: true,
        home_recent_form: true, away_recent_form: true,
        home_h2h: true, away_h2h: true,
        home_ratings: true, away_ratings: true,
      },
      lineups: { status: 'confirmed' },
      expected: { team_stats: 'complete', recent_form: 'complete', h2h: 'complete', ratings: 'complete', lineups: 'confirmed', overall_coverage: 1 },
    },
    {
      name: 'one team source is partial and probable lineup maps explicitly',
      coverage: { home_team_stats: true, away_recent_form: true, h2h_available: true, glicko_available: true },
      lineups: { status: 'probable' },
      expected: { team_stats: 'partial', recent_form: 'partial', h2h: 'complete', ratings: 'complete', lineups: 'probable', overall_coverage: 0.7 },
    },
    {
      name: 'unknown coverage and unrecognized lineup input are missing rather than sports facts',
      coverage: {},
      lineups: { status: 'rumoured' },
      expected: { team_stats: 'missing', recent_form: 'missing', h2h: 'missing', ratings: 'missing', lineups: 'missing', overall_coverage: 0 },
    },
    {
      name: 'known not announced raw lineup state is preserved',
      coverage: {},
      lineups: { status: 'not announced' },
      expected: { team_stats: 'missing', recent_form: 'missing', h2h: 'missing', ratings: 'missing', lineups: 'not_announced', overall_coverage: 0 },
    },
  ];

  for (const row of cases) {
    const payload = service.__private.buildLlmCandidatePayload(candidate({
      analytics_features: { coverage: row.coverage },
      sstats_data: { lineups: row.lineups },
    }));
    assert.deepEqual(payload.data_quality, row.expected, row.name);
  }
});

test('retries after null first output and retains bounded source contract trace', async () => {
  const raw = candidate({ id: 'llm-match' });
  const attempts = [];
  const result = await service.__private.selectGlobalRecommendedPickWithLlm([raw], {
    now: NOW,
    llmSelector: async (input) => {
      attempts.push(input);
      return attempts.length === 1 ? null : llmSelection();
    },
  });

  assert.equal(attempts.length, 2);
  assert.match(attempts[1].validationError, /response must be a JSON object/);
  assert.equal(result.selected.selectedBet.source, 'llm_forecast');
  assert.equal(result.selected.llm.trace.first_output, null);
  assert.deepEqual(result.selected.llm.trace.retry_output, llmSelection());
  assert.deepEqual(result.selected.llm.trace.validation_errors, ['response must be a JSON object']);
  const source = service.__private.buildSourcePayload(result.selected);
  assert.equal(source.source_contract, 'sstats_analytics_plus_stavka_odds_v2');
  assert.equal(source.llm_trace.prompt_version, 'global-recommended-pick-llm-v2');
});

test('returns no pick after a thrown first attempt and null retry without code fallback', async () => {
  const attempts = [];
  const result = await service.__private.selectGlobalRecommendedPickWithLlm([candidate({ id: 'llm-match' })], {
    now: NOW,
    llmSelector: async (input) => {
      attempts.push(input);
      if (attempts.length === 1) throw new Error('provider unavailable');
      return null;
    },
  });

  assert.equal(attempts.length, 2);
  assert.match(attempts[1].validationError, /selector error: provider unavailable/);
  assert.equal(result.selected, null);
  assert.equal(result.reason, 'llm_selection_invalid');
  assert.equal(result.llm_trace.first_output, null);
  assert.equal(result.llm_trace.retry_output, null);
  assert.deepEqual(result.llm_trace.validation_errors, ['selector error: provider unavailable', 'response must be a JSON object']);
});

test('maps actual analytics feature producer lineup and global coverage flags honestly', () => {
  const payload = service.__private.buildLlmCandidatePayload(candidate({
    analytics_features: {
      coverage: {
        home_team_stats: true,
        away_team_stats: true,
        home_recent_form: true,
        away_recent_form: true,
        lineups_known: true,
        h2h_available: true,
        glicko_available: true,
      },
      lineup: { status: 'known', home_starting_xi_count: 11, away_starting_xi_count: 11 },
    },
    sstats_data: { lineups: { home_xi: [{ id: 1 }], away_xi: [{ id: 2 }] } },
  }));

  assert.deepEqual(payload.data_quality, {
    team_stats: 'complete',
    recent_form: 'complete',
    lineups: 'confirmed',
    h2h: 'complete',
    ratings: 'complete',
    overall_coverage: 1,
  });
});

test('builds LLM selected bets accepted by prediction history normalizer for supported markets', async () => {
  const raw = candidate({
    id: 'llm-match',
    odds: {
      both_to_score: { yes: 1.82 },
      totals: [{ line: 2.5, over: 1.88, under: 1.92 }],
      handicap: { home: { '-1.5': 2.05 }, away: { '+1.5': 1.9 } },
    },
  });
  const odds = service.__private.buildLlmCandidatePayload(raw).available_odds;
  const variants = [
    ['both_to_score', 'yes', 'match', 'none'],
    ['total', 'over', 'match', '2.5'],
    ['total', 'under', 'match', '2.5'],
    ['handicap', 'home', 'home', '-1.5'],
    ['handicap', 'away', 'away', '1.5'],
  ];

  for (const [market, outcome, scope, line] of variants) {
    const oddsId = `llm-match|${market}|${outcome}|${scope}|${line}`;
    assert.ok(odds.some((item) => item.odds_id === oddsId), oddsId);
    const result = await service.__private.selectGlobalRecommendedPickWithLlm([raw], {
      now: NOW,
      llmSelector: async () => llmSelection({ odds_id: oddsId }),
    });
    const normalized = normalizeRecommendedBet(result.selected.selectedBet);
    assert.ok(normalized, `${oddsId} must normalize`);
  }
});

test('bounds persisted LLM text and trace selection output', async () => {
  const oversized = 'x'.repeat(5000);
  const result = await service.__private.selectGlobalRecommendedPickWithLlm([candidate({ id: 'llm-match' })], {
    now: NOW,
    llmSelector: async () => llmSelection({
      headline: oversized,
      brief: oversized,
      risk_note: oversized,
      reason: oversized,
      evidence: [{ path: 'analytics_features.home.avg_scored', value: 1.9, interpretation: oversized }, { path: 'analytics_features.away.avg_scored', value: 1.2, interpretation: oversized }],
    }),
  });
  const source = service.__private.buildSourcePayload(result.selected);

  assert.ok(source.selected.llm.headline.length <= 180);
  assert.ok(source.selected.llm.brief.length <= 1200);
  assert.ok(source.selected.llm.risk_note.length <= 500);
  assert.ok(source.selected.selectedBet.reason.length <= 1200);
  assert.ok(source.selected.llm.evidence.every((item) => item.interpretation.length <= 500));
  assert.ok(JSON.stringify(source.llm_trace).length <= 13000);
});

test('includes llm trace in failed run summary for dry-run diagnostics', async () => {
  const result = await service.runGlobalRecommendedPick({
    now: NOW,
    dryRun: true,
    matches: [candidate({ id: 'llm-match' })],
    sstatsMatchLoader: async () => null,
    llmSelector: async () => null,
  });

  assert.equal(result.reason, 'llm_selection_invalid');
  assert.equal(result.llm_trace.prompt_version, 'global-recommended-pick-llm-v2');
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

test('loads an English SStats fixture for a Russian Stavka pair and bootstraps the proven mapping after analytics payload succeeds', async () => {
  const candidateMatch = candidate({
    id: 'stavka-omonia-kairat',
    match_id: 'stavka-omonia-kairat',
    slug: 'omonia-nicosia-kairat-almaty',
    home_team: 'Омония Никосия',
    away_team: 'Кайрат Алматы',
  });
  const game = {
    id: 1591936,
    date: '2026-07-21T18:00:00+03:00',
    homeTeam: { id: 101, name: 'Omonia Nicosia' },
    awayTeam: { id: 202, name: 'Kairat Almaty' },
  };
  const calls = [];
  const payload = await service.__private.defaultSstatsMatchLoader(candidateMatch, {
    dateKey: '2026-07-21',
    pg: { connection: async () => [] },
    sstatsClient: {
      hasApiKey: () => true,
      apiGet: async () => [game],
      buildMatchPayload: async (gameId) => {
        calls.push(['payload', gameId]);
        return { fixture_id: gameId, game: { id: gameId } };
      },
    },
    resolver: {
      resolveProviderFixture: async () => ({ status: 'unresolved', method: 'canonical_pair_time' }),
      bootstrapCanonicalPair: async (_pg, input) => {
        calls.push(['bootstrap', input]);
        return { status: 'resolved', matchId: 700 };
      },
    },
    persistExternalMatchMapping: async (_pg, input) => calls.push(['mapping', input]),
  });

  assert.equal(payload.fixture_id, 1591936);
  assert.deepEqual(calls.map(([kind]) => kind), ['payload', 'bootstrap', 'mapping']);
  assert.equal(calls[1][1].source.home.systemTeamName, 'Омония Никосия');
  assert.equal(calls[1][1].target.away.systemTeamName, 'Kairat Almaty');
  assert.deepEqual(calls[2][1], {
    systemId: 3,
    internalMatchId: 700,
    systemMatchId: 1591936,
    systemMatchSlug: 'omonia-nicosia-kairat-almaty',
  });
});
