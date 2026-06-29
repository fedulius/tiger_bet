const CURRENT_TABLE = 'public.ai_recommendation_briefs';
const GENERATIONS_TABLE = 'public.ai_recommendation_brief_generations';

const CURRENT_SELECT_COLS = [
  'match_id',
  'brief_status AS status',
  'headline',
  'brief',
  'risk_note',
].join(', ');

const CURRENT_REFRESH_COLS = [
  'match_id',
  'brief_status AS status',
  'headline',
  'brief',
  'risk_note',
  'source_hash',
  'refresh_after',
  'expires_at',
].join(', ');

function normalizeCurrentRow(row) {
  if (!row) return null;
  return {
    match_id: Number(row.match_id),
    status: String(row.status || ''),
    headline: String(row.headline || ''),
    brief: String(row.brief || ''),
    risk_note: row.risk_note != null ? String(row.risk_note) : null,
  };
}

function mapCurrentRowToApiBrief(row) {
  if (!row) return null;
  return {
    headline: String(row.headline || ''),
    brief: String(row.brief || ''),
    risk_note: row.risk_note != null ? String(row.risk_note) : null,
    stale: row.status === 'stale',
  };
}

async function getCurrentBriefByMatchId(pg, { matchId }) {
  const rows = await pg.connection(
    `SELECT ${CURRENT_SELECT_COLS} FROM ${CURRENT_TABLE}
     WHERE match_id = $1
     LIMIT 1`,
    [matchId],
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return normalizeCurrentRow(rows[0]);
}

async function getCurrentBriefRefreshStateByMatchId(pg, { matchId }) {
  const rows = await pg.connection(
    `SELECT ${CURRENT_REFRESH_COLS} FROM ${CURRENT_TABLE}
     WHERE match_id = $1
     LIMIT 1`,
    [matchId],
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return {
    ...normalizeCurrentRow(rows[0]),
    source_hash: rows[0].source_hash != null ? String(rows[0].source_hash) : null,
    refresh_after: rows[0].refresh_after || null,
    expires_at: rows[0].expires_at || null,
  };
}

async function getCurrentBriefsByMatchIds(pg, { matchIds }) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return new Map();

  const placeholders = matchIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await pg.connection(
    `SELECT ${CURRENT_SELECT_COLS} FROM ${CURRENT_TABLE}
     WHERE match_id IN (${placeholders})`,
    [...matchIds],
  );

  const result = new Map();
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    result.set(Number(row.match_id), normalizeCurrentRow(row));
  }
  return result;
}

async function getCurrentBriefsByMatchSlugs(pg, { matchSlugs }) {
  if (!Array.isArray(matchSlugs) || matchSlugs.length === 0) return new Map();

  const placeholders = matchSlugs.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await pg.connection(
    `SELECT match_slug, ${CURRENT_SELECT_COLS} FROM ${CURRENT_TABLE}
     WHERE match_slug IN (${placeholders})`,
    [...matchSlugs],
  );

  const result = new Map();
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (row.match_slug) {
      result.set(String(row.match_slug), normalizeCurrentRow(row));
    }
  }
  return result;
}

async function insertGeneration(pg, {
  matchId,
  matchSlug = null,
  runType = 'scheduled',
  status,
  headline = null,
  brief = null,
  riskNote = null,
  sourceMode = null,
  sourceHash = null,
  sourcePayload = null,
  modelName = null,
  promptVersion = null,
  tokensInput = null,
  tokensOutput = null,
  estimatedCost = null,
  failureReason = null,
  skipReason = null,
  startedAt = null,
}) {
  const resolvedSourceMode = sourceMode != null ? sourceMode : 'skip';
  const resolvedSourceHash = sourceHash != null ? sourceHash : 'unknown';
  const resolvedSourcePayload = sourcePayload != null ? sourcePayload : '{}';
  const resolvedModelName = modelName != null ? modelName : 'unknown';
  const resolvedPromptVersion = promptVersion != null ? promptVersion : 'unknown';

  const rows = await pg.connection(
    `INSERT INTO ${GENERATIONS_TABLE}
       (match_id, match_slug, run_type, status,
        headline, brief, risk_note,
        source_mode, source_hash, source_payload,
        model_name, prompt_version,
        tokens_input, tokens_output, estimated_cost,
        failure_reason, skip_reason,
        started_at, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
     RETURNING id, match_id, match_slug, run_type, status,
               headline, brief, risk_note,
               source_mode, source_hash,
               model_name, prompt_version,
               tokens_input, tokens_output, estimated_cost,
               failure_reason, skip_reason,
               started_at, completed_at, created_at`,
    [
      matchId, matchSlug, runType, status,
      headline, brief, riskNote,
      resolvedSourceMode, resolvedSourceHash, resolvedSourcePayload,
      resolvedModelName, resolvedPromptVersion,
      tokensInput, tokensOutput, estimatedCost,
      failureReason, skipReason,
      startedAt,
    ],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function upsertCurrentBriefFromReadyGeneration(pg, {
  matchId,
  generationId,
  matchSlug = null,
  sportSlug = null,
  matchTitle = null,
  leagueName = null,
  startsAt = null,
  sourceMode = null,
  headline,
  brief,
  riskNote = null,
  primaryForecast = null,
  primaryCoeff = null,
  primaryConfidence = null,
  sourceHash = null,
  sourcePayload = null,
  modelName = null,
  promptVersion = null,
  generatedAt = null,
  refreshAfter = null,
  expiresAt = null,
}) {
  const resolvedMatchTitle = matchTitle != null ? matchTitle : '';
  const resolvedSourceMode = sourceMode != null ? sourceMode : 'skip';
  const resolvedSourceHash = sourceHash != null ? sourceHash : 'unknown';
  const resolvedSourcePayload = sourcePayload != null ? sourcePayload : '{}';

  const rows = await pg.connection(
    `INSERT INTO ${CURRENT_TABLE}
       (match_id, match_slug, sport_slug, match_title, league_name, starts_at,
        brief_status, last_generation_status, source_mode, headline, brief, risk_note,
        primary_forecast, primary_coeff, primary_confidence,
        source_hash, source_payload, current_generation_id,
        model_name, prompt_version, generated_at, refresh_after, expires_at,
        invalidated_at, invalidated_reason, last_error, stale_since, last_skip_reason)
     VALUES ($1, $2, $3, $4, $5, $6,
            'ready', 'ready', $7, $8, $9, $10,
            $11, $12, $13,
            $14, $15, $16,
            $17, $18, COALESCE($19, NOW()), $20, $21,
            NULL, NULL, NULL, NULL, NULL)
     ON CONFLICT (match_id) DO UPDATE SET
       match_slug = EXCLUDED.match_slug,
       sport_slug = EXCLUDED.sport_slug,
       match_title = EXCLUDED.match_title,
       league_name = EXCLUDED.league_name,
       starts_at = EXCLUDED.starts_at,
       brief_status = 'ready',
       last_generation_status = 'ready',
       source_mode = EXCLUDED.source_mode,
       headline = EXCLUDED.headline,
       brief = EXCLUDED.brief,
       risk_note = EXCLUDED.risk_note,
       primary_forecast = EXCLUDED.primary_forecast,
       primary_coeff = EXCLUDED.primary_coeff,
       primary_confidence = EXCLUDED.primary_confidence,
       source_hash = EXCLUDED.source_hash,
       source_payload = EXCLUDED.source_payload,
       current_generation_id = EXCLUDED.current_generation_id,
       model_name = EXCLUDED.model_name,
       prompt_version = EXCLUDED.prompt_version,
       generated_at = EXCLUDED.generated_at,
       refresh_after = EXCLUDED.refresh_after,
       expires_at = EXCLUDED.expires_at,
       invalidated_at = NULL,
       invalidated_reason = NULL,
       last_error = NULL,
       stale_since = NULL,
       last_skip_reason = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      matchId, matchSlug, sportSlug, resolvedMatchTitle, leagueName, startsAt,
      resolvedSourceMode, headline, brief, riskNote,
      primaryForecast, primaryCoeff, primaryConfidence,
      resolvedSourceHash, resolvedSourcePayload, generationId,
      modelName, promptVersion, generatedAt, refreshAfter, expiresAt,
    ],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

// Inserts or updates a row representing a failed/skipped generation with no usable brief.
// Guarded by WHERE clause to never overwrite a ready or stale brief.
async function upsertNoopCurrentRow(pg, {
  matchId,
  status,
  generationId,
  lastError = null,
  skipReason = null,
  sourceMode = null,
  sourceHash = null,
  sourcePayload = null,
}) {
  const resolvedSourceMode = sourceMode != null ? sourceMode : 'skip';
  const resolvedSourceHash = sourceHash != null ? sourceHash : null;
  const resolvedSourcePayload = sourcePayload != null ? sourcePayload : '{}';

  const rows = await pg.connection(
    `INSERT INTO ${CURRENT_TABLE}
       (match_id, brief_status, last_generation_status, headline, brief, risk_note,
        match_title, source_mode, source_hash, source_payload,
        current_generation_id, last_error, invalidated_reason, last_skip_reason)
     VALUES ($1, 'missing', $2, NULL, NULL, NULL,
        '', $6, $7, $8,
        $3, $4, $5, $5)
     ON CONFLICT (match_id) DO UPDATE SET
       brief_status = 'missing',
       last_generation_status = EXCLUDED.last_generation_status,
       source_mode = EXCLUDED.source_mode,
       source_hash = EXCLUDED.source_hash,
       source_payload = EXCLUDED.source_payload,
       current_generation_id = EXCLUDED.current_generation_id,
       last_error = EXCLUDED.last_error,
       invalidated_reason = EXCLUDED.invalidated_reason,
       last_skip_reason = EXCLUDED.last_skip_reason,
       updated_at = NOW()
     WHERE ${CURRENT_TABLE}.brief_status NOT IN ('ready', 'stale')
     RETURNING *`,
    [matchId, status, generationId, lastError, skipReason, resolvedSourceMode, resolvedSourceHash, resolvedSourcePayload],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function markCurrentBriefStaleAfterFailure(pg, {
  matchId,
  generationId,
  errorMessage = null,
  sourceMode = null,
  sourceHash = null,
  sourcePayload = null,
}) {
  const rows = await pg.connection(
    `UPDATE ${CURRENT_TABLE}
     SET brief_status = 'stale',
         last_generation_status = 'failed',
         last_error = $2,
         invalidated_reason = NULL,
         invalidated_at = COALESCE(invalidated_at, NOW()),
         stale_since = COALESCE(stale_since, NOW()),
         last_skip_reason = NULL,
         current_generation_id = $3,
         updated_at = NOW()
     WHERE match_id = $1
       AND brief_status IN ('ready', 'stale')
     RETURNING 1 AS affected`,
    [matchId, errorMessage, generationId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    await upsertNoopCurrentRow(pg, {
      matchId,
      generationId,
      status: 'failed',
      lastError: errorMessage,
      skipReason: null,
      sourceMode,
      sourceHash,
      sourcePayload,
    });
  }
}

async function markCurrentBriefStaleAfterSkip(pg, {
  matchId,
  generationId,
  skipReason = null,
  sourceMode = null,
  sourceHash = null,
  sourcePayload = null,
}) {
  const rows = await pg.connection(
    `UPDATE ${CURRENT_TABLE}
     SET brief_status = 'stale',
         last_generation_status = 'skipped',
         invalidated_reason = $2,
         last_error = NULL,
         invalidated_at = COALESCE(invalidated_at, NOW()),
         stale_since = COALESCE(stale_since, NOW()),
         last_skip_reason = $2,
         current_generation_id = $3,
         updated_at = NOW()
     WHERE match_id = $1
       AND brief_status IN ('ready', 'stale')
     RETURNING 1 AS affected`,
    [matchId, skipReason, generationId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    await upsertNoopCurrentRow(pg, {
      matchId,
      generationId,
      status: 'skipped',
      lastError: null,
      skipReason,
      sourceMode,
      sourceHash,
      sourcePayload,
    });
  }
}

module.exports = {
  getCurrentBriefByMatchId,
  getCurrentBriefRefreshStateByMatchId,
  getCurrentBriefsByMatchIds,
  getCurrentBriefsByMatchSlugs,
  mapCurrentRowToApiBrief,
  insertGeneration,
  upsertCurrentBriefFromReadyGeneration,
  upsertNoopCurrentRow,
  markCurrentBriefStaleAfterFailure,
  markCurrentBriefStaleAfterSkip,
};
