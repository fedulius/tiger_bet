'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../../webapp/services/matchResolutionService');

function fakePg(handler) {
  const calls = [];
  return {
    calls,
    connection: async (query, params = []) => {
      calls.push({ query, params });
      return (await handler(query, params, calls)) || [];
    },
  };
}

function teamInput(overrides = {}) {
  return {
    systemId: 10,
    systemTeamId: 'sp-arsenal',
    systemTeamSlug: 'arsenal',
    systemTeamName: 'Арсенал FC',
    sportId: 1,
    genderCode: 'male',
    sourcePayload: { provider: 'source' },
    ...overrides,
  };
}

function fixtureInput(overrides = {}) {
  return {
    source: { systemId: 10, matchId: 'source-100', matchSlug: 'arsenal-chelsea', home: teamInput(), away: teamInput({ systemTeamId: 'sp-chelsea', systemTeamSlug: 'chelsea', systemTeamName: 'Chelsea FC' }) },
    target: { systemId: 20, matchId: 'target-200', matchSlug: 'arsenal-chelsea', home: teamInput({ systemId: 20, systemTeamId: 'target-arsenal' }), away: teamInput({ systemId: 20, systemTeamId: 'target-chelsea', systemTeamSlug: 'chelsea', systemTeamName: 'Chelsea FC' }) },
    sportId: 1,
    startAt: '2026-07-22T15:00:00.000Z',
    tournamentId: 99,
    ...overrides,
  };
}

test('normalizes Russian and English provider team labels without collapsing useful distinctions', () => {
  assert.equal(service.normalizeProviderTeamKey('ФК Арсенал (Ж)'), 'arsenal-women');
  assert.equal(service.normalizeProviderTeamKey('FC Arsenal'), 'arsenal');
  assert.equal(service.normalizeProviderTeamKey('Arsenal U21'), 'arsenal-u21');
  assert.notEqual(service.normalizeProviderTeamKey('Arsenal U21'), service.normalizeProviderTeamKey('Arsenal'));
});

test('uses the repository connection(sql, params) wrapper for exact provider identity lookup', async () => {
  const pg = fakePg((query) => /FROM external\.public_team/i.test(query) ? [{ team_id: 101, mapping_confidence: 'exact' }] : []);
  const result = await service.resolveCanonicalTeam(pg, teamInput());
  assert.deepEqual(result, { status: 'resolved', teamId: 101, method: 'provider_id', confidence: 1, details: { systemId: 10, systemTeamId: 'sp-arsenal' } });
  assert.equal(pg.calls.length, 1);
  assert.match(pg.calls[0].query, /\$1/);
  assert.deepEqual(pg.calls[0].params, [10, 'sp-arsenal']);
});

test('resolves provider-scoped aliases before global aliases', async () => {
  const pg = fakePg((query) => {
    if (/FROM external\.public_team/i.test(query)) return [];
    if (/system_id = \$3/i.test(query)) return [{ team_id: 202 }];
    return [{ team_id: 303 }];
  });
  const result = await service.resolveCanonicalTeam(pg, teamInput({ systemTeamId: null, systemTeamName: 'Arsenal FC' }));
  assert.equal(result.status, 'resolved');
  assert.equal(result.teamId, 202);
  assert.equal(result.method, 'provider_alias');
  assert.equal(pg.calls.length, 1);
  assert.ok(!pg.calls.some((call) => /system_id IS NULL/i.test(call.query)));
});

test('resolves a global alias when no provider-scoped alias exists', async () => {
  const pg = fakePg((query) => {
    if (/system_id = \$3/i.test(query)) return [];
    if (/system_id IS NULL/i.test(query)) return [{ team_id: 303 }];
    return [];
  });
  const result = await service.resolveCanonicalTeam(pg, teamInput({ systemTeamId: null, systemTeamName: 'Arsenal FC' }));
  assert.equal(result.status, 'resolved');
  assert.equal(result.teamId, 303);
  assert.equal(result.method, 'global_alias');
});

test('does not create teams or aliases for unresolved canonical teams', async () => {
  const pg = fakePg(() => []);
  const result = await service.resolveCanonicalTeam(pg, teamInput({ systemTeamId: null }));
  assert.equal(result.status, 'unresolved');
  assert.equal(result.method, 'unresolved');
  assert.ok(pg.calls.every((call) => /^\s*SELECT/i.test(call.query)));
});

test('resolves a fixture from an existing exact provider mapping and writes its audit row through connection(sql, params)', async () => {
  const pg = fakePg((query) => /FROM external\.public_match/i.test(query) ? [{ match_id: 700 }] : []);
  const result = await service.resolveProviderFixture(pg, fixtureInput());
  assert.equal(result.status, 'resolved');
  assert.equal(result.matchId, 700);
  assert.equal(result.method, 'existing_match');
  const auditCall = pg.calls.find((call) => /INSERT INTO public\.match_resolution_log/i.test(call.query));
  assert.ok(auditCall);
  assert.deepEqual(auditCall.params.slice(0, 9), [10, 'source-100', 'arsenal-chelsea', 20, 'target-200', 700, 'resolved', 'existing_match', 1]);
});

test('resolves a unique target fixture by canonical pair and time window', async () => {
  const pg = fakePg((query, params) => {
    if (/FROM external\.public_match pm/i.test(query) && /system_match_id = \$2/i.test(query)) return [];
    if (/FROM external\.public_team/i.test(query)) return [{ team_id: params[1].includes('chelsea') ? 2 : 1, mapping_confidence: 'exact' }];
    if (/JOIN public\.match m/i.test(query)) return [{ match_id: 701, system_match_id: 'target-200' }];
    return [];
  });
  const result = await service.resolveProviderFixture(pg, fixtureInput());
  assert.equal(result.status, 'resolved');
  assert.equal(result.matchId, 701);
  assert.equal(result.method, 'canonical_pair_time');
  assert.equal(result.confidence, 0.9);
});

test('returns ambiguous when pair/time target lookup has multiple candidates', async () => {
  const pg = fakePg((query, params) => {
    if (/FROM external\.public_match pm/i.test(query) && /system_match_id = \$2/i.test(query)) return [];
    if (/FROM external\.public_team/i.test(query)) return [{ team_id: params[1].includes('chelsea') ? 2 : 1 }];
    if (/JOIN public\.match m/i.test(query)) return [{ match_id: 701 }, { match_id: 702 }];
    return [];
  });
  const result = await service.resolveProviderFixture(pg, fixtureInput());
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.method, 'canonical_pair_time');
  assert.deepEqual(result.details.candidateMatchIds, [701, 702]);
});

test('does not let a resolution-log write error invalidate a successful resolution', async () => {
  const pg = fakePg((query) => {
    if (/FROM external\.public_match/i.test(query)) return [{ match_id: 700 }];
    if (/INSERT INTO public\.match_resolution_log/i.test(query)) throw new Error('audit unavailable');
    return [];
  });
  const result = await service.resolveProviderFixture(pg, fixtureInput());
  assert.equal(result.status, 'resolved');
  assert.equal(result.matchId, 700);
});

test('bootstraps a canonical pair and exact parameterized provider mappings when target mappings are absent', async () => {
  let nextTeamId = 100;
  const pg = fakePg((query, params) => {
    if (/SELECT pt\.team_id/i.test(query)) return [];
    if (/INSERT INTO public\.team/i.test(query)) return [{ team_id: nextTeamId++ }];
    if (/INSERT INTO external\.public_team/i.test(query)) return [];
    return [];
  });
  const pair = fixtureInput();
  const result = await service.bootstrapCanonicalPair(pg, {
    source: pair.source,
    target: pair.target,
    sportId: 1,
    genderCode: 'male',
    sourcePayload: { proven: 'exact-pair-time' },
  });

  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.homeTeamId, 100);
  assert.deepEqual(result.awayTeamId, 101);
  const teamInserts = pg.calls.filter((call) => /INSERT INTO public\.team/i.test(call.query));
  const mappingInserts = pg.calls.filter((call) => /INSERT INTO external\.public_team/i.test(call.query));
  assert.equal(teamInserts.length, 2);
  assert.equal(mappingInserts.length, 4);
  assert.ok([...teamInserts, ...mappingInserts].every((call) => /\$\d+/.test(call.query)));
  assert.deepEqual(teamInserts[0].params, [1, 'male', 'Арсенал FC', 'arsenal']);
  assert.deepEqual(mappingInserts[0].params, [20, 'target-arsenal', 'arsenal', 'Арсенал FC', 100, JSON.stringify(pair.target.home.sourcePayload)]);
});

test('reuses existing target mappings without creating canonical teams', async () => {
  const pg = fakePg((query, params) => {
    if (/SELECT pt\.team_id/i.test(query)) return [{ team_id: params[1].includes('chelsea') ? 22 : 11 }];
    return [];
  });
  const pair = fixtureInput();
  const result = await service.bootstrapCanonicalPair(pg, { source: pair.source, target: pair.target, sportId: 1 });
  assert.equal(result.status, 'resolved');
  assert.equal(pg.calls.filter((call) => /INSERT INTO public\.team/i.test(call.query)).length, 0);
});

test('uses a normalized slug-prefixed source provider key when the source team has no native id', async () => {
  const pg = fakePg((query, params) => {
    if (/SELECT pt\.team_id/i.test(query)) return params[0] === 10 ? [] : [{ team_id: params[1].includes('chelsea') ? 22 : 11 }];
    return [];
  });
  const pair = fixtureInput({ source: { ...fixtureInput().source, home: teamInput({ systemTeamId: null, systemTeamSlug: 'ФК Арсенал' }) } });
  const result = await service.bootstrapCanonicalPair(pg, { source: pair.source, target: pair.target, sportId: 1 });
  assert.equal(result.status, 'resolved');
  const sourceHomeMapping = pg.calls.find((call) => /INSERT INTO external\.public_team/i.test(call.query) && call.params[0] === 10 && call.params[2] === 'ФК Арсенал');
  assert.ok(sourceHomeMapping);
  assert.equal(sourceHomeMapping.params[1], 'slug:arsenal');
});

test('rejects equal target teams without team or provider mapping writes', async () => {
  const pg = fakePg(() => []);
  const pair = fixtureInput({ target: { ...fixtureInput().target, away: teamInput({ systemId: 20, systemTeamId: 'target-arsenal-duplicate', systemTeamSlug: 'arsenal', systemTeamName: 'Arsenal FC' }) } });
  const result = await service.bootstrapCanonicalPair(pg, { source: pair.source, target: pair.target, sportId: 1 });
  assert.equal(result.status, 'rejected');
  assert.ok(!pg.calls.some((call) => /INSERT INTO public\.team|INSERT INTO external\.public_team/i.test(call.query)));
});

test('returns error rather than resolved when a provider mapping insert fails', async () => {
  const pg = fakePg((query, params) => {
    if (/SELECT pt\.team_id/i.test(query)) return params[0] === 10 ? [] : [{ team_id: params[1].includes('chelsea') ? 22 : 11 }];
    if (/INSERT INTO external\.public_team/i.test(query)) throw new Error('mapping insert failed');
    return [];
  });
  const pair = fixtureInput();
  const result = await service.bootstrapCanonicalPair(pg, { source: pair.source, target: pair.target, sportId: 1 });
  assert.equal(result.status, 'error');
  assert.notEqual(result.status, 'resolved');
});
