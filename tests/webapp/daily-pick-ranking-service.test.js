const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computePopularityScore,
  computeBettingScore,
  rankCandidateMatches,
  pickBestMatch,
} = require('../../webapp/services/dailyPickRankingService');

// Realistic match shape for tiger_bet
function makeMatch(overrides) {
  return {
    id: 'match-1',
    starts_at: '2026-07-03T18:00:00+03:00',
    home_team: 'Team A',
    away_team: 'Team B',
    league: 'Premier League',
    odds: { home: 1.90, draw: 3.50, away: 2.00 },
    popularity_hints: {},
    ...overrides,
  };
}

const BALANCED_ODDS = { home: 1.90, draw: 3.50, away: 2.00 };
const LOPSIDED_ODDS = { home: 1.20, draw: 5.00, away: 8.00 };

// --- computePopularityScore ---

test('computePopularityScore: tier-1 scores higher than tier-2', () => {
  const t1 = makeMatch({ popularity_hints: { league_tier: 1 } });
  const t2 = makeMatch({ popularity_hints: { league_tier: 2 } });
  assert.ok(computePopularityScore(t1) > computePopularityScore(t2));
});

test('computePopularityScore: tier-2 scores higher than tier-3', () => {
  const t2 = makeMatch({ popularity_hints: { league_tier: 2 } });
  const t3 = makeMatch({ popularity_hints: { league_tier: 3 } });
  assert.ok(computePopularityScore(t2) > computePopularityScore(t3));
});

test('computePopularityScore: is_featured adds to score', () => {
  const plain = makeMatch({ popularity_hints: { league_tier: 2 } });
  const featured = makeMatch({ popularity_hints: { league_tier: 2, is_featured: true } });
  assert.ok(computePopularityScore(featured) > computePopularityScore(plain));
});

test('computePopularityScore: viewer_count adds to score', () => {
  const noViewers = makeMatch({ popularity_hints: {} });
  const withViewers = makeMatch({ popularity_hints: { viewer_count: 10000 } });
  assert.ok(computePopularityScore(withViewers) > computePopularityScore(noViewers));
});

test('computePopularityScore: returns 0 for match with no hints', () => {
  assert.equal(computePopularityScore(makeMatch({ popularity_hints: {} })), 0);
});

test('computePopularityScore: missing popularity_hints treated as empty', () => {
  const m = makeMatch();
  delete m.popularity_hints;
  assert.equal(computePopularityScore(m), 0);
});

// --- computeBettingScore ---

test('computeBettingScore: balanced odds score higher than lopsided odds', () => {
  const bal = makeMatch({ odds: BALANCED_ODDS });
  const lop = makeMatch({ odds: LOPSIDED_ODDS });
  assert.ok(computeBettingScore(bal) > computeBettingScore(lop));
});

test('computeBettingScore: returns 0 when odds is undefined', () => {
  const m = makeMatch({ odds: undefined });
  assert.equal(computeBettingScore(m), 0);
});

test('computeBettingScore: returns 0 when odds.home is missing', () => {
  const m = makeMatch({ odds: { away: 2.0 } });
  assert.equal(computeBettingScore(m), 0);
});

test('computeBettingScore: returns a number between 0 and 100', () => {
  const score = computeBettingScore(makeMatch({ odds: BALANCED_ODDS }));
  assert.ok(score >= 0 && score <= 100);
});

// --- rankCandidateMatches: core product rule (popularity first) ---

test('rankCandidateMatches: more popular match ranks first regardless of betting', () => {
  const popular = makeMatch({ id: 'pop', popularity_hints: { league_tier: 1 } });
  const lesser = makeMatch({ id: 'low', popularity_hints: { league_tier: 3 }, odds: BALANCED_ODDS });
  // lesser has better balanced odds, but popularity wins
  const ranked = rankCandidateMatches([lesser, popular]);
  assert.equal(ranked[0].match.id, 'pop');
});

test('rankCandidateMatches: equal popularity → better betting score ranks first', () => {
  const goodBet = makeMatch({ id: 'good', odds: BALANCED_ODDS });
  const badBet = makeMatch({ id: 'bad', odds: LOPSIDED_ODDS });
  const ranked = rankCandidateMatches([badBet, goodBet]);
  assert.equal(ranked[0].match.id, 'good');
});

test('rankCandidateMatches: equal popularity and betting → earlier starts_at ranks first', () => {
  const early = makeMatch({ id: 'early', starts_at: '2026-07-03T15:00:00+03:00' });
  const late = makeMatch({ id: 'late', starts_at: '2026-07-03T20:00:00+03:00' });
  const ranked = rankCandidateMatches([late, early]);
  assert.equal(ranked[0].match.id, 'early');
});

test('rankCandidateMatches: all equal → stable tie-break by id string ASC', () => {
  const m1 = makeMatch({ id: 'match-1' });
  const m2 = makeMatch({ id: 'match-2' });
  const m3 = makeMatch({ id: 'match-3' });
  const ranked = rankCandidateMatches([m3, m1, m2]);
  assert.equal(ranked[0].match.id, 'match-1');
  assert.equal(ranked[1].match.id, 'match-2');
  assert.equal(ranked[2].match.id, 'match-3');
});

test('rankCandidateMatches: numeric ids coerced to string for tie-break', () => {
  const m1 = makeMatch({ id: 1 });
  const m2 = makeMatch({ id: 2 });
  const ranked = rankCandidateMatches([m2, m1]);
  assert.equal(ranked[0].match.id, 1);
  assert.equal(ranked[1].match.id, 2);
});

test('rankCandidateMatches: returns score breakdown with popularity and betting', () => {
  const m = makeMatch({ popularity_hints: { league_tier: 1 } });
  const [entry] = rankCandidateMatches([m]);
  assert.ok(typeof entry.scores.popularity === 'number');
  assert.ok(typeof entry.scores.betting === 'number');
  assert.ok(entry.scores.popularity > 0);
});

test('rankCandidateMatches: original match object is preserved', () => {
  const m = makeMatch({ id: 'orig', league: 'LaLiga' });
  const [entry] = rankCandidateMatches([m]);
  assert.equal(entry.match.league, 'LaLiga');
});

test('rankCandidateMatches: returns empty array for empty input', () => {
  assert.deepEqual(rankCandidateMatches([]), []);
});

test('rankCandidateMatches: handles single match', () => {
  const m = makeMatch({ id: 'solo' });
  const ranked = rankCandidateMatches([m]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].match.id, 'solo');
});

// --- pickBestMatch ---

test('pickBestMatch: returns null for empty array', () => {
  assert.equal(pickBestMatch([]), null);
});

test('pickBestMatch: returns the match (not the ranked entry) for single candidate', () => {
  const m = makeMatch({ id: 'solo' });
  const result = pickBestMatch([m]);
  assert.equal(result.id, 'solo');
  assert.equal(result.home_team, 'Team A');
});

test('pickBestMatch: returns most popular match', () => {
  const popular = makeMatch({ id: 'top', popularity_hints: { league_tier: 1 } });
  const lesser = makeMatch({ id: 'low', popularity_hints: { league_tier: 3 } });
  assert.equal(pickBestMatch([lesser, popular]).id, 'top');
});

test('pickBestMatch: popularity tie broken by betting score', () => {
  const goodBet = makeMatch({ id: 'good', odds: BALANCED_ODDS });
  const badBet = makeMatch({ id: 'bad', odds: LOPSIDED_ODDS });
  assert.equal(pickBestMatch([badBet, goodBet]).id, 'good');
});

test('pickBestMatch: all-equal tie broken by starts_at then id', () => {
  const m1 = makeMatch({ id: 'match-1', starts_at: '2026-07-03T18:00:00+03:00' });
  const m2 = makeMatch({ id: 'match-2', starts_at: '2026-07-03T18:00:00+03:00' });
  assert.equal(pickBestMatch([m2, m1]).id, 'match-1');
});
