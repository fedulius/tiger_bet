'use strict';

function buildDailyPickAnalysisInput({ match, sourcePayload }) {
  return {
    match_id: String(match.match_id || match.id),
    match_slug: match.match_slug || match.slug || '',
    sport_slug: match.sport_slug || match.sportSlug || null,
    home_team: match.home_team || '',
    away_team: match.away_team || '',
    starts_at: match.starts_at || '',
    source_mode: sourcePayload.source_mode,
    source_hash: sourcePayload.source_hash,
    source_payload: sourcePayload,
  };
}

function findRepresentativeCandidate(matchId, candidatesByUserId) {
  for (const candidates of Object.values(candidatesByUserId)) {
    if (!Array.isArray(candidates)) continue;
    for (const c of candidates) {
      if (String(c.match_id || c.id) === String(matchId)) return c;
    }
  }
  return null;
}

async function analyzeMatches({
  matchIds,
  candidatesByUserId,
  existingSnapshots,
  sourceBuilder,
  generator,
  modelName,
  promptVersion,
}) {
  const snapshots = [];
  const now = new Date().toISOString();

  for (const matchId of matchIds) {
    if (existingSnapshots && existingSnapshots.has(matchId)) {
      continue;
    }

    const match = findRepresentativeCandidate(matchId, candidatesByUserId);
    if (!match) {
      snapshots.push({
        match_id: String(matchId),
        match_slug: '',
        status: 'failed',
        source_mode: 'skip',
        source_hash: null,
        generated_at: now,
        error: 'no_candidate',
      });
      continue;
    }

    let sourcePayload;
    try {
      sourcePayload = await sourceBuilder(match);
    } catch (err) {
      snapshots.push({
        match_id: String(match.match_id || match.id),
        match_slug: match.match_slug || match.slug || '',
        status: 'failed',
        source_mode: 'skip',
        source_hash: null,
        generated_at: now,
        error: err && err.message ? err.message : 'source_builder_error',
      });
      continue;
    }

    if (!sourcePayload || sourcePayload.source_mode === 'skip') {
      snapshots.push({
        match_id: String(match.match_id || match.id),
        match_slug: match.match_slug || match.slug || '',
        status: 'skipped',
        source_mode: 'skip',
        source_hash: sourcePayload ? sourcePayload.source_hash : null,
        skip_reason: sourcePayload ? (sourcePayload.skip_reason || null) : 'no_source',
        generated_at: now,
      });
      continue;
    }

    const analysisInput = buildDailyPickAnalysisInput({ match, sourcePayload });

    let genResult;
    try {
      genResult = await generator({ sourcePayload, modelName, promptVersion });
    } catch (err) {
      snapshots.push({
        match_id: analysisInput.match_id,
        match_slug: analysisInput.match_slug,
        status: 'failed',
        source_mode: sourcePayload.source_mode,
        source_hash: sourcePayload.source_hash,
        generated_at: now,
        error: err && err.message ? err.message : 'generator_error',
      });
      continue;
    }

    if (!genResult || genResult.status !== 'ready') {
      snapshots.push({
        match_id: analysisInput.match_id,
        match_slug: analysisInput.match_slug,
        status: genResult ? genResult.status : 'failed',
        source_mode: sourcePayload.source_mode,
        source_hash: sourcePayload.source_hash,
        generated_at: now,
        error: genResult ? (genResult.error || null) : 'generator_returned_null',
      });
      continue;
    }

    snapshots.push({
      match_id: analysisInput.match_id,
      match_slug: analysisInput.match_slug,
      status: 'ready',
      source_mode: sourcePayload.source_mode,
      source_hash: sourcePayload.source_hash,
      headline: genResult.output.headline,
      brief: genResult.output.brief,
      risk_note: genResult.output.risk_note || null,
      model_name: genResult.model_name || modelName || null,
      prompt_version: genResult.prompt_version || promptVersion || null,
      generated_at: now,
    });
  }

  return snapshots;
}

module.exports = { buildDailyPickAnalysisInput, analyzeMatches };
