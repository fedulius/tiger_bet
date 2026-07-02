'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyPickAnalysisInput, analyzeMatches } = require('../../webapp/services/dailyPickAnalysisService');

// ── helpers ────────────────────────────────────────────────────────────────

function makeCandidate(overrides = {}) {
  return {
    id: '42',
    match_id: '42',
    match_slug: 'real-madrid-barcelona-2026-07-05',
    sport_slug: 'football',
    home_team: 'Real Madrid',
    away_team: 'Barcelona',
    starts_at: '2026-07-05T17:00:00.000Z',
    date_msk: '2026-07-05',
    ...overrides,
  };
}

function makeSourcePayload(overrides = {}) {
  return {
    match_id: '42',
    match_slug: 'real-madrid-barcelona-2026-07-05',
    source_mode: 'full',
    source_hash: 'abc123',
    top_bets: [],
    risk_bets: [],
    ...overrides,
  };
}

function makeGenResult(overrides = {}) {
  return {
    status: 'ready',
    output: {
      headline: 'El Clásico preview',
      brief: 'Real Madrid are heavy favourites.',
      risk_note: 'High odds variance.',
    },
    model_name: 'gpt-4o-mini',
    prompt_version: 'ai-brief-v1',
    ...overrides,
  };
}

// ── buildDailyPickAnalysisInput ────────────────────────────────────────────

describe('buildDailyPickAnalysisInput', () => {
  it('returns a normalised input object from match + sourcePayload', () => {
    const match = makeCandidate();
    const sourcePayload = makeSourcePayload();
    const input = buildDailyPickAnalysisInput({ match, sourcePayload });

    assert.equal(input.match_id, '42');
    assert.equal(input.match_slug, 'real-madrid-barcelona-2026-07-05');
    assert.equal(input.sport_slug, 'football');
    assert.equal(input.home_team, 'Real Madrid');
    assert.equal(input.away_team, 'Barcelona');
    assert.equal(input.source_mode, 'full');
    assert.equal(input.source_hash, 'abc123');
    assert.deepEqual(input.source_payload, sourcePayload);
  });

  it('falls back to match.id when match_id is absent', () => {
    const match = makeCandidate({ match_id: undefined });
    const input = buildDailyPickAnalysisInput({ match, sourcePayload: makeSourcePayload() });
    assert.equal(input.match_id, '42');
  });

  it('falls back to match.slug when match_slug is absent', () => {
    const match = makeCandidate({ match_slug: undefined, slug: 'fallback-slug' });
    const input = buildDailyPickAnalysisInput({ match, sourcePayload: makeSourcePayload() });
    assert.equal(input.match_slug, 'fallback-slug');
  });
});

// ── analyzeMatches ─────────────────────────────────────────────────────────

describe('analyzeMatches — happy path', () => {
  it('generates a ready snapshot for a matched candidate', async () => {
    const candidate = makeCandidate();
    const candidatesByUserId = { u1: [candidate] };
    const existingSnapshots = new Map();
    const sourceBuilder = async () => makeSourcePayload();
    const generator = async () => makeGenResult();

    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId,
      existingSnapshots,
      sourceBuilder,
      generator,
      modelName: 'gpt-4o-mini',
      promptVersion: 'ai-brief-v1',
    });

    assert.equal(results.length, 1);
    const snap = results[0];
    assert.equal(snap.match_id, '42');
    assert.equal(snap.match_slug, 'real-madrid-barcelona-2026-07-05');
    assert.equal(snap.status, 'ready');
    assert.equal(snap.source_mode, 'full');
    assert.equal(snap.source_hash, 'abc123');
    assert.equal(snap.headline, 'El Clásico preview');
    assert.equal(snap.brief, 'Real Madrid are heavy favourites.');
    assert.equal(snap.risk_note, 'High odds variance.');
    assert.ok(snap.generated_at);
  });
});

describe('analyzeMatches — existing snapshot skips generation', () => {
  it('does not call sourceBuilder or generator for a match already in existingSnapshots', async () => {
    let sourceCalls = 0;
    let generatorCalls = 0;
    const candidate = makeCandidate();
    const candidatesByUserId = { u1: [candidate] };
    const existingSnapshots = new Map([['42', { match_id: '42', status: 'ready' }]]);

    await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId,
      existingSnapshots,
      sourceBuilder: async () => { sourceCalls++; return makeSourcePayload(); },
      generator: async () => { generatorCalls++; return makeGenResult(); },
    });

    assert.equal(sourceCalls, 0, 'sourceBuilder must not be called for existing snapshot');
    assert.equal(generatorCalls, 0, 'generator must not be called for existing snapshot');
  });

  it('returns empty array when all matchIds already have snapshots', async () => {
    const existingSnapshots = new Map([['42', { match_id: '42', status: 'ready' }]]);
    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId: { u1: [makeCandidate()] },
      existingSnapshots,
      sourceBuilder: async () => makeSourcePayload(),
      generator: async () => makeGenResult(),
    });
    assert.equal(results.length, 0);
  });
});

describe('analyzeMatches — sourceBuilder skip does not call generator', () => {
  it('returns skipped snapshot when sourceBuilder returns source_mode=skip', async () => {
    let generatorCalls = 0;
    const candidate = makeCandidate();
    const skipPayload = {
      source_mode: 'skip',
      skip_reason: 'insufficient_data',
      source_hash: 'skipHash',
    };

    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId: { u1: [candidate] },
      existingSnapshots: new Map(),
      sourceBuilder: async () => skipPayload,
      generator: async () => { generatorCalls++; return makeGenResult(); },
    });

    assert.equal(generatorCalls, 0, 'generator must not be called when source is skip');
    assert.equal(results.length, 1);
    const snap = results[0];
    assert.equal(snap.status, 'skipped');
    assert.equal(snap.source_mode, 'skip');
    assert.equal(snap.skip_reason, 'insufficient_data');
    assert.equal(snap.source_hash, 'skipHash');
  });
});

describe('analyzeMatches — candidate lookup', () => {
  it('finds candidate correctly across multiple users', async () => {
    const c1 = makeCandidate({ id: '10', match_id: '10', match_slug: 'match-10' });
    const c2 = makeCandidate({ id: '42', match_id: '42', match_slug: 'match-42' });
    const candidatesByUserId = { u1: [c1], u2: [c2] };

    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId,
      existingSnapshots: new Map(),
      sourceBuilder: async () => makeSourcePayload({ match_slug: 'match-42' }),
      generator: async () => makeGenResult(),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].match_slug, 'match-42');
  });

  it('produces a failed snapshot when no candidate is found', async () => {
    const results = await analyzeMatches({
      matchIds: ['99'],
      candidatesByUserId: { u1: [makeCandidate({ id: '1', match_id: '1' })] },
      existingSnapshots: new Map(),
      sourceBuilder: async () => makeSourcePayload(),
      generator: async () => makeGenResult(),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].match_id, '99');
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error, 'no_candidate');
  });
});

describe('analyzeMatches — generator failure', () => {
  it('produces a failed snapshot when generator throws', async () => {
    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId: { u1: [makeCandidate()] },
      existingSnapshots: new Map(),
      sourceBuilder: async () => makeSourcePayload(),
      generator: async () => { throw new Error('llm_timeout'); },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error, 'llm_timeout');
    assert.equal(results[0].source_hash, 'abc123');
  });

  it('produces a failed snapshot when generator returns non-ready status', async () => {
    const results = await analyzeMatches({
      matchIds: ['42'],
      candidatesByUserId: { u1: [makeCandidate()] },
      existingSnapshots: new Map(),
      sourceBuilder: async () => makeSourcePayload(),
      generator: async () => ({ status: 'failed', error: 'invalid_json_output' }),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error, 'invalid_json_output');
  });
});

describe('analyzeMatches — multiple matchIds processed independently', () => {
  it('handles a mix of ready, skipped, and failed independently', async () => {
    const candidates = {
      u1: [
        makeCandidate({ id: '1', match_id: '1', match_slug: 'match-1' }),
        makeCandidate({ id: '2', match_id: '2', match_slug: 'match-2' }),
        // match-3 deliberately missing so candidate lookup fails
      ],
    };

    const sourceBuilder = async (match) => {
      if (match.match_id === '2') {
        return { source_mode: 'skip', skip_reason: 'insufficient_data', source_hash: 'sh2' };
      }
      return makeSourcePayload({ match_id: match.match_id, match_slug: match.match_slug, source_hash: 'sh1' });
    };

    const generator = async ({ sourcePayload }) => {
      return makeGenResult({ output: { headline: `H:${sourcePayload.match_id}`, brief: 'ok', risk_note: null } });
    };

    const results = await analyzeMatches({
      matchIds: ['1', '2', '3'],
      candidatesByUserId: candidates,
      existingSnapshots: new Map(),
      sourceBuilder,
      generator,
    });

    assert.equal(results.length, 3);

    const r1 = results.find(r => r.match_id === '1');
    assert.equal(r1.status, 'ready');
    assert.equal(r1.headline, 'H:1');

    const r2 = results.find(r => r.match_id === '2');
    assert.equal(r2.status, 'skipped');
    assert.equal(r2.skip_reason, 'insufficient_data');

    const r3 = results.find(r => r.match_id === '3');
    assert.equal(r3.status, 'failed');
    assert.equal(r3.error, 'no_candidate');
  });

  it('skips already-existing snapshot while processing others', async () => {
    const existingSnapshots = new Map([['1', { match_id: '1', status: 'ready' }]]);
    const candidates = {
      u1: [
        makeCandidate({ id: '2', match_id: '2', match_slug: 'match-2' }),
      ],
    };

    const results = await analyzeMatches({
      matchIds: ['1', '2'],
      candidatesByUserId: candidates,
      existingSnapshots,
      sourceBuilder: async () => makeSourcePayload({ match_id: '2', source_hash: 'sh2' }),
      generator: async () => makeGenResult(),
    });

    // Only match-2 should appear (match-1 was skipped due to existing snapshot)
    assert.equal(results.length, 1);
    assert.equal(results[0].match_id, '2');
    assert.equal(results[0].status, 'ready');
  });
});
