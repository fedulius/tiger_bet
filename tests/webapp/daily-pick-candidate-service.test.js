const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCandidate,
  getCandidateMatchesForDate,
} = require('../../webapp/services/dailyPickCandidateService');

// Raw match shape as returned by stavkaApi.fetchAllMatches
function makeRawMatch(overrides) {
  return {
    id: 1001,
    slug: 'team-a-vs-team-b-2026-07-03',
    startsAt: '2026-07-03T15:00:00.000Z', // 18:00 MSK
    sportSlug: 'soccer',
    homeTeam: { id: 10, name: 'Team A' },
    awayTeam: { id: 20, name: 'Team B' },
    league: { id: 5, name: 'Premier League', slug: 'premier-league' },
    odds: { one_x_two: { w1: 1.90, x: 3.50, w2: 2.00 } },
    isPopular: true,
    viewerCount: 8000,
    ...overrides,
  };
}

const TARGET_DATE = '2026-07-03';
const SCOPE_WITH_LEAGUE = { leagueIds: [5], leagueSlugs: [] };
const SCOPE_EMPTY = { leagueIds: [], leagueSlugs: [] };
const NOW_BEFORE = new Date('2026-07-03T10:00:00.000Z').getTime();

// ─── normalizeCandidate: stable shape ────────────────────────────────────────

test('normalizeCandidate: produces stable shape with required fields', () => {
  const c = normalizeCandidate(makeRawMatch());
  assert.equal(typeof c.id, 'string');
  assert.equal(typeof c.match_id, 'string');
  assert.equal(typeof c.match_slug, 'string');
  assert.equal(typeof c.starts_at, 'string');
  assert.ok(c.starts_at.includes('T'), 'starts_at should be ISO');
  assert.equal(typeof c.league_label, 'string');
  assert.ok(c.odds !== null && typeof c.odds === 'object');
  assert.ok('home' in c.odds && 'draw' in c.odds && 'away' in c.odds);
  assert.ok(c.popularity_hints !== null && typeof c.popularity_hints === 'object');
  assert.equal(typeof c.sport_slug, 'string');
});

test('normalizeCandidate: id coerced to string', () => {
  const c = normalizeCandidate(makeRawMatch({ id: 42 }));
  assert.equal(c.id, '42');
  assert.equal(c.match_id, '42');
});

test('normalizeCandidate: match_slug from slug field', () => {
  const c = normalizeCandidate(makeRawMatch({ slug: 'my-match-slug' }));
  assert.equal(c.match_slug, 'my-match-slug');
});

test('normalizeCandidate: starts_at parsed to UTC ISO string', () => {
  const c = normalizeCandidate(makeRawMatch({ startsAt: '2026-07-03T15:00:00.000Z' }));
  assert.ok(c.starts_at.startsWith('2026-07-03'));
  assert.ok(c.starts_at.endsWith('Z'));
});

test('normalizeCandidate: starts_at accepts snake_case field', () => {
  const raw = makeRawMatch();
  delete raw.startsAt;
  raw.starts_at = '2026-07-03T15:00:00.000Z';
  const c = normalizeCandidate(raw);
  assert.ok(c.starts_at.startsWith('2026-07-03'));
});

test('normalizeCandidate: date_msk is Moscow calendar date, not UTC date', () => {
  // 21:00 UTC on July 3 = 00:00 MSK on July 4 — date_msk must be July 4
  const c = normalizeCandidate(makeRawMatch({ startsAt: '2026-07-03T21:00:00.000Z' }));
  assert.equal(c.date_msk, '2026-07-04');
});

test('normalizeCandidate: odds mapped from one_x_two (w1→home, x→draw, w2→away)', () => {
  const c = normalizeCandidate(makeRawMatch());
  assert.equal(c.odds.home, 1.90);
  assert.equal(c.odds.draw, 3.50);
  assert.equal(c.odds.away, 2.00);
});

test('normalizeCandidate: odds fallback to flat home/draw/away shape', () => {
  const c = normalizeCandidate(makeRawMatch({ odds: { home: 1.5, draw: 3.0, away: 4.0 } }));
  assert.equal(c.odds.home, 1.5);
  assert.equal(c.odds.draw, 3.0);
  assert.equal(c.odds.away, 4.0);
});

test('normalizeCandidate: odds are null when odds field absent', () => {
  const c = normalizeCandidate(makeRawMatch({ odds: undefined }));
  assert.equal(c.odds.home, null);
  assert.equal(c.odds.draw, null);
  assert.equal(c.odds.away, null);
});

test('normalizeCandidate: team names from homeTeam/awayTeam objects', () => {
  const c = normalizeCandidate(makeRawMatch());
  assert.equal(c.home_team, 'Team A');
  assert.equal(c.away_team, 'Team B');
});

test('normalizeCandidate: team names fallback to flat home_team/away_team fields', () => {
  const raw = makeRawMatch({ homeTeam: undefined, awayTeam: undefined, home_team: 'Club X', away_team: 'Club Y' });
  const c = normalizeCandidate(raw);
  assert.equal(c.home_team, 'Club X');
  assert.equal(c.away_team, 'Club Y');
});

test('normalizeCandidate: supports live stavka shape with matchDate, teams.home/away, and odds.value objects', () => {
  const c = normalizeCandidate({
    id: 'ts_live_1',
    slug: '03-07-2026-ktp-jippo',
    matchDate: '2026-07-03T15:30:00+00:00',
    sportSlug: 'soccer',
    league: { id: '55', slug: 'finland-ykkonen', name: 'Йккослиига' },
    teams: {
      home: { name: 'КТП' },
      away: { name: 'Йиппо' },
    },
    odds: {
      one_x_two: {
        w1: { value: 1.83 },
        x: { value: 3.44 },
        w2: { value: 3.98 },
      },
    },
  });
  assert.equal(c.starts_at, '2026-07-03T15:30:00.000Z');
  assert.equal(c.home_team, 'КТП');
  assert.equal(c.away_team, 'Йиппо');
  assert.deepEqual(c.odds, { home: 1.83, draw: 3.44, away: 3.98 });
});

test('normalizeCandidate: league_id, league_slug, league_label from league object', () => {
  const c = normalizeCandidate(makeRawMatch());
  assert.equal(c.league_id, 5);
  assert.equal(c.league_slug, 'premier-league');
  assert.equal(c.league_label, 'Premier League');
  assert.equal(c.external_league_id, '5');
});


test('normalizeCandidate: preserves string external league id while numeric league_id stays null', () => {
  const c = normalizeCandidate(makeRawMatch({
    league: { id: 'ps-4842-cct-south-america-series-3', name: 'CCT South America Series 3', slug: 'cct-south-america-series-3-' },
  }));
  assert.equal(c.league_id, null);
  assert.equal(c.external_league_id, 'ps-4842-cct-south-america-series-3');
  assert.equal(c.league_slug, 'cct-south-america-series-3-');
});

test('normalizeCandidate: league_label from string league, ids null', () => {
  const c = normalizeCandidate(makeRawMatch({ league: 'La Liga' }));
  assert.equal(c.league_label, 'La Liga');
  assert.equal(c.league_id, null);
  assert.equal(c.league_slug, null);
});

test('normalizeCandidate: sport_slug from sportSlug field', () => {
  const c = normalizeCandidate(makeRawMatch({ sportSlug: 'ice-hockey' }));
  assert.equal(c.sport_slug, 'ice-hockey');
});

test('normalizeCandidate: sport_slug from snake_case sport_slug field', () => {
  const raw = makeRawMatch({ sportSlug: undefined, sport_slug: 'basketball' });
  const c = normalizeCandidate(raw);
  assert.equal(c.sport_slug, 'basketball');
});

test('normalizeCandidate: popularity_hints.is_featured from isPopular', () => {
  assert.equal(normalizeCandidate(makeRawMatch({ isPopular: true })).popularity_hints.is_featured, true);
  assert.equal(normalizeCandidate(makeRawMatch({ isPopular: false })).popularity_hints.is_featured, false);
});

test('normalizeCandidate: popularity_hints.viewer_count from viewerCount', () => {
  const c = normalizeCandidate(makeRawMatch({ viewerCount: 5000 }));
  assert.equal(c.popularity_hints.viewer_count, 5000);
});

test('normalizeCandidate: popularity_hints.league_tier from league.tier', () => {
  const raw = makeRawMatch({ league: { id: 5, name: 'PL', slug: 'pl', tier: 1 } });
  const c = normalizeCandidate(raw);
  assert.equal(c.popularity_hints.league_tier, 1);
});

test('normalizeCandidate: popularity_hints.league_tier is null when tier absent', () => {
  const c = normalizeCandidate(makeRawMatch());
  assert.equal(c.popularity_hints.league_tier, null);
});

// ─── getCandidateMatchesForDate: league scope filtering ───────────────────────

test('getCandidateMatchesForDate: empty when no leagues in scope', () => {
  const result = getCandidateMatchesForDate({
    allMatches: [makeRawMatch()],
    userLeagueScope: SCOPE_EMPTY,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.deepEqual(result, []);
});

test('getCandidateMatchesForDate: empty when userLeagueScope is null', () => {
  const result = getCandidateMatchesForDate({
    allMatches: [makeRawMatch()],
    userLeagueScope: null,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.deepEqual(result, []);
});

test('getCandidateMatchesForDate: returns only in-scope matches by league id', () => {
  const inScope  = makeRawMatch({ id: 1, league: { id: 5,  name: 'PL',    slug: 'pl' } });
  const outScope = makeRawMatch({ id: 2, league: { id: 99, name: 'Other', slug: 'other' } });
  const result = getCandidateMatchesForDate({
    allMatches: [inScope, outScope],
    userLeagueScope: { leagueIds: [5], leagueSlugs: [] },
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].match_id, '1');
});

test('getCandidateMatchesForDate: returns only in-scope matches by league slug', () => {
  const inScope  = makeRawMatch({ id: 1, league: { id: 5, name: 'PL',         slug: 'premier-league' } });
  const outScope = makeRawMatch({ id: 2, league: { id: 6, name: 'Bundesliga', slug: 'bundesliga' } });
  const result = getCandidateMatchesForDate({
    allMatches: [inScope, outScope],
    userLeagueScope: { leagueIds: [], leagueSlugs: ['premier-league'] },
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].match_id, '1');
});

test('getCandidateMatchesForDate: matches either league id or slug', () => {
  const byId   = makeRawMatch({ id: 1, league: { id: 5,  name: 'PL',   slug: 'pl-other' } });
  const bySlug = makeRawMatch({ id: 2, league: { id: 99, name: 'Liga', slug: 'la-liga' } });
  const result = getCandidateMatchesForDate({
    allMatches: [byId, bySlug],
    userLeagueScope: { leagueIds: [5], leagueSlugs: ['la-liga'] },
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 2);
});

// ─── getCandidateMatchesForDate: date filtering ───────────────────────────────

test('getCandidateMatchesForDate: includes only matches on target Moscow date', () => {
  // 15:00 UTC = 18:00 MSK, still July 3
  const onDate    = makeRawMatch({ id: 1, startsAt: '2026-07-03T15:00:00.000Z' });
  // 15:00 UTC next day = July 4 MSK
  const otherDate = makeRawMatch({ id: 2, startsAt: '2026-07-04T15:00:00.000Z' });
  const result = getCandidateMatchesForDate({
    allMatches: [onDate, otherDate],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: '2026-07-03',
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].match_id, '1');
});

test('getCandidateMatchesForDate: Moscow midnight edge — 21:00 UTC = 00:00 MSK next day', () => {
  // 21:00 UTC on July 3 = 00:00 MSK on July 4
  const atMidnightMsk = makeRawMatch({ id: 1, startsAt: '2026-07-03T21:00:00.000Z' });

  const resultJuly3 = getCandidateMatchesForDate({
    allMatches: [atMidnightMsk],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: '2026-07-03',
    nowMs: NOW_BEFORE,
  });
  assert.equal(resultJuly3.length, 0, 'midnight MSK match must not appear on July 3');

  const resultJuly4 = getCandidateMatchesForDate({
    allMatches: [atMidnightMsk],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: '2026-07-04',
    nowMs: NOW_BEFORE,
  });
  assert.equal(resultJuly4.length, 1, 'midnight MSK match must appear on July 4');
});

// ─── getCandidateMatchesForDate: garbage / junk filtering ────────────────────

test('getCandidateMatchesForDate: skips matches without id', () => {
  const raw = makeRawMatch({ id: undefined, match_id: undefined });
  const result = getCandidateMatchesForDate({
    allMatches: [raw],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 0);
});

test('getCandidateMatchesForDate: skips matches without starts_at', () => {
  const raw = makeRawMatch();
  delete raw.startsAt;
  delete raw.starts_at;
  const result = getCandidateMatchesForDate({
    allMatches: [raw],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 0);
});

test('getCandidateMatchesForDate: skips matches with unparseable starts_at', () => {
  const result = getCandidateMatchesForDate({
    allMatches: [makeRawMatch({ startsAt: 'not-a-date' })],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 0);
});

test('getCandidateMatchesForDate: skips past matches', () => {
  const nowAfter = new Date('2026-07-03T20:00:00.000Z').getTime();
  // 15:00 UTC = already past
  const past   = makeRawMatch({ id: 1, startsAt: '2026-07-03T15:00:00.000Z' });
  // 20:30 UTC = future (after nowAfter), and 23:30 MSK = still July 3 MSK
  const future = makeRawMatch({ id: 2, startsAt: '2026-07-03T20:30:00.000Z' });
  const result = getCandidateMatchesForDate({
    allMatches: [past, future],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: nowAfter,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].match_id, '2');
});

test('getCandidateMatchesForDate: null/undefined entries in array are skipped', () => {
  const result = getCandidateMatchesForDate({
    allMatches: [null, undefined, makeRawMatch()],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 1);
});

test('getCandidateMatchesForDate: returns empty for empty allMatches', () => {
  const result = getCandidateMatchesForDate({
    allMatches: [],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.deepEqual(result, []);
});

// ─── getCandidateMatchesForDate: ranking data preserved ──────────────────────

test('getCandidateMatchesForDate: candidates preserve odds for ranking', () => {
  const raw = makeRawMatch({ odds: { one_x_two: { w1: 2.5, x: 3.0, w2: 1.8 } } });
  const [c] = getCandidateMatchesForDate({
    allMatches: [raw],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(c.odds.home, 2.5);
  assert.equal(c.odds.draw, 3.0);
  assert.equal(c.odds.away, 1.8);
});

test('getCandidateMatchesForDate: candidates preserve popularity_hints for ranking', () => {
  const raw = makeRawMatch({
    isPopular: true,
    viewerCount: 12000,
    league: { id: 5, name: 'PL', slug: 'premier-league', tier: 1 },
  });
  const [c] = getCandidateMatchesForDate({
    allMatches: [raw],
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(c.popularity_hints.is_featured, true);
  assert.equal(c.popularity_hints.viewer_count, 12000);
  assert.equal(c.popularity_hints.league_tier, 1);
});

test('getCandidateMatchesForDate: all valid in-scope matches for date are returned', () => {
  const matches = [
    makeRawMatch({ id: 1, startsAt: '2026-07-03T12:00:00.000Z' }),
    makeRawMatch({ id: 2, startsAt: '2026-07-03T15:00:00.000Z' }),
    makeRawMatch({ id: 3, startsAt: '2026-07-03T18:00:00.000Z' }),
    makeRawMatch({ id: 4, startsAt: '2026-07-04T12:00:00.000Z' }), // different date
  ];
  const result = getCandidateMatchesForDate({
    allMatches: matches,
    userLeagueScope: SCOPE_WITH_LEAGUE,
    targetDateMsk: TARGET_DATE,
    nowMs: NOW_BEFORE,
  });
  assert.equal(result.length, 3);
  const ids = result.map(c => c.match_id).sort();
  assert.deepEqual(ids, ['1', '2', '3']);
});
