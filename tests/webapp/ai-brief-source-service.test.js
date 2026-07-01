const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAiBriefSourcePayload,
  buildCanonicalHashInput,
} = require('../../webapp/services/aiBriefSourceService');

// --- Fixtures ---

const MATCH = {
  id: 1001,
  slug: '27-06-2026-spain-uruguay',
  sportSlug: 'soccer',
};

const POPULAR_BETS_FULL = {
  meta: { total: 300 },
  data: [
    { type: 'one_x_two', outcome: 'w1', count: 120, rate: 1.72, percent: 40 },
    { type: 'both_to_score', outcome: 'yes', count: 80, rate: 2.15, percent: 27 },
    { type: 'total_over', outcome: '2_5', count: 60, rate: 2.22, percent: 20 },
    { type: 'handicap1', outcome: '-0_5', count: 40, rate: 1.55, percent: 13 },
  ],
};

const POPULAR_BETS_SPARSE = {
  meta: { total: 13 },
  data: [
    { type: 'one_x_two', outcome: 'w1', count: 10, rate: 1.72, percent: 77 },
    { type: 'both_to_score', outcome: 'yes', count: 3, rate: 2.15, percent: 23 },
  ],
};

const POPULAR_BETS_EMPTY = {
  meta: { total: 0 },
  data: [],
};

const POPULAR_BETS_ALT = {
  meta: { total: 200 },
  data: [
    { type: 'one_x_two', outcome: 'w2', count: 100, rate: 2.50, percent: 50 },
    { type: 'total_under', outcome: '2_5', count: 90, rate: 1.80, percent: 45 },
    { type: 'handicap2', outcome: '0_5', count: 50, rate: 3.10, percent: 25 },
  ],
};

const MATCH_DETAIL_WITH_SUMMARY = {
  predictionSummary: '📊 Вывод: Испания является фаворитом этого матча и должна победить без лишних проблем.',
  teams: { home: { name: 'Испания' }, away: { name: 'Уругвай' } },
};

const MATCH_DETAIL_NO_SUMMARY = {
  predictionSummary: null,
  teams: { home: { name: 'Испания' }, away: { name: 'Уругвай' } },
};

const MATCH_DETAIL_EMPTY_SUMMARY_WITH_PREDICTION = {
  predictionSummary: '',
  prediction: 'Испания выиграет благодаря преимуществу в середине поля и высокому проценту владения мячом.',
  teams: { home: { name: 'Испания' }, away: { name: 'Уругвай' } },
};

const MATCH_DETAIL_WHITESPACE_SUMMARY_WITH_PREDICTION = {
  predictionSummary: '   ',
  prediction: 'Испания выиграет благодаря преимуществу в середине поля и высокому проценту владения мячом.',
  teams: { home: { name: 'Испания' }, away: { name: 'Уругвай' } },
};

const MATCH_DETAIL_BOTH_MISSING = {
  predictionSummary: null,
  prediction: null,
  teams: { home: { name: 'Испания' }, away: { name: 'Уругвай' } },
};

function makeLoader(data) {
  return async () => data;
}

// --- source_mode: full ---

test('buildAiBriefSourcePayload: full mode when bets and summary both present', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WITH_SUMMARY),
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'full');
  assert.ok(result.source_hash, 'should have source_hash');
  assert.ok(result.summary_snippet && result.summary_snippet.length > 20, 'should have meaningful summary_snippet');
  assert.ok(Array.isArray(result.top_bets) && result.top_bets.length > 0, 'should have top_bets');
  assert.ok(result.primary_signal, 'should have primary_signal');
  assert.equal(result.source_url, 'https://stavka.tv/matches/27-06-2026-spain-uruguay');
  assert.equal(result.match_id, 1001);
  assert.equal(result.match_slug, '27-06-2026-spain-uruguay');
  assert.equal(result.sport_slug, 'soccer');
});

// --- source_mode: light ---

test('buildAiBriefSourcePayload: light mode when bets present but summary null', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_NO_SUMMARY),
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'light');
  assert.ok(result.source_hash, 'should have source_hash');
  assert.equal(result.summary_snippet, null, 'should have no summary_snippet');
  assert.ok(Array.isArray(result.top_bets) && result.top_bets.length > 0, 'should have top_bets');
});

// --- predictionSummary fallback to prediction ---

test('buildAiBriefSourcePayload: uses predictionSummary when present', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WITH_SUMMARY),
    riskBetsSelector: null,
  });

  assert.ok(result.summary_snippet && result.summary_snippet.length > 0, 'summary_snippet should be populated from predictionSummary');
  assert.ok(result.summary_snippet.includes('Испания'), 'snippet should contain content from predictionSummary');
});

test('buildAiBriefSourcePayload: falls back to prediction when predictionSummary is empty string', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_EMPTY_SUMMARY_WITH_PREDICTION),
    riskBetsSelector: null,
  });

  assert.ok(result.summary_snippet && result.summary_snippet.length > 0, 'summary_snippet should be populated from prediction fallback');
  assert.ok(result.summary_snippet.includes('Испания'), 'snippet should contain content from prediction field');
});

test('buildAiBriefSourcePayload: falls back to prediction when predictionSummary is whitespace', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WHITESPACE_SUMMARY_WITH_PREDICTION),
    riskBetsSelector: null,
  });

  assert.ok(result.summary_snippet && result.summary_snippet.length > 0, 'summary_snippet should be populated from prediction fallback');
  assert.ok(result.summary_snippet.includes('Испания'), 'snippet should contain content from prediction field');
});

test('buildAiBriefSourcePayload: summary_snippet is null when both predictionSummary and prediction are missing', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_BOTH_MISSING),
    riskBetsSelector: null,
  });

  assert.equal(result.summary_snippet, null, 'summary_snippet should be null when both fields are absent');
  assert.equal(result.source_mode, 'light');
});

test('buildAiBriefSourcePayload: light mode when matchDetailLoader is null', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'light');
  assert.ok(result.source_hash, 'should have source_hash');
  assert.equal(result.summary_snippet, null);
});

test('buildAiBriefSourcePayload: light mode when matchDetailLoader returns null', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(null),
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'light');
  assert.equal(result.summary_snippet, null);
});

// --- source_mode: skip ---

test('buildAiBriefSourcePayload: skip when only one usable bet (insufficient_data)', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_SPARSE),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WITH_SUMMARY),
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.ok(typeof result.source_hash === 'string' && result.source_hash.length === 64, 'skip should have deterministic source_hash');
  assert.equal(result.skip_reason, 'insufficient_data');
});

test('buildAiBriefSourcePayload: skip when popular bets data is null', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(null),
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.ok(typeof result.source_hash === 'string' && result.source_hash.length === 64, 'skip should have deterministic source_hash');
});

test('buildAiBriefSourcePayload: skip when popular bets list is empty', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_EMPTY),
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.ok(typeof result.source_hash === 'string' && result.source_hash.length === 64, 'skip should have deterministic source_hash');
});

test('buildAiBriefSourcePayload: skip when match is null', async () => {
  const result = await buildAiBriefSourcePayload({
    match: null,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.ok(typeof result.source_hash === 'string' && result.source_hash.length === 64, 'skip should have deterministic source_hash');
  assert.equal(result.skip_reason, 'no_match');
});

test('buildAiBriefSourcePayload: skip when match has no slug', async () => {
  const result = await buildAiBriefSourcePayload({
    match: { id: 1 },
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.equal(result.skip_reason, 'no_match');
});

test('buildAiBriefSourcePayload: skip when popularBetsLoader is not a function', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: null,
    matchDetailLoader: null,
    riskBetsSelector: null,
  });

  assert.equal(result.source_mode, 'skip');
  assert.equal(result.skip_reason, 'no_loader');
  assert.ok(typeof result.source_hash === 'string' && result.source_hash.length === 64, 'skip should have deterministic source_hash');
});

// --- Deterministic hash ---

test('buildAiBriefSourcePayload: identical input yields identical hash', async () => {
  const opts = {
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WITH_SUMMARY),
    riskBetsSelector: null,
  };

  const result1 = await buildAiBriefSourcePayload(opts);
  const result2 = await buildAiBriefSourcePayload(opts);

  assert.equal(result1.source_hash, result2.source_hash, 'same input must produce same hash');
  assert.equal(typeof result1.source_hash, 'string');
  assert.equal(result1.source_hash.length, 64, 'sha256 hex is 64 chars');
});

test('buildAiBriefSourcePayload: different bets yield different hash', async () => {
  const result1 = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
  });
  const result2 = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_ALT),
    matchDetailLoader: null,
  });

  assert.notEqual(result1.source_hash, result2.source_hash, 'different bets must produce different hash');
});

test('buildAiBriefSourcePayload: different summary yields different hash', async () => {
  const result1 = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: makeLoader(MATCH_DETAIL_WITH_SUMMARY),
  });
  const result2 = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
  });

  assert.notEqual(result1.source_hash, result2.source_hash, 'different summary must produce different hash');
});

// --- top_bets / primary_signal shape ---

test('buildAiBriefSourcePayload: top_bets limited to 5', async () => {
  const MANY_BETS = {
    meta: { total: 500 },
    data: [
      { type: 'one_x_two', outcome: 'w1', count: 100, rate: 1.5, percent: 20 },
      { type: 'both_to_score', outcome: 'yes', count: 80, rate: 2.0, percent: 16 },
      { type: 'total_over', outcome: '2_5', count: 60, rate: 2.2, percent: 12 },
      { type: 'handicap1', outcome: '-0_5', count: 50, rate: 1.9, percent: 10 },
      { type: 'handicap2', outcome: '0_5', count: 40, rate: 3.0, percent: 8 },
      { type: 'correct_score', outcome: '1:0', count: 30, rate: 7.5, percent: 6 },
      { type: 'double_chance', outcome: 'x1', count: 20, rate: 1.2, percent: 4 },
    ],
  };

  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(MANY_BETS),
    matchDetailLoader: null,
  });

  assert.equal(result.top_bets.length, 5, 'top_bets should be limited to 5');
});

test('buildAiBriefSourcePayload: primary_signal matches first top bet', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
  });

  assert.ok(result.primary_signal, 'should have primary_signal');
  assert.equal(result.primary_signal.type, result.top_bets[0].type);
  assert.equal(result.primary_signal.outcome, result.top_bets[0].outcome);
  assert.equal(result.primary_signal.count, result.top_bets[0].count);
  assert.equal(result.primary_signal.rate, result.top_bets[0].rate);
});

test('buildAiBriefSourcePayload: top_bets have normalized shape', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
  });

  const bet = result.top_bets[0];
  assert.ok('type' in bet);
  assert.ok('outcome' in bet);
  assert.ok('count' in bet);
  assert.ok('rate' in bet);
  assert.ok('percent' in bet);
  assert.ok('label' in bet);
});

test('buildAiBriefSourcePayload: risk_bets have normalized shape', async () => {
  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
  });

  if (result.risk_bets.length > 0) {
    const bet = result.risk_bets[0];
    assert.ok('type' in bet);
    assert.ok('outcome' in bet);
    assert.ok('rate' in bet);
    assert.ok('risk_order' in bet);
    assert.ok('risk_label' in bet);
    assert.ok('risk_name' in bet);
  }
});

// --- riskBetsSelector ---

test('buildAiBriefSourcePayload: uses custom riskBetsSelector when provided', async () => {
  const customRiskBets = [
    { type: 'custom', outcome: 'val', rate: 1.5, count: 50, percent: 17, label: 'Custom', risk_order: 1, risk_label: 'low', risk_name: 'Низкий риск' },
  ];

  const result = await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: makeLoader(POPULAR_BETS_FULL),
    matchDetailLoader: null,
    riskBetsSelector: () => customRiskBets,
  });

  assert.deepEqual(result.risk_bets, customRiskBets);
});

test('buildAiBriefSourcePayload: loaders are called with match slug', async () => {
  const calledWith = [];
  const loader = async (slug) => { calledWith.push(slug); return POPULAR_BETS_FULL; };
  const detailLoader = async (slug) => { calledWith.push(slug); return MATCH_DETAIL_NO_SUMMARY; };

  await buildAiBriefSourcePayload({
    match: MATCH,
    popularBetsLoader: loader,
    matchDetailLoader: detailLoader,
  });

  assert.equal(calledWith.length, 2);
  assert.ok(calledWith.every(s => s === MATCH.slug), 'both loaders should receive the match slug');
});

// --- buildCanonicalHashInput ---

test('buildCanonicalHashInput: produces stable JSON string', () => {
  const input = {
    match_slug: 'test-match',
    source_mode: 'full',
    top_bets: [{ type: 'one_x_two', outcome: 'w1', count: 100, rate: 1.5 }],
    primary_signal: { type: 'one_x_two', outcome: 'w1', count: 100, rate: 1.5 },
    summary_snippet: 'Test snippet',
  };

  const result1 = buildCanonicalHashInput(input);
  const result2 = buildCanonicalHashInput(input);

  assert.equal(result1, result2, 'same input should produce same JSON');
  assert.equal(typeof result1, 'string');
});

test('buildCanonicalHashInput: excludes percent and label from top_bets', () => {
  const input = {
    match_slug: 'test',
    source_mode: 'light',
    top_bets: [{ type: 'one_x_two', outcome: 'w1', count: 50, rate: 2.0, percent: 30, label: 'Победа хозяев' }],
    primary_signal: { type: 'one_x_two', outcome: 'w1', count: 50, rate: 2.0, percent: 30, label: 'Победа хозяев' },
    summary_snippet: null,
  };

  const parsed = JSON.parse(buildCanonicalHashInput(input));

  assert.equal('percent' in parsed.top_bets[0], false, 'should exclude percent from canonical top_bets');
  assert.equal('label' in parsed.top_bets[0], false, 'should exclude label from canonical top_bets');
  assert.equal('percent' in parsed.primary_signal, false, 'should exclude percent from canonical primary_signal');
  assert.equal('label' in parsed.primary_signal, false, 'should exclude label from canonical primary_signal');
});

test('buildCanonicalHashInput: null summary_snippet serialized as null', () => {
  const input = {
    match_slug: 'test',
    source_mode: 'light',
    top_bets: [],
    primary_signal: null,
    summary_snippet: null,
  };

  const parsed = JSON.parse(buildCanonicalHashInput(input));
  assert.equal(parsed.summary_snippet, null);
});

test('buildCanonicalHashInput: null primary_signal serialized as null', () => {
  const input = {
    match_slug: 'test',
    source_mode: 'light',
    top_bets: [],
    primary_signal: null,
    summary_snippet: null,
  };

  const parsed = JSON.parse(buildCanonicalHashInput(input));
  assert.equal(parsed.primary_signal, null);
});
