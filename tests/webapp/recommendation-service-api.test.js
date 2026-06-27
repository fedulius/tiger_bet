const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendations, loadLiveRecommendations, loadWideFeedRecommendations, betConfidenceFromSocialProof } = require('../../webapp/services/recommendationService');
const { selectRiskBets } = require('../../lib/stavkaApi');

// --- Mock helpers ---

function makeMatch(overrides) {
  const now = Date.now();
  return {
    id: overrides.id || 'test-1',
    slug: overrides.slug || '26-06-2026-team-a-team-b',
    sportSlug: overrides.sportSlug || 'soccer',
    matchDate: overrides.matchDate || new Date(now + 3600000).toISOString(),
    teams: {
      home: { name: overrides.homeName || 'Team A' },
      away: { name: overrides.awayName || 'Team B' },
    },
    league: {
      name: overrides.leagueName || 'Premier League',
      country: { name: overrides.countryName || 'England' },
    },
    odds: {
      one_x_two: {
        w1: { value: overrides.odds?.w1 || 2.0 },
        w2: { value: overrides.odds?.w2 || 3.5 },
        x: { value: overrides.odds?.x || 3.0 },
      },
    },
  };
}

function makePopularBets(bets) {
  return {
    meta: { total: bets.reduce((s, b) => s + (b.count || 0), 0) },
    data: bets,
  };
}

const defaultPopularBets = makePopularBets([
  { type: 'one_x_two', outcome: 'w2', count: 50, rate: 1.7, percent: 15 },
  { type: 'both_to_score', outcome: 'yes', count: 40, rate: 2.1, percent: 12 },
  { type: 'total_over', outcome: '2_5', count: 30, rate: 3.0, percent: 9 },
  { type: 'handicap2', outcome: '-1_5', count: 20, rate: 4.5, percent: 6 },
  { type: 'correct_score', outcome: '1:2', count: 10, rate: 8.0, percent: 3 },
]);

function mockApiLoader(matches) {
  return async () => matches;
}

function mockPopularBetsLoader(bets) {
  return async () => bets || defaultPopularBets;
}

// --- Tests ---

test('loadLiveRecommendations returns items from API', async () => {
  const matches = [makeMatch({ id: 'm1', slug: '26-06-2026-a-b', homeName: 'Arsenal', awayName: 'Chelsea' })];
  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
    limit: 3,
  });
  assert.ok(items.length > 0, 'should return items');
  assert.ok(items[0].match.includes('Arsenal'), 'should contain team name');
  assert.ok(items[0].bets, 'should have bets array');
  assert.equal(items[0].bets.length, 3, 'should have 3 bets');
  assert.equal(items[0].match_id, 'm1', 'should have match_id from API');
  assert.equal(items[0].match_slug, '26-06-2026-a-b', 'should have match_slug from API');
});

test('loadLiveRecommendations returns empty when no apiLoader', async () => {
  const items = await loadLiveRecommendations({});
  assert.deepEqual(items, []);
});

test('loadLiveRecommendations returns empty when no matches', async () => {
  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader([]),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
  });
  assert.deepEqual(items, []);
});

test('loadLiveRecommendations filters by favoriteSports', async () => {
  const matches = [
    makeMatch({ id: 'm1', sportSlug: 'soccer' }),
    makeMatch({ id: 'm2', sportSlug: 'tennis', homeName: 'Player A', awayName: 'Player B' }),
  ];
  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
    favoriteSports: [{ sport_id: 1, sport_name: 'Футбол' }],
    limit: 10,
  });
  assert.equal(items.length, 1, 'should filter to soccer only');
  assert.equal(items[0].sportSlug, 'soccer');
});

test('loadLiveRecommendations bets have risk labels', async () => {
  const matches = [makeMatch({ id: 'm1' })];
  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
  });
  const bets = items[0].bets;
  assert.equal(bets[0].risk_label, 'low');
  assert.equal(bets[1].risk_label, 'medium');
  assert.equal(bets[2].risk_label, 'high');
});

test('loadLiveRecommendations bets have real coefficients', async () => {
  const matches = [makeMatch({ id: 'm1' })];
  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
  });
  const bets = items[0].bets;
  for (const bet of bets) {
    assert.ok(typeof bet.coeff === 'number' && bet.coeff > 1, 'coeff should be > 1, got ' + bet.coeff);
  }
  // Rates should be ascending
  assert.ok(bets[1].coeff > bets[0].coeff, 'medium rate > low rate');
  assert.ok(bets[2].coeff > bets[1].coeff, 'high rate > medium rate');
});

test('betConfidenceFromSocialProof keeps strong low-risk bets at least medium and promotes strong signals to high', () => {
  assert.equal(betConfidenceFromSocialProof(12, 4, 'low'), 'средняя');
  assert.equal(betConfidenceFromSocialProof(30, 8, 'low'), 'высокая');
  assert.equal(betConfidenceFromSocialProof(18, 15, 'low'), 'высокая');
});

test('betConfidenceFromSocialProof gives medium-risk bets fair confidence and keeps high-risk bets below medium', () => {
  assert.equal(betConfidenceFromSocialProof(20, 7, 'medium'), 'средняя');
  assert.equal(betConfidenceFromSocialProof(55, 12, 'medium'), 'высокая');
  assert.equal(betConfidenceFromSocialProof(40, 20, 'high'), 'ниже средней');
});

test('loadLiveRecommendations maps API bet confidence from social proof instead of defaulting everything below medium', async () => {
  const matches = [makeMatch({ id: 'm-confidence' })];
  const popularBets = makePopularBets([
    { type: 'one_x_two', outcome: 'w2', count: 32, rate: 1.7, percent: 16 },
    { type: 'both_to_score', outcome: 'yes', count: 24, rate: 2.2, percent: 10 },
    { type: 'total_over', outcome: '2_5', count: 14, rate: 3.4, percent: 5 },
  ]);

  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(popularBets),
    riskBetsSelector: selectRiskBets,
  });

  const bets = items[0].bets;
  assert.equal(bets[0].confidence, 'высокая');
  assert.equal(bets[1].confidence, 'средняя');
  assert.equal(bets[2].confidence, 'ниже средней');
});

test('betConfidenceFromSocialProof returns высокая when coeff < 1.4 regardless of risk_label and social proof', () => {
  // low social proof + high risk → normally ниже средней, but coeff overrides
  assert.equal(betConfidenceFromSocialProof(0, 0, 'high', 1.3), 'высокая');
  assert.equal(betConfidenceFromSocialProof(5, 2, 'medium', 1.39), 'высокая');
  assert.equal(betConfidenceFromSocialProof(0, 0, 'low', 1.05), 'высокая');
  // coeff === 1.4 does NOT trigger the rule — falls back to existing logic
  assert.equal(betConfidenceFromSocialProof(0, 0, 'high', 1.4), 'ниже средней');
  // coeff > 1.4 — existing logic untouched
  assert.equal(betConfidenceFromSocialProof(0, 0, 'high', 2.5), 'ниже средней');
  // no coeff (undefined) — existing logic untouched
  assert.equal(betConfidenceFromSocialProof(0, 0, 'high'), 'ниже средней');
});

test('loadLiveRecommendations assigns высокая confidence when bet coeff < 1.4', async () => {
  const matches = [makeMatch({ id: 'm-low-coeff' })];
  // Rate 1.35 → coeff < 1.4 → должна быть высокая даже при high risk и слабом social proof
  const popularBets = makePopularBets([
    { type: 'one_x_two', outcome: 'w1', count: 3, rate: 1.35, percent: 2 },
    { type: 'both_to_score', outcome: 'no', count: 2, rate: 1.6, percent: 1 },
    { type: 'total_over', outcome: '2_5', count: 1, rate: 3.5, percent: 1 },
  ]);

  const items = await loadLiveRecommendations({
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(popularBets),
    riskBetsSelector: selectRiskBets,
  });

  const bets = items[0].bets;
  assert.equal(bets[0].coeff, 1.35, 'first bet should have coeff 1.35');
  assert.equal(bets[0].confidence, 'высокая', 'coeff < 1.4 must yield высокая');
});

test('loadWideFeedRecommendations returns feed items', async () => {
  const matches = [makeMatch({ id: 'm1', homeName: 'Arsenal', awayName: 'Chelsea' })];
  const items = await loadWideFeedRecommendations({
    apiLoader: mockApiLoader(matches),
  });
  assert.ok(items.length > 0, 'should return items');
  assert.ok(items[0].match.includes('Arsenal'), 'should contain team name');
  assert.ok(items[0].source_coeff > 1, 'should have real coefficient');
});

test('loadWideFeedRecommendations returns empty when no apiLoader', async () => {
  const items = await loadWideFeedRecommendations({});
  assert.deepEqual(items, []);
});

test('getRecommendations returns payload with items', async () => {
  const matches = [makeMatch({ id: 'm1' })];
  const result = await getRecommendations({
    enableLive: true,
    disableCache: true,
    apiLoader: mockApiLoader(matches),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
  });
  assert.ok(result.items, 'should have items');
  assert.ok(result.items.length > 0, 'should have > 0 items');
  assert.ok(result.source, 'should have source');
  assert.ok(result.updated_at, 'should have updated_at');
  assert.ok('match_id' in result.items[0], 'items should have match_id field');
  assert.ok('match_slug' in result.items[0], 'items should have match_slug field');
  assert.equal(result.items[0].match_id, 'm1', 'match_id should equal API match id');
});

test('getRecommendations returns empty when no matches', async () => {
  const result = await getRecommendations({
    enableLive: true,
    disableCache: true,
    apiLoader: mockApiLoader([]),
    popularBetsLoader: mockPopularBetsLoader(defaultPopularBets),
    riskBetsSelector: selectRiskBets,
  });
  assert.ok(result.items, 'should have items array');
  assert.equal(result.items.length, 0, 'should be empty');
});
