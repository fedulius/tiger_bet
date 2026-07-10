'use strict';

const TYPE_BY_EVENT_KIND = {
  started: 'match.started',
  score_changed: 'match.score_changed',
  goal: 'match.score_changed',
  finished: 'match.finished',
  cancelled: 'match.cancelled',
};

function normalizeRenderedText(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderTemplate(template, fields) {
  const replace = (value) => String(value ?? '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => fields[key] ?? '');
  const text = normalizeRenderedText(replace(template.body_template || template.bodyTemplate || ''));
  return {
    text,
    html: text.replace(/\n/g, '<br>'),
    title: normalizeRenderedText(replace(template.title_template || template.titleTemplate || '')),
  };
}

function formatScore(scoreHome, scoreAway) {
  if (scoreHome == null || scoreAway == null) return '';
  return `${scoreHome}:${scoreAway}`;
}

function formatElapsed(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n}'`;
}

async function resolveMatchNotificationFields(pg, { matchId, scoreHome, scoreAway, data = {} }) {
  const rows = await pg.connection(`
    SELECT m.home_team, m.away_team, m.match_start_at,
           t.tournament_name, t.tournament_name_en,
           s.sport_name
    FROM public.match m
    LEFT JOIN public.tournament t ON t.tournament_id = m.tournament_id
    LEFT JOIN public.sport s ON s.sport_id = m.sport_id
    WHERE m.match_id = $1
    LIMIT 1
  `, [matchId]);
  const match = rows?.[0] || {};
  const home = String(match.home_team || '').trim();
  const away = String(match.away_team || '').trim();
  const league = String(match.tournament_name || match.tournament_name_en || '').trim();
  const sport = String(match.sport_name || '').trim();

  return {
    match_title: home && away ? `${home} — ${away}` : '',
    league_name: [sport, league].filter(Boolean).join(' · '),
    score: formatScore(scoreHome, scoreAway),
    elapsed: formatElapsed(data.elapsed ?? data.minute),
    event_kind: data.event_kind || '',
  };
}

async function enqueueNotificationForMatchEvent({ pg, matchEventId, matchId, eventKind, occurredAt, scoreHome, scoreAway, data = {} }) {
  const typeCode = TYPE_BY_EVENT_KIND[eventKind];
  if (!typeCode) return { skipped: true, reason: 'unsupported_event_kind' };
  const eventRows = await pg.connection(`
    INSERT INTO notification.event
      (notification_type_id, source_name, source_event_key, aggregate_type, aggregate_id, occurred_at, payload)
    SELECT nt.notification_type_id, 'match_event', 'match_event:' || $1, 'match', $2::text, $3, $4::jsonb
    FROM notification.type nt
    WHERE nt.type_code = $5 AND nt.is_active = true
    ON CONFLICT (source_name, source_event_key) DO UPDATE SET source_event_key = EXCLUDED.source_event_key
    RETURNING notification_event_id, notification_type_id
  `, [matchEventId, matchId, occurredAt, JSON.stringify({ match_event_id: matchEventId, match_id: matchId, event_kind: eventKind, score_home: scoreHome, score_away: scoreAway, ...data }), typeCode]);
  const event = eventRows?.[0];
  if (!event) return { skipped: true, reason: 'notification_type_missing' };
  const followers = await pg.connection(`
    SELECT mf.user_id, pu.system_user_id AS recipient_address,
           c.channel_id, t.notification_template_id, t.body_template, t.title_template,
           t.notification_template_id
    FROM public.match_follow mf
    JOIN external.public_user pu ON pu.user_id = mf.user_id AND pu.system_id = $1
    JOIN notification.channel c ON c.channel_code = 'telegram' AND c.is_active = true
    JOIN notification.type nt ON nt.notification_type_id = $2
    JOIN notification.template t ON t.notification_type_id = nt.notification_type_id
      AND t.channel_id = c.channel_id AND t.locale_code = 'ru' AND t.is_active = true
    WHERE mf.match_id = $3 AND mf.follow_status = 'active'
  `, [1, event.notification_type_id, matchId]);
  const fields = await resolveMatchNotificationFields(pg, {
    matchId,
    scoreHome,
    scoreAway,
    data: { ...data, event_kind: eventKind },
  });
  let created = 0;
  for (const follower of followers || []) {
    const rendered = renderTemplate(follower, fields);
    await pg.connection(`
      INSERT INTO notification.delivery
        (notification_event_id, user_id, channel_id, recipient_address, notification_template_id, rendered_payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (notification_event_id, user_id, channel_id) DO NOTHING
    `, [event.notification_event_id, follower.user_id, follower.channel_id, String(follower.recipient_address), follower.notification_template_id, JSON.stringify(rendered)]);
    created += 1;
  }
  return { notification_event_id: event.notification_event_id, deliveries_created: created, type_code: typeCode };
}

async function claimPendingDeliveries({ pg, limit = 50, workerId = `worker-${process.pid}` }) {
  return pg.connection(`
    UPDATE notification.delivery d
    SET delivery_status = 'processing', locked_at = now(), locked_by = $1, updated_at = now()
    WHERE d.notification_delivery_id IN (
      SELECT notification_delivery_id FROM notification.delivery
      WHERE delivery_status IN ('pending', 'retry') AND next_attempt_at <= now()
      ORDER BY priority DESC, next_attempt_at, notification_delivery_id
      FOR UPDATE SKIP LOCKED LIMIT $2
    ) RETURNING *
  `, [workerId, limit]);
}

async function sendPendingDeliveries({ pg, sender, limit = 50, workerId } = {}) {
  if (typeof sender !== 'function') throw new TypeError('sender must be a function');
  const deliveries = await claimPendingDeliveries({ pg, limit, workerId });
  const summary = { claimed: deliveries.length, sent: 0, failed: 0, retry: 0 };
  for (const delivery of deliveries) {
    const attemptNo = Number(delivery.attempt_count || 0) + 1;
    try {
      const result = await sender({ chatId: delivery.recipient_address, text: delivery.rendered_payload?.text || '', delivery });
      await pg.connection(`UPDATE notification.delivery SET delivery_status='sent', attempt_count=$2, sent_at=now(), provider_message_id=$3, locked_at=NULL, locked_by=NULL, updated_at=now() WHERE notification_delivery_id=$1`, [delivery.notification_delivery_id, attemptNo, String(result?.message_id ?? result?.provider_message_id ?? '')]);
      await pg.connection(`INSERT INTO notification.delivery_attempt (notification_delivery_id, attempt_no, finished_at, outcome, provider_message_id) VALUES ($1,$2,now(),'sent',$3)`, [delivery.notification_delivery_id, attemptNo, String(result?.message_id ?? result?.provider_message_id ?? '')]);
      summary.sent += 1;
    } catch (error) {
      const status = error?.status ?? error?.response?.status;
      const permanent = status === 400 || status === 403;
      const nextStatus = permanent || attemptNo >= Number(delivery.max_attempts || 5) ? 'failed' : 'retry';
      await pg.connection(`UPDATE notification.delivery SET delivery_status=$2, attempt_count=$3, failed_at=CASE WHEN $2='failed' THEN now() ELSE failed_at END, last_error_code=$4, last_error=$5, locked_at=NULL, locked_by=NULL, next_attempt_at=CASE WHEN $2='retry' THEN now() + interval '1 minute' ELSE next_attempt_at END, updated_at=now() WHERE notification_delivery_id=$1`, [delivery.notification_delivery_id, nextStatus, attemptNo, String(status || error.code || 'SEND_ERROR'), error.message || String(error)]);
      await pg.connection(`INSERT INTO notification.delivery_attempt (notification_delivery_id, attempt_no, finished_at, outcome, error_code, error_message) VALUES ($1,$2,now(),$3,$4,$5)`, [delivery.notification_delivery_id, attemptNo, nextStatus, String(status || error.code || 'SEND_ERROR'), error.message || String(error)]);
      summary[nextStatus] += 1;
      if (status === 403) await pg.connection(`UPDATE public.match_follow SET follow_status='cancelled', unfollowed_at=now(), updated_at=now() WHERE user_id=$1 AND follow_status='active' AND match_id=(SELECT (aggregate_id)::integer FROM notification.event WHERE notification_event_id=$2)`, [delivery.user_id, delivery.notification_event_id]);
    }
  }
  return summary;
}

module.exports = { TYPE_BY_EVENT_KIND, renderTemplate, enqueueNotificationForMatchEvent, claimPendingDeliveries, sendPendingDeliveries };
