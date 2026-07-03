'use strict';

const crypto = require('crypto');

const MATCH_STATUS_DEFAULT = 'scheduled';
const SOURCE_TYPE_DEFAULT = 'bundle';

const ANALYSIS_HASH_FIELDS = [
  'status', 'headline', 'brief', 'risk_note',
  'recommended_bets', 'model_name', 'prompt_version',
  'source_hash', 'error',
];

const VALID_ANALYSIS_STATUSES = new Set(['ready', 'skipped', 'failed', 'pending']);

function buildExternalSourceId(systemId, matchId, sourceHash) {
  return `bundle:${systemId}:${matchId}:${sourceHash}`;
}

function validateInputs({ systemId, sportId, tournamentId, candidate, sourcePayload }) {
  if (systemId == null) throw new Error('systemId is required');
  if (sportId == null) throw new Error('sportId is required');
  if (tournamentId == null) throw new Error('tournamentId is required');
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');
  if (!sourcePayload || typeof sourcePayload !== 'object') throw new Error('sourcePayload is required');

  const matchId = String(candidate.match_id || candidate.id || '');
  if (!matchId) throw new Error('candidate must have a non-empty match_id or id');

  const sourceHash = sourcePayload.source_hash;
  if (!sourceHash) throw new Error('sourcePayload.source_hash is required');

  return { matchId, sourceHash };
}

async function persistBundleSnapshot(pg, { systemId, sportId, tournamentId, candidate, sourcePayload }) {
  const { matchId, sourceHash } = validateInputs({ systemId, sportId, tournamentId, candidate, sourcePayload });

  const matchSlug = candidate.match_slug || candidate.slug || '';
  const homeTeam = candidate.home_team || '';
  const awayTeam = candidate.away_team || '';
  const matchStartAt = candidate.starts_at || null;

  const [matchRow = {}] = await pg.connection(
    'SELECT * FROM public.match_create($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [matchId, matchSlug, systemId, sportId, tournamentId, homeTeam, awayTeam, MATCH_STATUS_DEFAULT, matchStartAt],
  );

  const externalSourceId = buildExternalSourceId(systemId, matchId, sourceHash);
  const sourceUrl = sourcePayload.source_url ?? sourcePayload.sourceUrl ?? '';

  const [sourceRow = {}] = await pg.connection(
    'SELECT * FROM public.match_source_create($1,$2,$3,$4,$5,$6,$7)',
    [externalSourceId, sourceUrl, systemId, matchId, SOURCE_TYPE_DEFAULT, sourceHash, sourcePayload],
  );

  return {
    matchId: matchRow.id ?? matchRow.match_id ?? matchRow.out_match_id ?? matchRow.match_create ?? matchId,
    sourceId:
      sourceRow.id
      ?? sourceRow.source_id
      ?? sourceRow.match_source_id
      ?? sourceRow.out_match_source_id
      ?? sourceRow.match_source_create
      ?? null,
    externalSourceId,
  };
}

function buildAnalysisHash(snapshot) {
  const payload = {};
  for (const key of ANALYSIS_HASH_FIELDS) {
    payload[key] = snapshot[key] ?? null;
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function validateAnalysisInputs({ matchSourceId, snapshot }) {
  if (matchSourceId == null) throw new Error('matchSourceId is required');
  if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot is required');
  if (snapshot.status != null && !VALID_ANALYSIS_STATUSES.has(snapshot.status)) {
    throw new Error(`Invalid analysis status: "${snapshot.status}"`);
  }
}

async function persistAnalysisSnapshot(pg, { matchSourceId, snapshot }) {
  validateAnalysisInputs({ matchSourceId, snapshot });

  const statusName = snapshot.status ?? 'pending';
  const recommendedBets = snapshot.recommended_bets ?? [];
  const analysisHash = snapshot.analysis_hash ?? buildAnalysisHash(snapshot);
  const recommendedBetsJson = JSON.stringify(recommendedBets);

  const [analysisRow = {}] = await pg.connection(
    'SELECT * FROM public.match_analysis_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      matchSourceId,
      statusName,
      snapshot.headline ?? null,
      snapshot.brief ?? null,
      snapshot.risk_note ?? null,
      recommendedBetsJson,
      snapshot.model_name ?? null,
      snapshot.prompt_version ?? null,
      analysisHash,
      snapshot.error ?? null,
      snapshot.skip_reason ?? null,
    ],
  );

  return {
    analysisId:
      analysisRow.id
      ?? analysisRow.analysis_id
      ?? analysisRow.match_analysis_id
      ?? analysisRow.out_match_analysis_id
      ?? analysisRow.match_analysis_create
      ?? null,
    analysisHash,
  };
}

module.exports = { buildExternalSourceId, persistBundleSnapshot, buildAnalysisHash, persistAnalysisSnapshot };
