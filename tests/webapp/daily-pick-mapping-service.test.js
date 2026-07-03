'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakePg } = require('./testHelpers');
const {
  resolveSystemIdForDailyPickSource,
  resolveSportIdBySportSlug,
  resolveTournamentIdForCandidate,
  resolveDbContextForCandidate,
} = require('../../webapp/services/dailyPickMappingService');

function makeCandidate(overrides = {}) {
  return {
    sport_slug: 'csgo',
    league_slug: 'cct-south-america-series-3-',
    external_league_id: 'ps-4842-cct-south-america-series-3',
    ...overrides,
  };
}

test('resolveSystemIdForDailyPickSource: resolves sstats by default', async () => {
  const pg = createFakePg({ rows: [{ system_id: 3 }] });
  const result = await resolveSystemIdForDailyPickSource(pg);
  assert.equal(result, 3);
  assert.match(pg.calls[0].query, /FROM external\.system/i);
  assert.deepEqual(pg.calls[0].params, ['sstats']);
});

test('resolveSystemIdForDailyPickSource: throws when systemName is empty', async () => {
  const pg = createFakePg();
  await assert.rejects(
    () => resolveSystemIdForDailyPickSource(pg, { systemName: '' }),
    /systemName is required/,
  );
  assert.equal(pg.calls.length, 0);
});

test('resolveSportIdBySportSlug: resolves by public.sport.sport_url', async () => {
  const pg = createFakePg({ rows: [{ sport_id: 10 }] });
  const result = await resolveSportIdBySportSlug(pg, { sportSlug: 'csgo' });
  assert.equal(result, 10);
  assert.match(pg.calls[0].query, /FROM public\.sport/i);
  assert.deepEqual(pg.calls[0].params, ['csgo']);
});

test('resolveSportIdBySportSlug: throws when sportSlug is missing', async () => {
  const pg = createFakePg();
  await assert.rejects(
    () => resolveSportIdBySportSlug(pg, { sportSlug: '' }),
    /sportSlug is required/,
  );
  assert.equal(pg.calls.length, 0);
});

test('resolveTournamentIdForCandidate: prefers external league id before slug', async () => {
  const pg = createFakePg({
    handler(query, params) {
      if (/system_tournament_id/i.test(query)) return [{ tournament_id: 321 }];
      if (/system_tournament_slug/i.test(query)) return [{ tournament_id: 654 }];
      return [];
    },
  });

  const result = await resolveTournamentIdForCandidate(pg, { systemId: 3, candidate: makeCandidate() });
  assert.equal(result, 321);
  assert.equal(pg.calls.length, 1);
  assert.match(pg.calls[0].query, /system_tournament_id/i);
  assert.deepEqual(pg.calls[0].params, [3, 'ps-4842-cct-south-america-series-3']);
});

test('resolveTournamentIdForCandidate: falls back to league_slug when external id misses', async () => {
  const pg = createFakePg({
    handler(query) {
      if (/system_tournament_id/i.test(query)) return [];
      if (/system_tournament_slug/i.test(query)) return [{ tournament_id: 654 }];
      return [];
    },
  });

  const result = await resolveTournamentIdForCandidate(pg, {
    systemId: 3,
    candidate: makeCandidate(),
  });

  assert.equal(result, 654);
  assert.equal(pg.calls.length, 2);
  assert.match(pg.calls[0].query, /system_tournament_id/i);
  assert.match(pg.calls[1].query, /system_tournament_slug/i);
  assert.deepEqual(pg.calls[1].params, [3, 'cct-south-america-series-3-']);
});

test('resolveTournamentIdForCandidate: returns null when neither external id nor slug resolves', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await resolveTournamentIdForCandidate(pg, {
    systemId: 3,
    candidate: makeCandidate(),
  });
  assert.equal(result, null);
  assert.equal(pg.calls.length, 2);
});

test('resolveTournamentIdForCandidate: skips external-id query when candidate has no external_league_id', async () => {
  const pg = createFakePg({ rows: [{ tournament_id: 777 }] });
  const result = await resolveTournamentIdForCandidate(pg, {
    systemId: 3,
    candidate: makeCandidate({ external_league_id: null }),
  });
  assert.equal(result, 777);
  assert.equal(pg.calls.length, 1);
  assert.match(pg.calls[0].query, /system_tournament_slug/i);
});

test('resolveTournamentIdForCandidate: throws on missing systemId', async () => {
  const pg = createFakePg();
  await assert.rejects(
    () => resolveTournamentIdForCandidate(pg, { candidate: makeCandidate() }),
    /systemId is required/,
  );
  assert.equal(pg.calls.length, 0);
});

test('resolveTournamentIdForCandidate: throws on missing candidate', async () => {
  const pg = createFakePg();
  await assert.rejects(
    () => resolveTournamentIdForCandidate(pg, { systemId: 3, candidate: null }),
    /candidate is required/,
  );
  assert.equal(pg.calls.length, 0);
});

test('resolveDbContextForCandidate: resolves full db context', async () => {
  const pg = createFakePg({
    handler(query) {
      if (/FROM external\.system/i.test(query)) return [{ system_id: 3 }];
      if (/FROM public\.sport/i.test(query)) return [{ sport_id: 10 }];
      if (/system_tournament_id/i.test(query)) return [{ tournament_id: 321 }];
      return [];
    },
  });

  const result = await resolveDbContextForCandidate(pg, {
    systemName: 'sstats',
    candidate: makeCandidate(),
  });

  assert.deepEqual(result, {
    systemId: 3,
    sportId: 10,
    tournamentId: 321,
  });
  assert.equal(pg.calls.length, 3);
});

test('resolveDbContextForCandidate: returns null ids when system is missing', async () => {
  const pg = createFakePg({ rows: [] });
  const result = await resolveDbContextForCandidate(pg, {
    systemName: 'sstats',
    candidate: makeCandidate(),
  });
  assert.deepEqual(result, {
    systemId: null,
    sportId: null,
    tournamentId: null,
  });
  assert.equal(pg.calls.length, 1);
});

test('resolveDbContextForCandidate: returns null sportId when candidate has no sport_slug', async () => {
  const pg = createFakePg({
    handler(query) {
      if (/FROM external\.system/i.test(query)) return [{ system_id: 3 }];
      if (/system_tournament_id/i.test(query)) return [{ tournament_id: 321 }];
      return [];
    },
  });

  const result = await resolveDbContextForCandidate(pg, {
    candidate: makeCandidate({ sport_slug: '' }),
  });

  assert.deepEqual(result, {
    systemId: 3,
    sportId: null,
    tournamentId: 321,
  });
  assert.equal(pg.calls.length, 2);
});

test('resolveDbContextForCandidate: throws on missing candidate', async () => {
  const pg = createFakePg();
  await assert.rejects(
    () => resolveDbContextForCandidate(pg, { candidate: null }),
    /candidate is required/,
  );
  assert.equal(pg.calls.length, 0);
});
