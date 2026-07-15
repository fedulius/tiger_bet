const test = require('node:test');
const assert = require('node:assert/strict');

const homeRoutes = require('../../webapp/routes/home/index.js');

const { CACHE_TTL, makeCacheKey, getDayRange, resolveCacheTtl, collectSstatsMatchIds, markFollowedMatches } = homeRoutes.__private;

test('makeCacheKey includes day date to avoid cross-midnight stale today/tomorrow cache reuse', () => {
  const leagueIds = [235, 1, 2];

  const todayKey = makeCacheKey('tomorrow', leagueIds, '2026-07-02');
  const nextDayKey = makeCacheKey('tomorrow', leagueIds, '2026-07-03');

  assert.notEqual(todayKey, nextDayKey);
  assert.equal(todayKey, 'tomorrow:2026-07-02:1,2,235');
  assert.equal(nextDayKey, 'tomorrow:2026-07-03:1,2,235');
});

test('yesterday home cache refreshes quickly only while yesterday still has live matches', () => {
  const now = new Date('2026-07-15T09:00:00.000Z'); // 12:00 in Moscow
  const leaguesWithLiveMatch = [{ matches: [{ status: 3 }] }];

  assert.equal(resolveCacheTtl('yesterday', leaguesWithLiveMatch, now), 60 * 1000);
});

test('yesterday home cache is kept until Moscow day end when all matches are finished', () => {
  const now = new Date('2026-07-15T09:00:00.000Z'); // 12:00 in Moscow
  const finishedLeagues = [{ matches: [{ status: 8 }, { status: 9 }] }];

  assert.equal(resolveCacheTtl('yesterday', finishedLeagues, now), 12 * 60 * 60 * 1000);
  assert.equal(CACHE_TTL.today, 15 * 1000);
  assert.equal(CACHE_TTL.tomorrow, 24 * 60 * 60 * 1000);
});

test('getDayRange keeps explicit Moscow offset in SStats query window', () => {
  assert.deepEqual(getDayRange('2026-07-02'), {
    from: '2026-07-02T00:00:00+03:00',
    to: '2026-07-02T23:59:59+03:00',
  });
});

test('collectSstatsMatchIds returns unique string ids from grouped leagues', () => {
  assert.deepEqual(collectSstatsMatchIds([
    { matches: [{ id: 10 }, { id: '11' }] },
    { matches: [{ id: 10 }, { id: null }, {}] },
  ]), ['10', '11']);
});

test('markFollowedMatches annotates only active followed matches for current user', async () => {
  const leagues = [
    { matches: [{ id: 10 }, { id: 11 }] },
    { matches: [{ id: 12 }] },
  ];
  const calls = [];
  const pg = {
    connection: async (query, params) => {
      calls.push({ query, params });
      return [{ system_match_id: '11' }];
    },
  };

  await markFollowedMatches(pg, 42, leagues);

  assert.equal(leagues[0].matches[0].isFollowed, false);
  assert.equal(leagues[0].matches[1].isFollowed, true);
  assert.equal(leagues[1].matches[0].isFollowed, false);
  assert.deepEqual(calls[0].params, [42, ['10', '11', '12']]);
  assert.match(calls[0].query, /public\.match_follow/);
  assert.match(calls[0].query, /external\.public_match/);
});
