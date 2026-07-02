const test = require('node:test');
const assert = require('node:assert/strict');

const homeRoutes = require('../../webapp/routes/home/index.js');

const { makeCacheKey, getDayRange } = homeRoutes.__private;

test('makeCacheKey includes day date to avoid cross-midnight stale today/tomorrow cache reuse', () => {
  const leagueIds = [235, 1, 2];

  const todayKey = makeCacheKey('tomorrow', leagueIds, '2026-07-02');
  const nextDayKey = makeCacheKey('tomorrow', leagueIds, '2026-07-03');

  assert.notEqual(todayKey, nextDayKey);
  assert.equal(todayKey, 'tomorrow:2026-07-02:1,2,235');
  assert.equal(nextDayKey, 'tomorrow:2026-07-03:1,2,235');
});

test('getDayRange keeps explicit Moscow offset in SStats query window', () => {
  assert.deepEqual(getDayRange('2026-07-02'), {
    from: '2026-07-02T00:00:00+03:00',
    to: '2026-07-02T23:59:59+03:00',
  });
});
