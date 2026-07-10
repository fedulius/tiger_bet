'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createFakePg } = require('./testHelpers');
const {
  buildExternalSourceId,
  persistBundleSnapshot,
  buildAnalysisHash,
  persistAnalysisSnapshot,
} = require('../../webapp/services/dailyPickPersistenceService');

function makeCandidate(overrides = {}) {
  return {
    match_id: 'match-99',
    match_slug: 'team-a-team-b-2026-07-05',
    home_team: 'Team A',
    away_team: 'Team B',
    starts_at: '2026-07-05T17:00:00.000Z',
    ...overrides,
  };
}

function makeSourcePayload(overrides = {}) {
  return {
    source_hash: 'deadbeef',
    source_mode: 'full',
    top_bets: [],
    ...overrides,
  };
}

const BASE_IDS = { systemId: 7, sportId: 3, tournamentId: 42 };

function makeSplitPg() {
  return createFakePg({
    handler(query) {
      if (query.includes('match_create')) return [{ id: 'db-match-1' }];
      if (query.includes('match_source_create')) return [{ id: 'db-src-1' }];
      return [];
    },
  });
}

function findCall(pg, pattern) {
  const call = pg.calls.find(({ query }) => pattern.test(query));
  assert.ok(call, `Expected SQL call matching ${pattern}`);
  return call;
}

// ── buildExternalSourceId ─────────────────────────────────────────────────────

describe('buildExternalSourceId', () => {
  it('produces deterministic bundle:<systemId>:<matchId>:<sourceHash>', () => {
    assert.equal(buildExternalSourceId(7, 'match-99', 'deadbeef'), 'bundle:7:match-99:deadbeef');
  });

  it('is stable across calls with the same args', () => {
    assert.equal(buildExternalSourceId(1, 'x', 'h'), buildExternalSourceId(1, 'x', 'h'));
  });

  it('differs when any component differs', () => {
    const base = buildExternalSourceId(1, 'x', 'h');
    assert.notEqual(buildExternalSourceId(2, 'x', 'h'), base);
    assert.notEqual(buildExternalSourceId(1, 'y', 'h'), base);
    assert.notEqual(buildExternalSourceId(1, 'x', 'z'), base);
  });
});

// ── persistBundleSnapshot – SQL call order ───────────────────────────────────

describe('persistBundleSnapshot – SQL call order', () => {
  it('checks existing external match before creating match/source', async () => {
    const pg = makeSplitPg();
    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(pg.calls.length, 3);
    assert.match(pg.calls[0].query, /external\.public_match/);
    assert.match(pg.calls[1].query, /match_create/);
    assert.match(pg.calls[2].query, /match_source_create/);
  });

  it('reuses existing external match and skips match_create', async () => {
    const pg = createFakePg({
      handler(query) {
        if (/external\.public_match/.test(query)) return [{ match_id: 'existing-match' }];
        if (/match_source_create/.test(query)) return [{ id: 'db-src-1' }];
        if (/match_create/.test(query)) throw new Error('match_create should not be called');
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.matchId, 'existing-match');
    assert.equal(pg.calls.some((call) => /match_create/.test(call.query)), false);
  });
});

// ── persistBundleSnapshot – parameter mapping ────────────────────────────────

describe('persistBundleSnapshot – parameter mapping', () => {
  it('maps match_create parameters in correct positions', async () => {
    const pg = createFakePg({ rows: [{ id: 'db-m' }] });
    const candidate = makeCandidate();
    const sourcePayload = makeSourcePayload();

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate, sourcePayload });

    const { params } = findCall(pg, /match_create/);
    assert.equal(params[0], 'match-99');                       // in_system_match_id
    assert.equal(params[1], 'team-a-team-b-2026-07-05');      // in_system_match_slug
    assert.equal(params[2], 7);                                // in_system_id
    assert.equal(params[3], 3);                                // in_sport_id
    assert.equal(params[4], 42);                               // in_tournament_id
    assert.equal(params[5], 'Team A');                         // in_home_team
    assert.equal(params[6], 'Team B');                         // in_away_team
    assert.equal(params[7], 'scheduled');                      // in_match_status_name
    assert.equal(params[8], '2026-07-05T17:00:00.000Z');      // in_match_start_at
  });

  it('maps match_source_create parameters in correct positions', async () => {
    const pg = createFakePg({ rows: [{ id: 'db-s' }] });
    const candidate = makeCandidate();
    const sourcePayload = makeSourcePayload();

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate, sourcePayload });

    const { params } = findCall(pg, /match_source_create/);
    assert.equal(params[0], 'bundle:7:match-99:deadbeef');    // in_system_match_source_id
    assert.equal(params[1], '');                               // in_system_match_source_url
    assert.equal(params[2], 7);                                // in_system_id
    assert.equal(params[3], 'match-99');                       // in_system_match_id
    assert.equal(params[4], 'bundle');                         // in_source_type_name
    assert.equal(params[5], 'deadbeef');                       // in_source_hash
    assert.equal(params[6], sourcePayload);                    // in_source_payload (object ref)
  });

  it('uses sourcePayload.source_url when provided', async () => {
    const pg = createFakePg({ rows: [{ id: 'db-s' }] });
    const sourcePayload = makeSourcePayload({ source_url: 'https://example.test/match/99' });

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload });

    assert.equal(findCall(pg, /match_source_create/).params[1], 'https://example.test/match/99');
  });

  it('uses match_status_name=scheduled by default', async () => {
    const pg = createFakePg({ rows: [{ id: 'x' }] });
    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(findCall(pg, /match_create/).params[7], 'scheduled');
  });

  it('uses source_type_name=bundle by default', async () => {
    const pg = createFakePg({ rows: [{ id: 'x' }] });
    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(findCall(pg, /match_source_create/).params[4], 'bundle');
  });

  it('falls back to candidate.id when match_id is absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'x' }] });
    const candidate = makeCandidate({ match_id: undefined, id: 'id-fallback' });

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate, sourcePayload: makeSourcePayload() });

    assert.equal(findCall(pg, /match_create/).params[0], 'id-fallback');
    assert.equal(findCall(pg, /match_source_create/).params[3], 'id-fallback');
  });

  it('falls back to candidate.slug when match_slug is absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'x' }] });
    const candidate = makeCandidate({ match_slug: undefined, slug: 'alt-slug' });

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate, sourcePayload: makeSourcePayload() });

    assert.equal(findCall(pg, /match_create/).params[1], 'alt-slug');
  });

  it('uses null for matchStartAt when starts_at is absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'x' }] });
    const candidate = makeCandidate({ starts_at: undefined });

    await persistBundleSnapshot(pg, { ...BASE_IDS, candidate, sourcePayload: makeSourcePayload() });

    assert.equal(findCall(pg, /match_create/).params[8], null);
  });
});

// ── persistBundleSnapshot – return values ────────────────────────────────────

describe('persistBundleSnapshot – return values', () => {
  it('returns matchId from match_create row', async () => {
    const pg = makeSplitPg();
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.matchId, 'db-match-1');
  });

  it('falls back to match_create scalar return when id/match_id are absent', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ match_create: 'db-m-scalar' }];
        if (query.includes('match_source_create')) return [{ id: 'db-s' }];
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.matchId, 'db-m-scalar');
  });

  it('returns sourceId from match_source_create row', async () => {
    const pg = makeSplitPg();
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.sourceId, 'db-src-1');
  });

  it('returns the deterministic externalSourceId', async () => {
    const pg = makeSplitPg();
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.externalSourceId, 'bundle:7:match-99:deadbeef');
  });

  it('falls back to match_id field when match_create returns no id', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ match_id: 'alt-match-id' }];
        return [{ id: 'src-x' }];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.matchId, 'alt-match-id');
  });

  it('falls back to source_id field when match_source_create returns no id', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ id: 'match-x' }];
        if (query.includes('match_source_create')) return [{ source_id: 'src-alt' }];
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.sourceId, 'src-alt');
  });

  it('falls back to out_match_source_id when id/source_id are absent', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ id: 'match-x' }];
        if (query.includes('match_source_create')) return [{ out_match_source_id: 'src-out' }];
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.sourceId, 'src-out');
  });

  it('falls back to match_source_create scalar return when other keys are absent', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ id: 'match-x' }];
        if (query.includes('match_source_create')) return [{ match_source_create: 'src-scalar' }];
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.sourceId, 'src-scalar');
  });

  it('returns null sourceId when match_source_create returns empty row', async () => {
    const pg = createFakePg({
      handler(query) {
        if (query.includes('match_create')) return [{ id: 'match-x' }];
        return [];
      },
    });
    const result = await persistBundleSnapshot(pg, { ...BASE_IDS, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    assert.equal(result.sourceId, null);
  });
});

// ── buildAnalysisHash ─────────────────────────────────────────────────────────

describe('buildAnalysisHash', () => {
  const base = {
    status: 'ready',
    headline: 'Good pick',
    brief: 'Details here',
    risk_note: 'Low risk',
    recommended_bets: [{ market: 'W1', odds: 1.85 }],
    model_name: 'claude-sonnet-4-6',
    prompt_version: 'v1',
    source_hash: 'deadbeef',
    error: null,
  };

  it('returns a hex string', () => {
    assert.match(buildAnalysisHash(base), /^[0-9a-f]{64}$/);
  });

  it('is stable across calls with the same snapshot', () => {
    assert.equal(buildAnalysisHash(base), buildAnalysisHash({ ...base }));
  });

  it('differs when any field differs', () => {
    const h = buildAnalysisHash(base);
    assert.notEqual(buildAnalysisHash({ ...base, headline: 'Other' }), h);
    assert.notEqual(buildAnalysisHash({ ...base, status: 'skipped' }), h);
    assert.notEqual(buildAnalysisHash({ ...base, error: 'oops' }), h);
  });

  it('treats missing fields as null', () => {
    const withNull = { ...base, risk_note: null };
    const withMissing = { ...base };
    delete withMissing.risk_note;
    assert.equal(buildAnalysisHash(withNull), buildAnalysisHash(withMissing));
  });
});

// ── persistAnalysisSnapshot – SQL call order ─────────────────────────────────

describe('persistAnalysisSnapshot – SQL call order', () => {
  function makeSnapshot(overrides = {}) {
    return { status: 'ready', headline: 'Test', source_hash: 'abc', ...overrides };
  }

  it('makes exactly one db call', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-99', snapshot: makeSnapshot() });
    assert.equal(pg.calls.length, 1);
  });

  it('calls match_analysis_create', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-99', snapshot: makeSnapshot() });
    assert.match(pg.calls[0].query, /match_analysis_create/);
  });
});

// ── persistAnalysisSnapshot – parameter mapping ───────────────────────────────

describe('persistAnalysisSnapshot – parameter mapping', () => {
  it('maps all parameters in correct positions', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    const snapshot = {
      status: 'ready',
      headline: 'Great pick',
      brief: 'Here is the brief',
      risk_note: 'Some risk',
      recommended_bets: [{ market: 'W1' }],
      model_name: 'claude-sonnet-4-6',
      prompt_version: 'v2',
      source_hash: 'abc123',
      analysis_hash: 'provided-hash',
    };

    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-42', snapshot });

    const { params } = pg.calls[0];
    assert.equal(params[0], 'src-42');                           // matchSourceId
    assert.equal(params[1], 'ready');                            // analysis_status_name
    assert.equal(params[2], 'Great pick');                       // headline
    assert.equal(params[3], 'Here is the brief');               // brief
    assert.equal(params[4], 'Some risk');                        // risk_note
    assert.equal(params[5], JSON.stringify([{ market: 'W1' }]));  // recommended_bets
    assert.equal(params[6], 'claude-sonnet-4-6');               // model_name
    assert.equal(params[7], 'v2');                               // prompt_version
    assert.equal(params[8], 'provided-hash');                    // analysis_hash
    assert.equal(params[9], null);                               // error_message
    assert.equal(params[10], null);                              // skip_reason
  });

  it('passes null for absent optional string fields', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: { status: 'ready' } });
    const { params } = pg.calls[0];
    assert.equal(params[2], null);   // headline
    assert.equal(params[3], null);   // brief
    assert.equal(params[4], null);   // risk_note
    assert.equal(params[6], null);   // model_name
    assert.equal(params[7], null);   // prompt_version
  });
});

// ── persistAnalysisSnapshot – defaults ───────────────────────────────────────

describe('persistAnalysisSnapshot – defaults', () => {
  it('defaults status to pending when absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: {} });
    assert.equal(pg.calls[0].params[1], 'pending');
  });

  it('uses pending when explicitly passed', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: { status: 'pending' } });
    assert.equal(pg.calls[0].params[1], 'pending');
  });

  it('maps ready/skipped/failed directly', async () => {
    for (const status of ['ready', 'skipped', 'failed']) {
      const pg = createFakePg({ rows: [{ id: 'an-1' }] });
      await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: { status } });
      assert.equal(pg.calls[0].params[1], status);
    }
  });

  it('defaults recommended_bets to empty array when absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: {} });
    assert.equal(pg.calls[0].params[5], '[]');
  });
});

// ── persistAnalysisSnapshot – hash handling ───────────────────────────────────

describe('persistAnalysisSnapshot – hash handling', () => {
  it('uses provided analysis_hash directly without deriving', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    const snapshot = { status: 'ready', analysis_hash: 'explicit-hash-value' };
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot });
    assert.equal(result.analysisHash, 'explicit-hash-value');
    assert.equal(pg.calls[0].params[8], 'explicit-hash-value');
  });

  it('derives hash from snapshot content when analysis_hash is absent', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    const snapshot = { status: 'ready', headline: 'Pick', source_hash: 'abc' };
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot });
    const expected = buildAnalysisHash(snapshot);
    assert.equal(result.analysisHash, expected);
    assert.equal(pg.calls[0].params[8], expected);
  });

  it('derived hash is stable for equal snapshots', async () => {
    const snapshot = { status: 'ready', headline: 'Same', source_hash: 'xyz' };
    const pg1 = createFakePg({ rows: [{ id: 'a' }] });
    const pg2 = createFakePg({ rows: [{ id: 'a' }] });
    const r1 = await persistAnalysisSnapshot(pg1, { matchSourceId: 's', snapshot });
    const r2 = await persistAnalysisSnapshot(pg2, { matchSourceId: 's', snapshot: { ...snapshot } });
    assert.equal(r1.analysisHash, r2.analysisHash);
  });

  it('derived hash differs for different snapshot content', async () => {
    const pg1 = createFakePg({ rows: [{ id: 'a' }] });
    const pg2 = createFakePg({ rows: [{ id: 'a' }] });
    const r1 = await persistAnalysisSnapshot(pg1, { matchSourceId: 's', snapshot: { headline: 'A' } });
    const r2 = await persistAnalysisSnapshot(pg2, { matchSourceId: 's', snapshot: { headline: 'B' } });
    assert.notEqual(r1.analysisHash, r2.analysisHash);
  });
});

// ── persistAnalysisSnapshot – return values ───────────────────────────────────

describe('persistAnalysisSnapshot – return values', () => {
  it('returns analysisId from row.id', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-99' }] });
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: {} });
    assert.equal(result.analysisId, 'an-99');
  });

  it('falls back to row.analysis_id when id is absent', async () => {
    const pg = createFakePg({ rows: [{ analysis_id: 'an-alt' }] });
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: {} });
    assert.equal(result.analysisId, 'an-alt');
  });

  it('falls back to row.match_analysis_id when id and analysis_id are absent', async () => {
    const pg = createFakePg({ rows: [{ match_analysis_id: 'ma-alt' }] });
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 9001, snapshot: {} });
    assert.equal(result.analysisId, 'ma-alt');
  });

  it('falls back to match_analysis_create scalar return when other keys are absent', async () => {
    const pg = createFakePg({ rows: [{ match_analysis_create: 'ma-scalar' }] });
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 9001, snapshot: {} });
    assert.equal(result.analysisId, 'ma-scalar');
  });

  it('returns null analysisId when db returns empty row', async () => {
    const pg = createFakePg({ rows: [] });
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot: {} });
    assert.equal(result.analysisId, null);
  });

  it('returns analysisHash in result', async () => {
    const pg = createFakePg({ rows: [{ id: 'an-1' }] });
    const snapshot = { analysis_hash: 'my-hash' };
    const result = await persistAnalysisSnapshot(pg, { matchSourceId: 'src-1', snapshot });
    assert.equal(result.analysisHash, 'my-hash');
  });
});

// ── persistAnalysisSnapshot – validation ─────────────────────────────────────

describe('persistAnalysisSnapshot – validation', () => {
  async function expectError(args, pattern) {
    await assert.rejects(
      () => persistAnalysisSnapshot(createFakePg(), args),
      (err) => { assert.match(err.message, pattern); return true; },
    );
  }

  it('throws when matchSourceId is null', async () => {
    await expectError({ matchSourceId: null, snapshot: {} }, /matchSourceId/);
  });

  it('throws when matchSourceId is undefined', async () => {
    await expectError({ snapshot: {} }, /matchSourceId/);
  });

  it('throws when snapshot is missing', async () => {
    await expectError({ matchSourceId: 'src-1' }, /snapshot/);
  });

  it('throws when snapshot is null', async () => {
    await expectError({ matchSourceId: 'src-1', snapshot: null }, /snapshot/);
  });

  it('throws when status is an invalid value', async () => {
    await expectError({ matchSourceId: 'src-1', snapshot: { status: 'unknown' } }, /Invalid analysis status/);
  });

  it('does not call pg when validation fails', async () => {
    const pg = createFakePg();
    try {
      await persistAnalysisSnapshot(pg, { matchSourceId: null, snapshot: {} });
    } catch { /* expected */ }
    assert.equal(pg.calls.length, 0);
  });
});

// ── persistBundleSnapshot – validation ───────────────────────────────────────

describe('persistBundleSnapshot – validation', () => {
  async function expectError(args, pattern) {
    await assert.rejects(
      () => persistBundleSnapshot(createFakePg(), args),
      (err) => { assert.match(err.message, pattern); return true; },
    );
  }

  it('throws when systemId is null', async () => {
    await expectError({ systemId: null, sportId: 1, tournamentId: 1, candidate: makeCandidate(), sourcePayload: makeSourcePayload() }, /systemId/);
  });

  it('throws when systemId is undefined', async () => {
    await expectError({ sportId: 1, tournamentId: 1, candidate: makeCandidate(), sourcePayload: makeSourcePayload() }, /systemId/);
  });

  it('throws when sportId is missing', async () => {
    await expectError({ systemId: 1, tournamentId: 1, candidate: makeCandidate(), sourcePayload: makeSourcePayload() }, /sportId/);
  });

  it('throws when tournamentId is missing', async () => {
    await expectError({ systemId: 1, sportId: 1, candidate: makeCandidate(), sourcePayload: makeSourcePayload() }, /tournamentId/);
  });

  it('throws when candidate is missing', async () => {
    await expectError({ ...BASE_IDS, sourcePayload: makeSourcePayload() }, /candidate/);
  });

  it('throws when candidate is null', async () => {
    await expectError({ ...BASE_IDS, candidate: null, sourcePayload: makeSourcePayload() }, /candidate/);
  });

  it('throws when sourcePayload is missing', async () => {
    await expectError({ ...BASE_IDS, candidate: makeCandidate() }, /sourcePayload/);
  });

  it('throws when candidate has neither match_id nor id', async () => {
    const bad = makeCandidate({ match_id: undefined, id: undefined });
    await expectError({ ...BASE_IDS, candidate: bad, sourcePayload: makeSourcePayload() }, /match_id|id/);
  });

  it('throws when sourcePayload.source_hash is missing', async () => {
    const bad = makeSourcePayload({ source_hash: undefined });
    await expectError({ ...BASE_IDS, candidate: makeCandidate(), sourcePayload: bad }, /source_hash/);
  });

  it('does not call pg when validation fails', async () => {
    const pg = createFakePg();
    try {
      await persistBundleSnapshot(pg, { systemId: null, sportId: 1, tournamentId: 1, candidate: makeCandidate(), sourcePayload: makeSourcePayload() });
    } catch { /* expected */ }
    assert.equal(pg.calls.length, 0);
  });
});
