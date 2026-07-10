'use strict';

const { logUserEvent } = require('./eventLogService');

const REQUIRED_MATCH_FOLLOW_TABLES = [
  'public.match_follow',
  'public.match_event',
  'external.public_match',
  'external.public_match_status',
  'notification.event',
  'notification.delivery',
  'notification.delivery_attempt',
];
const SSTATS_BASE = 'https://api.sstats.net';

function isMatchFollowEnabled() {
  return String(process.env.MATCH_FOLLOW_ENABLED || '').trim().toLowerCase() === 'true';
}

async function assertMatchFollowFeatureAvailable(pg) {
  if (!isMatchFollowEnabled()) return { available: false, reason: 'flag_disabled', missingTables: [] };
  const rows = await pg.connection(`
    SELECT COALESCE(array_agg(required.table_name), ARRAY[]::text[]) AS missing_tables
    FROM unnest($1::text[]) AS required(table_name)
    WHERE to_regclass(required.table_name) IS NULL;
  `, [REQUIRED_MATCH_FOLLOW_TABLES]);
  const missingTables = Array.isArray(rows?.[0]?.missing_tables) ? rows[0].missing_tables : [];
  return { available: missingTables.length === 0, reason: missingTables.length ? 'schema_missing' : null, missingTables };
}

function parseSstatsId(value) {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? Number(id) : null;
}

function defaultFetchSstats(gameId) {
  return fetch(`${SSTATS_BASE}/Games/${gameId}`).then(async (response) => {
    if (!response.ok) return null;
    const json = await response.json();
    return json?.data || null;
  });
}

function statusIdFromGame(game) {
  return game?.status?.id ?? game?.statusId ?? game?.status ?? game?.gameStatus?.id ?? null;
}

async function resolveMapping(pg, sstatsId) {
  const rows = await pg.connection(`
    SELECT match_id FROM external.public_match
    WHERE system_id = $1 AND system_match_id = $2
    LIMIT 1
  `, [3, String(sstatsId)]);
  return rows?.[0] || null;
}

async function resolveStatus(pg, game) {
  const statusId = statusIdFromGame(game);
  if (statusId == null) return null;
  const rows = await pg.connection(`
    SELECT ms.match_status_id, ms.is_finished, ms.is_cancelled
    FROM external.public_match_status pms
    JOIN public.match_status ms ON ms.match_status_id = pms.match_status_id
    WHERE pms.system_id = $1 AND pms.system_match_status_id = $2
    LIMIT 1
  `, [3, String(statusId)]);
  return rows?.[0] || null;
}

async function getFollowState({ pg, userId, sstatsId, fetcher = defaultFetchSstats } = {}) {
  const mapping = await resolveMapping(pg, sstatsId);
  if (!mapping) return { following: false, canFollow: false, isFinished: false, mapping: null };
  const rows = await pg.connection(`
    SELECT follow_status FROM public.match_follow
    WHERE user_id = $1 AND match_id = $2 LIMIT 1
  `, [userId, mapping.match_id]);
  const matchRows = await pg.connection(`
    SELECT ms.is_finished, ms.is_cancelled
    FROM public.match m LEFT JOIN public.match_status ms ON ms.match_status_id = m.match_status_id
    WHERE m.match_id = $1 LIMIT 1
  `, [mapping.match_id]);
  const match = matchRows?.[0] || {};
  return {
    following: rows?.[0]?.follow_status === 'active',
    canFollow: !match.is_finished && !match.is_cancelled,
    isFinished: Boolean(match.is_finished || match.is_cancelled),
    mapping,
  };
}

async function followMatch({ pg, userId, sstatsId, fetcher = defaultFetchSstats, loggerRequest = null, fastify = null } = {}) {
  const mapping = await resolveMapping(pg, sstatsId);
  if (!mapping) return { error: 'MATCH_MAPPING_REQUIRED', statusCode: 409 };
  const gamePayload = await fetcher(sstatsId);
  const status = await resolveStatus(pg, gamePayload?.game || gamePayload);
  if (!status || status.is_finished || status.is_cancelled) {
    await logUserEvent(fastify, loggerRequest, { eventName: 'match.follow_rejected', statusCode: 409, entityId: sstatsId }).catch(() => {});
    return { error: 'MATCH_NOT_FOLLOWABLE', statusCode: 409 };
  }
  await pg.connection(`
    INSERT INTO public.match_follow (user_id, match_id, follow_status, unfollowed_at, completed_at, updated_at)
    VALUES ($1, $2, 'active', NULL, NULL, now())
    ON CONFLICT (user_id, match_id) DO UPDATE SET follow_status = 'active', unfollowed_at = NULL, completed_at = NULL, updated_at = now()
  `, [userId, mapping.match_id]);
  await logUserEvent(fastify, loggerRequest, { eventName: 'match.followed', entityId: sstatsId }).catch(() => {});
  return { following: true, canFollow: true, isFinished: false };
}

async function unfollowMatch({ pg, userId, sstatsId, loggerRequest = null, fastify = null } = {}) {
  const mapping = await resolveMapping(pg, sstatsId);
  if (!mapping) return { error: 'MATCH_MAPPING_REQUIRED', statusCode: 409 };
  await pg.connection(`
    UPDATE public.match_follow SET follow_status = 'cancelled', unfollowed_at = COALESCE(unfollowed_at, now()), updated_at = now()
    WHERE user_id = $1 AND match_id = $2
  `, [userId, mapping.match_id]);
  await logUserEvent(fastify, loggerRequest, { eventName: 'match.unfollowed', entityId: sstatsId }).catch(() => {});
  return { following: false, canFollow: true, isFinished: false };
}

module.exports = { REQUIRED_MATCH_FOLLOW_TABLES, isMatchFollowEnabled, assertMatchFollowFeatureAvailable, getFollowState, followMatch, unfollowMatch, defaultFetchSstats, __private: { parseSstatsId, statusIdFromGame, resolveMapping, resolveStatus } };
