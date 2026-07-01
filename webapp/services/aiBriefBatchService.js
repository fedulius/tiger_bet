'use strict';

const { aiBriefLlmProvider } = require('./aiBriefLlmProvider');
const {
  getCurrentBriefRefreshStateByMatchId,
  insertGeneration,
  upsertCurrentBriefFromReadyGeneration,
  markCurrentBriefStaleAfterFailure,
  markCurrentBriefStaleAfterSkip,
} = require('./aiBriefStore');
const { buildAiBriefSourcePayload } = require('./aiBriefSourceService');
const { generateAiBrief } = require('./aiBriefGenerator');

// djb2-based hash mapped to a high range safe for JS Number precision and Postgres bigint.
// Range: [4_000_000_000_000, 4_004_294_967_295] — no overlap with typical auto-increment IDs.
function slugToMatchId(slug) {
  let h = 5381;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) + h) ^ slug.charCodeAt(i);
    h >>>= 0;
  }
  return 4_000_000_000_000 + h;
}

function selectCandidateMatches(matches, { limit = null, now = new Date() } = {}) {
  if (!Array.isArray(matches)) return [];

  const nowTs = now instanceof Date ? now.getTime() : Date.now();
  const unique = new Map();

  for (const match of matches) {
    let matchId = Number(match?.id ?? match?.match_id);
    if (!Number.isFinite(matchId)) {
      const slug = match?.slug || match?.match_slug;
      if (!slug) continue;
      matchId = slugToMatchId(slug);
    }
    const startsAtRaw = match?.starts_at || match?.startsAt || null;
    const startsAtTs = startsAtRaw ? Date.parse(startsAtRaw) : null;
    if (startsAtTs != null && Number.isFinite(startsAtTs) && startsAtTs <= nowTs) continue;
    if (!unique.has(matchId)) {
      unique.set(matchId, match);
    }
  }

  const sorted = Array.from(unique.values()).sort((a, b) => {
    const aTs = Date.parse(a?.starts_at || a?.startsAt || '') || Number.MAX_SAFE_INTEGER;
    const bTs = Date.parse(b?.starts_at || b?.startsAt || '') || Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });

  return Number.isInteger(limit) && limit >= 0 ? sorted.slice(0, limit) : sorted;
}

function shouldSkipUnchanged(currentRow, sourcePayload, now = new Date()) {
  if (!currentRow || currentRow.status !== 'ready') return false;
  if (!sourcePayload || !sourcePayload.source_hash) return false;
  if (currentRow.source_hash !== sourcePayload.source_hash) return false;

  const nowTs = now instanceof Date ? now.getTime() : Date.now();
  const refreshAfterTs = currentRow.refresh_after ? Date.parse(currentRow.refresh_after) : NaN;
  const expiresAtTs = currentRow.expires_at ? Date.parse(currentRow.expires_at) : NaN;

  const refreshPending = Number.isFinite(refreshAfterTs) && refreshAfterTs > nowTs;
  const notExpired = Number.isFinite(expiresAtTs) ? expiresAtTs > nowTs : true;

  return refreshPending && notExpired;
}

function buildReadyCurrentParams(match, sourcePayload, generationResult, generationRow, timings = {}) {
  return {
    matchId: Number(match?.id ?? sourcePayload?.match_id),
    generationId: generationRow?.id ?? null,
    matchSlug: sourcePayload?.match_slug || match?.slug || null,
    sportSlug: sourcePayload?.sport_slug || match?.sportSlug || null,
    matchTitle: match?.match || match?.title || match?.name || null,
    leagueName: match?.league || match?.league_name || null,
    startsAt: match?.starts_at || match?.startsAt || null,
    sourceMode: sourcePayload?.source_mode || null,
    headline: generationResult?.output?.headline || null,
    brief: generationResult?.output?.brief || null,
    riskNote: generationResult?.output?.risk_note || null,
    primaryForecast: sourcePayload?.primary_signal?.label || sourcePayload?.primary_signal?.outcome || null,
    primaryCoeff: sourcePayload?.primary_signal?.rate ?? null,
    primaryConfidence: null,
    sourceHash: sourcePayload?.source_hash || null,
    sourcePayload,
    modelName: generationResult?.model_name || null,
    promptVersion: generationResult?.prompt_version || null,
    generatedAt: timings.generatedAt || new Date().toISOString(),
    refreshAfter: timings.refreshAfter || null,
    expiresAt: timings.expiresAt || null,
  };
}

function computeTimings(match, now = new Date(), options = {}) {
  const refreshLeadMs = options.refreshLeadMs ?? 90 * 60 * 1000;
  const staleGraceMs = options.staleGraceMs ?? 6 * 60 * 60 * 1000;
  const nowTs = now instanceof Date ? now.getTime() : Date.now();
  const startsAtTs = Date.parse(match?.starts_at || match?.startsAt || '');

  if (!Number.isFinite(startsAtTs)) {
    return {
      refreshAfter: new Date(nowTs + refreshLeadMs).toISOString(),
      expiresAt: new Date(nowTs + staleGraceMs).toISOString(),
    };
  }

  return {
    refreshAfter: new Date(Math.max(nowTs, startsAtTs - refreshLeadMs)).toISOString(),
    expiresAt: new Date(startsAtTs + staleGraceMs).toISOString(),
  };
}

async function refreshMatchBrief({
  pg,
  match,
  sourceBuilder = buildAiBriefSourcePayload,
  generator = generateAiBrief,
  popularBetsLoader,
  matchDetailLoader,
  riskBetsSelector,
  generatorProvider,
  modelName = null,
  promptVersion = null,
  now = new Date(),
  timingOptions = {},
  store = {},
  runType = 'scheduled',
}) {
  const storeApi = {
    getCurrentBriefByMatchId: store.getCurrentBriefByMatchId || getCurrentBriefRefreshStateByMatchId,
    insertGeneration: store.insertGeneration || insertGeneration,
    upsertCurrentBriefFromReadyGeneration: store.upsertCurrentBriefFromReadyGeneration || upsertCurrentBriefFromReadyGeneration,
    markCurrentBriefStaleAfterFailure: store.markCurrentBriefStaleAfterFailure || markCurrentBriefStaleAfterFailure,
    markCurrentBriefStaleAfterSkip: store.markCurrentBriefStaleAfterSkip || markCurrentBriefStaleAfterSkip,
  };

  let matchId = Number(match?.id ?? match?.match_id);
  if (!Number.isFinite(matchId)) {
    const slug = match?.slug || match?.match_slug;
    if (!slug) {
      return { match_id: null, outcome: 'failed', error: 'invalid_match_id', counts: { failed: 1 } };
    }
    matchId = slugToMatchId(slug);
    match = { ...match, id: matchId };
  }

  const currentRow = await storeApi.getCurrentBriefByMatchId(pg, { matchId });
  const sourcePayload = await sourceBuilder({ match, popularBetsLoader, matchDetailLoader, riskBetsSelector });

  const mode = sourcePayload?.source_mode || 'skip';
  const modeCounts = mode === 'full' ? { full: 1 } : mode === 'light' ? { light: 1 } : { skip: 1 };

  if (shouldSkipUnchanged(currentRow, sourcePayload, now)) {
    return {
      match_id: matchId,
      match_slug: sourcePayload?.match_slug || match?.slug || null,
      outcome: 'unchanged',
      source_mode: mode,
      source_hash: sourcePayload?.source_hash || null,
      counts: { ...modeCounts, unchanged: 1 },
    };
  }

  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const timings = computeTimings(match, now, timingOptions);

  if (mode === 'skip') {
    return {
      match_id: matchId,
      match_slug: sourcePayload?.match_slug || match?.slug || null,
      outcome: 'skipped',
      source_mode: 'skip',
      counts: { ...modeCounts, skipped: 1 },
    };
  }

  const generationResult = await generator({
    sourcePayload,
    modelName,
    promptVersion,
    provider: generatorProvider,
  });

  if (generationResult.status === 'ready') {
    const generationRow = await storeApi.insertGeneration(pg, {
      matchId,
      matchSlug: sourcePayload?.match_slug || match?.slug || null,
      runType,
      status: 'ready',
      headline: generationResult.output.headline,
      brief: generationResult.output.brief,
      riskNote: generationResult.output.risk_note,
      sourceMode: sourcePayload?.source_mode || null,
      sourceHash: sourcePayload?.source_hash || null,
      sourcePayload,
      modelName: generationResult.model_name || modelName,
      promptVersion: generationResult.prompt_version || promptVersion,
      tokensInput: generationResult.prompt_tokens ?? null,
      tokensOutput: generationResult.completion_tokens ?? null,
      startedAt: generatedAt,
    });

    await storeApi.upsertCurrentBriefFromReadyGeneration(pg, buildReadyCurrentParams(match, sourcePayload, generationResult, generationRow, {
      generatedAt,
      refreshAfter: timings.refreshAfter,
      expiresAt: timings.expiresAt,
    }));

    return {
      match_id: matchId,
      match_slug: sourcePayload?.match_slug || match?.slug || null,
      outcome: 'ready',
      source_mode: mode,
      generation_id: generationRow?.id || null,
      counts: { ...modeCounts, ready: 1 },
    };
  }

  if (generationResult.status === 'failed') {
    const generationRow = await storeApi.insertGeneration(pg, {
      matchId,
      matchSlug: sourcePayload?.match_slug || match?.slug || null,
      runType,
      status: 'failed',
      sourceMode: sourcePayload?.source_mode || null,
      sourceHash: sourcePayload?.source_hash || null,
      sourcePayload,
      modelName,
      promptVersion,
      tokensInput: generationResult.prompt_tokens ?? null,
      tokensOutput: generationResult.completion_tokens ?? null,
      failureReason: generationResult.error || 'generation_failed',
      startedAt: generatedAt,
    });

    await storeApi.markCurrentBriefStaleAfterFailure(pg, {
      matchId,
      generationId: generationRow?.id || null,
      errorMessage: generationResult.error || 'generation_failed',
      sourceMode: sourcePayload?.source_mode || null,
      sourceHash: sourcePayload?.source_hash || null,
      sourcePayload,
    });

    return {
      match_id: matchId,
      match_slug: sourcePayload?.match_slug || match?.slug || null,
      outcome: 'failed',
      source_mode: mode,
      generation_id: generationRow?.id || null,
      error: generationResult.error || 'generation_failed',
      counts: { ...modeCounts, failed: 1, ...(currentRow && (currentRow.status === 'ready' || currentRow.status === 'stale') ? { stale_transitions: 1 } : {}) },
    };
  }

  return {
    match_id: matchId,
    match_slug: sourcePayload?.match_slug || match?.slug || null,
    outcome: 'failed',
    source_mode: mode,
    error: 'unexpected_generation_status',
    counts: { ...modeCounts, failed: 1 },
  };
}

function emptySummary() {
  return {
    candidates: 0,
    full: 0,
    light: 0,
    skip: 0,
    unchanged: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    stale_transitions: 0,
    processed: 0,
    results: [],
  };
}

function mergeCounts(summary, counts = {}) {
  for (const [key, value] of Object.entries(counts)) {
    if (!Object.prototype.hasOwnProperty.call(summary, key)) summary[key] = 0;
    summary[key] += Number(value) || 0;
  }
}

async function runAiBriefBatch({
  pg,
  matches,
  selectCandidates = selectCandidateMatches,
  generatorProvider = aiBriefLlmProvider,
  ...deps
}) {
  const candidates = selectCandidates(matches, deps.selectionOptions || {});
  const summary = emptySummary();
  summary.candidates = candidates.length;

  for (const match of candidates) {
    try {
      const result = await refreshMatchBrief({ pg, match, generatorProvider, ...deps });
      summary.results.push(result);
      summary.processed += 1;
      mergeCounts(summary, result.counts);
    } catch (err) {
      const failure = {
        match_id: Number(match?.id ?? match?.match_id) || null,
        match_slug: match?.slug || match?.match_slug || null,
        outcome: 'failed',
        error: err && err.message ? err.message : 'batch_match_error',
        counts: { failed: 1 },
      };
      summary.results.push(failure);
      summary.processed += 1;
      mergeCounts(summary, failure.counts);
    }
  }

  return summary;
}

module.exports = {
  selectCandidateMatches,
  shouldSkipUnchanged,
  computeTimings,
  buildReadyCurrentParams,
  refreshMatchBrief,
  runAiBriefBatch,
};
