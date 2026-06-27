'use strict';

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub runAiBriefBatch before requiring the module under test
const batchServiceModule = require('../../webapp/services/aiBriefBatchService');

describe('AiRecommendationBriefs runner', () => {
  let AiRecommendationBriefs;
  let stavkaApi;

  beforeEach(() => {
    // Re-require to get a fresh module reference
    AiRecommendationBriefs = require('../../scheduler/AiRecommendationBriefs');
    stavkaApi = require('../../lib/stavkaApi');
  });

  it('exposes aiRecommendationBriefs factory from scheduler/index.js', () => {
    const scheduler = require('../../scheduler/index');
    assert.strictEqual(typeof scheduler.aiRecommendationBriefs, 'function');
    const fakePg = {};
    const runner = scheduler.aiRecommendationBriefs(fakePg);
    assert.ok(runner instanceof AiRecommendationBriefs);
  });

  it('passes matches and stavka loaders into runAiBriefBatch', async () => {
    const fakeMatches = [
      { id: 1, slug: 'team-a-vs-team-b', starts_at: new Date(Date.now() + 86400000).toISOString() },
    ];

    const fakeSummary = { candidates: 1, ready: 1, failed: 0, results: [] };

    // Stub fetchAllMatches
    const origFetchAllMatches = stavkaApi.fetchAllMatches;
    stavkaApi.fetchAllMatches = async () => fakeMatches;

    // Stub runAiBriefBatch
    let capturedArgs;
    const origRunBatch = batchServiceModule.runAiBriefBatch;
    batchServiceModule.runAiBriefBatch = async (args) => {
      capturedArgs = args;
      return fakeSummary;
    };

    try {
      const fakePg = { query: async () => {} };
      const runner = new AiRecommendationBriefs(fakePg);
      const result = await runner.runOnce();

      assert.deepStrictEqual(result, fakeSummary, 'should return the batch summary');
      assert.strictEqual(capturedArgs.pg, fakePg, 'should pass pg');
      assert.deepStrictEqual(capturedArgs.matches, fakeMatches, 'should pass fetched matches');
      assert.strictEqual(typeof capturedArgs.popularBetsLoader, 'function', 'should pass popularBetsLoader');
      assert.strictEqual(typeof capturedArgs.matchDetailLoader, 'function', 'should pass matchDetailLoader');
      assert.strictEqual(typeof capturedArgs.riskBetsSelector, 'function', 'should pass riskBetsSelector');
    } finally {
      stavkaApi.fetchAllMatches = origFetchAllMatches;
      batchServiceModule.runAiBriefBatch = origRunBatch;
    }
  });

  it('returns the batch summary from runAiBriefBatch', async () => {
    const expectedSummary = { candidates: 5, ready: 3, failed: 1, skipped: 1, results: [] };

    const origFetchAllMatches = stavkaApi.fetchAllMatches;
    stavkaApi.fetchAllMatches = async () => [];

    const origRunBatch = batchServiceModule.runAiBriefBatch;
    batchServiceModule.runAiBriefBatch = async () => expectedSummary;

    try {
      const runner = new AiRecommendationBriefs({});
      const result = await runner.runOnce();
      assert.deepStrictEqual(result, expectedSummary);
    } finally {
      stavkaApi.fetchAllMatches = origFetchAllMatches;
      batchServiceModule.runAiBriefBatch = origRunBatch;
    }
  });

  it('passes extra options to runAiBriefBatch', async () => {
    const origFetchAllMatches = stavkaApi.fetchAllMatches;
    stavkaApi.fetchAllMatches = async () => [];

    let capturedArgs;
    const origRunBatch = batchServiceModule.runAiBriefBatch;
    batchServiceModule.runAiBriefBatch = async (args) => {
      capturedArgs = args;
      return { candidates: 0, results: [] };
    };

    try {
      const runner = new AiRecommendationBriefs({});
      await runner.runOnce({ selectionOptions: { limit: 10 }, runType: 'manual' });
      assert.deepStrictEqual(capturedArgs.selectionOptions, { limit: 10 });
      assert.strictEqual(capturedArgs.runType, 'manual');
    } finally {
      stavkaApi.fetchAllMatches = origFetchAllMatches;
      batchServiceModule.runAiBriefBatch = origRunBatch;
    }
  });

  it('treats null fetchAllMatches result as empty array', async () => {
    const origFetchAllMatches = stavkaApi.fetchAllMatches;
    stavkaApi.fetchAllMatches = async () => null;

    let capturedMatches;
    const origRunBatch = batchServiceModule.runAiBriefBatch;
    batchServiceModule.runAiBriefBatch = async (args) => {
      capturedMatches = args.matches;
      return { candidates: 0, results: [] };
    };

    try {
      const runner = new AiRecommendationBriefs({});
      await runner.runOnce();
      assert.deepStrictEqual(capturedMatches, []);
    } finally {
      stavkaApi.fetchAllMatches = origFetchAllMatches;
      batchServiceModule.runAiBriefBatch = origRunBatch;
    }
  });
});
