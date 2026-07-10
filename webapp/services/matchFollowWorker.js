'use strict';

const {
  assertMatchFollowFeatureAvailable,
  defaultFetchSstats,
} = require('./matchFollowService');
const { enqueueNotificationForMatchEvent: enqueueNotificationForMatchEventService } = require('./notificationDeliveryService');

function statusIdFromGame(game) {
  return game?.status?.id ?? game?.statusId ?? game?.status ?? game?.gameStatus?.id ?? null;
}

function scoreFromGame(game) {
  const score = game?.score || game?.scores || game?.result || {};
  return {
    home: score.home ?? score.homeScore ?? score.home_team ?? game?.homeScore ?? null,
    away: score.away ?? score.awayScore ?? score.away_team ?? game?.awayScore ?? null,
  };
}

function elapsedFromGame(game) {
  const value = game?.elapsed ?? game?.minute ?? game?.time?.elapsed ?? null;
  return value == null ? null : value;
}

function occurredAt(game) {
  return game?.date || game?.startDate || game?.start_time || new Date().toISOString();
}

function eventForSnapshot({ game, status, previous }) {
  const score = scoreFromGame(game);
  const scoreKey = `${score.home ?? 'null'}-${score.away ?? 'null'}`;
  let kind = null;
  if (status.is_cancelled && !previous?.is_cancelled) kind = 'cancelled';
  else if (status.is_finished && !previous?.is_finished) kind = 'finished';
  else if (previous && (previous.score_home !== score.home || previous.score_away !== score.away)) kind = 'score_changed';
  else if (status.is_live && !previous?.is_live) kind = 'started';
  if (!kind) return null;
  return { kind, score, providerEventKey: `sstats:${game.id ?? game.gameId ?? statusIdFromGame(game)}:${kind}:${kind === 'score_changed' ? scoreKey : status.match_status_id}` };
}

async function fetchActiveMatches(pg) {
  return pg.connection(`
    SELECT match_id, sstats_match_id
    FROM public.v_match_follow_active_sstats_matches
    ORDER BY match_id
  `, []);
}

async function getPreviousEvent(pg, matchId) {
  const rows = await pg.connection(`
    SELECT me.event_kind, me.match_status_id, me.score_home, me.score_away,
           COALESCE(ms.is_live, false) AS is_live,
           COALESCE(ms.is_finished, false) AS is_finished,
           COALESCE(ms.is_cancelled, false) AS is_cancelled
    FROM public.match_event me
    LEFT JOIN public.match_status ms ON ms.match_status_id = me.match_status_id
    WHERE me.match_id = $1
    ORDER BY occurred_at DESC, match_event_id DESC
    LIMIT 1
  `, [matchId]);
  return rows?.[0] || null;
}

async function enqueueNotificationsForMatchEvent({ pg, matchEventId, matchId, eventKind, occurredAt, scoreHome, scoreAway, data } = {}) {
  return enqueueNotificationForMatchEventService({ pg, matchEventId, matchId, eventKind, occurredAt, scoreHome, scoreAway, data });
}

async function processFollowedMatches({ pg, fetcher = defaultFetchSstats, dryRun = false } = {}) {
  const availability = await assertMatchFollowFeatureAvailable(pg);
  const summary = { available: availability.available, reason: availability.reason, matches: 0, fetched: 0, events_created: 0, skipped: 0 };
  if (!availability.available) return summary;

  const matches = await fetchActiveMatches(pg);
  summary.matches = matches.length;
  for (const match of matches) {
    const gamePayload = await fetcher(match.sstats_match_id);
    const game = gamePayload?.game || gamePayload;
    if (!game) { summary.skipped += 1; continue; }
    summary.fetched += 1;
    const statusId = statusIdFromGame(game);
    if (statusId == null) { summary.skipped += 1; continue; }
    const statusRows = await pg.connection(`
      SELECT ms.match_status_id, ms.is_live, ms.is_finished, ms.is_cancelled
      FROM external.public_match_status pms
      JOIN public.match_status ms ON ms.match_status_id = pms.match_status_id
      WHERE pms.system_id = $1 AND pms.system_match_status_id = $2
      LIMIT 1
    `, [3, String(statusId)]);
    const status = statusRows?.[0];
    if (!status) { summary.skipped += 1; continue; }
    const previous = await getPreviousEvent(pg, match.match_id);
    const event = eventForSnapshot({ game, status, previous });
    if (!event) continue;
    if (dryRun) { summary.skipped += 1; continue; }
    const score = event.score;
    const inserted = await pg.connection(`
      INSERT INTO public.match_event
        (match_id, provider_code, provider_event_key, event_kind, occurred_at, score_home, score_away, match_status_id, data)
      VALUES ($1, 'sstats', $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (provider_code, provider_event_key) DO NOTHING
      RETURNING match_event_id
    `, [match.match_id, event.providerEventKey, event.kind, occurredAt(game), score.home, score.away, status.match_status_id, JSON.stringify({ status_id: statusId, elapsed: elapsedFromGame(game) })]);
    if (inserted?.[0]?.match_event_id != null) {
      summary.events_created += 1;
      await enqueueNotificationsForMatchEvent({
        pg,
        matchEventId: inserted[0].match_event_id,
        matchId: match.match_id,
        eventKind: event.kind,
        occurredAt: occurredAt(game),
        scoreHome: score.home,
        scoreAway: score.away,
        data: { status_id: statusId, elapsed: elapsedFromGame(game) },
      });
    } else summary.skipped += 1;
  }
  return summary;
}

module.exports = { processFollowedMatches, enqueueNotificationsForMatchEvent, __private: { statusIdFromGame, scoreFromGame, eventForSnapshot } };
