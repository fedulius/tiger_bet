const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const api = require('../../lib/stavkaApi');
const LIVE_OPTS = { redisClient: null };

// --- humanReadable tests ---

describe('humanReadable', () => {
  it('returns label for one_x_two/w2', () => {
    assert.equal(api.humanReadable('one_x_two', 'w2'), 'Победа гостей');
  });

  it('returns label for one_x_two/x', () => {
    assert.equal(api.humanReadable('one_x_two', 'x'), 'Ничья');
  });

  it('returns label for total_over with numeric outcome', () => {
    assert.equal(api.humanReadable('total_over', '2_5'), 'Тотал больше 2.5');
  });

  it('returns label for total_under', () => {
    assert.equal(api.humanReadable('total_under', '3'), 'Тотал меньше 3');
  });

  it('returns label for both_to_score/yes', () => {
    assert.equal(api.humanReadable('both_to_score', 'yes'), 'Обе забьют — да');
  });

  it('returns label for handicap2 with value', () => {
    assert.equal(api.humanReadable('handicap2', '-1_5'), 'Фора гостей (-1.5)');
  });

  it('returns label for correct_score', () => {
    assert.equal(api.humanReadable('correct_score', '1:2'), 'Точный счёт 1:2');
  });

  it('returns label for double_chance/x1', () => {
    assert.equal(api.humanReadable('double_chance', 'x1'), '1X (хозяева не проиграют)');
  });

  it('returns label for yellow_cards_one_x_two', () => {
    assert.equal(api.humanReadable('yellow_cards_one_x_two', 'w1'), 'Больше жёлтых — хозяева');
  });

  it('returns null for unknown type', () => {
    assert.equal(api.humanReadable('custom', 'something'), null);
  });

  it('returns null for null inputs', () => {
    assert.equal(api.humanReadable(null, null), null);
    assert.equal(api.humanReadable('one_x_two', null), null);
    assert.equal(api.humanReadable(null, 'w1'), null);
  });
});

// --- resolveSport tests ---

describe('resolveSport', () => {
  it('maps soccer to sport_id 1', () => {
    const result = api.resolveSport('soccer');
    assert.equal(result.sport_id, 1);
    assert.equal(result.sport_name, 'Футбол');
  });

  it('maps tennis to sport_id 3', () => {
    assert.equal(api.resolveSport('tennis').sport_id, 3);
  });

  it('maps csgo to sport_id 10', () => {
    assert.equal(api.resolveSport('csgo').sport_id, 10);
  });

  it('returns null sport_id for unknown slug', () => {
    const result = api.resolveSport('unknown-sport');
    assert.equal(result.sport_id, null);
    assert.equal(result.sport_name, 'unknown-sport');
  });

  it('has 14 sports in SPORT_MAP', () => {
    assert.equal(Object.keys(api.SPORT_MAP).length, 14);
  });
});

// --- groupBetsByType tests ---

describe('groupBetsByType', () => {
  it('groups bets by type and picks top per group', () => {
    const input = {
      meta: { total: 100 },
      data: [
        { type: 'one_x_two', outcome: 'w2', count: 84, rate: 1.72, percent: 15 },
        { type: 'one_x_two', outcome: 'x', count: 12, rate: 3.58, percent: 2 },
        { type: 'one_x_two', outcome: 'w1', count: 7, rate: 5.9, percent: 1 },
        { type: 'both_to_score', outcome: 'yes', count: 65, rate: 2.15, percent: 12 },
        { type: 'total_over', outcome: '2_5', count: 52, rate: 2.22, percent: 9 },
      ],
    };

    const result = api.groupBetsByType(input);

    // Should have 3 groups
    assert.equal(result.length, 3);

    // Sorted by count DESC
    assert.equal(result[0].type, 'one_x_two');
    assert.equal(result[0].outcome, 'w2');
    assert.equal(result[0].count, 84);
    assert.equal(result[0].label, 'Победа гостей');

    assert.equal(result[1].type, 'both_to_score');
    assert.equal(result[1].outcome, 'yes');
    assert.equal(result[1].count, 65);
    assert.equal(result[1].label, 'Обе забьют — да');

    assert.equal(result[2].type, 'total_over');
    assert.equal(result[2].outcome, '2_5');
    assert.equal(result[2].count, 52);
    assert.equal(result[2].label, 'Тотал больше 2.5');
  });

  it('returns empty array for null input', () => {
    assert.deepEqual(api.groupBetsByType(null), []);
    assert.deepEqual(api.groupBetsByType({}), []);
    assert.deepEqual(api.groupBetsByType({ data: [] }), []);
  });

  it('skips bets without type or outcome', () => {
    const input = {
      data: [
        { type: 'one_x_two', outcome: 'w2', count: 10, rate: 1.5 },
        { type: null, outcome: 'w1', count: 5, rate: 2.0 },
        { type: 'total_over', outcome: null, count: 3, rate: 1.8 },
      ],
    };
    const result = api.groupBetsByType(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'one_x_two');
  });
});

describe('selectRiskBets', () => {
  it('returns 3 bets with different types and gap >= 1.2', () => {
    const input = {
      data: [
        { type: 'one_x_two', outcome: 'w2', count: 99, rate: 1.73 },
        { type: 'both_to_score', outcome: 'yes', count: 76, rate: 2.14 },
        { type: 'total_over', outcome: '2_5', count: 56, rate: 2.22 },
        { type: 'handicap2', outcome: '-1_5', count: 53, rate: 2.96 },
        { type: 'correct_score', outcome: '1:2', count: 12, rate: 8.4 },
      ],
    };
    const result = api.selectRiskBets(input, { minCount: 10 });
    assert.equal(result.length, 3);
    assert.equal(result[0].risk_label, 'low');
    assert.equal(result[1].risk_label, 'medium');
    assert.equal(result[2].risk_label, 'high');
    assert.ok(result[1].rate >= result[0].rate + 1.2, 'medium gap');
    assert.ok(result[2].rate >= result[1].rate + 1.2, 'high gap');
    assert.notEqual(result[0].type, result[1].type);
    assert.notEqual(result[1].type, result[2].type);
  });

  it('skips low-count bets', () => {
    const input = {
      data: [
        { type: 'handicap1', outcome: '1_5', count: 3, rate: 1.3 },
        { type: 'one_x_two', outcome: 'w2', count: 50, rate: 1.7 },
        { type: 'total_over', outcome: '2_5', count: 30, rate: 3.0 },
        { type: 'correct_score', outcome: '1:2', count: 15, rate: 8.0 },
      ],
    };
    const result = api.selectRiskBets(input, { minCount: 10 });
    assert.equal(result[0].type, 'one_x_two');
    assert.equal(result[0].count, 50);
  });

  it('returns empty for null input', () => {
    assert.deepEqual(api.selectRiskBets(null), []);
  });
});

// --- API integration tests (live, skip in CI) ---

describe('fetchAllMatches (live)', { skip: process.env.SKIP_LIVE_TESTS ? 'live test' : false }, () => {
  it('returns array of matches with > 200 items', async () => {
    api._resetRateLimiter();
    const matches = await api.fetchAllMatches(LIVE_OPTS);
    assert.ok(Array.isArray(matches), 'should return array');
    assert.ok(matches.length > 200, 'should have > 200 matches, got ' + matches.length);
  });

  it('matches have required fields', async () => {
    api._resetRateLimiter();
    const matches = await api.fetchAllMatches(LIVE_OPTS);
    const first = matches[0];
    assert.ok(first.id, 'should have id');
    assert.ok(first.slug, 'should have slug');
    assert.ok(first.sportSlug, 'should have sportSlug');
    assert.ok(first.matchDate, 'should have matchDate');
    assert.ok(first.teams, 'should have teams');
    assert.ok(first.league, 'should have league');
  });

  it('matches with odds have one_x_two structure', async () => {
    api._resetRateLimiter();
    const matches = await api.fetchAllMatches(LIVE_OPTS);
    const withOdds = matches.filter(m => m.odds && m.odds.one_x_two);
    assert.ok(withOdds.length > 100, 'should have > 100 matches with odds');

    const first = withOdds[0];
    const odds = first.odds.one_x_two;
    assert.ok(odds.w1 || odds.w2 || odds.x, 'should have at least one outcome');
  });
});

describe('fetchPopularBets (live)', { skip: process.env.SKIP_LIVE_TESTS ? 'live test' : false }, () => {
  it('returns popular bets for Uruguay vs Spain', async () => {
    api._resetRateLimiter();
    const bets = await api.fetchPopularBets('27-06-2026-uruguay-spain', LIVE_OPTS);
    assert.ok(bets, 'should return data');
    assert.ok(bets.meta && bets.meta.total > 100, 'should have > 100 total bets');
    assert.ok(Array.isArray(bets.data), 'data should be array');
    assert.ok(bets.data.length > 10, 'should have > 10 bet types');
  });

  it('popular bets have required fields', async () => {
    api._resetRateLimiter();
    const bets = await api.fetchPopularBets('27-06-2026-uruguay-spain', LIVE_OPTS);
    const first = bets.data[0];
    assert.ok(first.type, 'should have type');
    assert.ok(first.outcome, 'should have outcome');
    assert.ok(typeof first.count === 'number', 'should have count');
    assert.ok(typeof first.rate === 'number', 'should have rate');
  });

  it('groupBetsByType produces diverse types from live data', async () => {
    api._resetRateLimiter();
    const bets = await api.fetchPopularBets('27-06-2026-uruguay-spain', LIVE_OPTS);
    const grouped = api.groupBetsByType(bets);
    assert.ok(grouped.length >= 5, 'should have >= 5 different market types');

    // Top 3 should be different types
    const types = grouped.slice(0, 3).map(g => g.type);
    const uniqueTypes = [...new Set(types)];
    assert.equal(uniqueTypes.length, 3, 'top 3 should be different market types');
  });
});

describe('fetchMatchDetail (live)', { skip: process.env.SKIP_LIVE_TESTS ? 'live test' : false }, () => {
  it('returns match detail with predictionSummary', async () => {
    api._resetRateLimiter();
    const detail = await api.fetchMatchDetail('27-06-2026-uruguay-spain', LIVE_OPTS);
    assert.ok(detail, 'should return data');
    assert.equal(detail.teams.home.name, 'Уругвай');
    assert.equal(detail.teams.away.name, 'Испания');
    assert.ok(detail.predictionSummary, 'should have predictionSummary');
    assert.ok(detail.league.name, 'should have league name');
  });

  it('pastMatches are available', async () => {
    api._resetRateLimiter();
    const detail = await api.fetchMatchDetail('27-06-2026-uruguay-spain', LIVE_OPTS);
    assert.ok(Array.isArray(detail.teams.home.pastMatches), 'home pastMatches should be array');
    assert.ok(detail.teams.home.pastMatches.length >= 3, 'should have >= 3 past matches');
  });
});
