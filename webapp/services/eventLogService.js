function normalizePath(request) {
  const routePath = String(request?.routeOptions?.url || '').trim();
  if (routePath) {
    return routePath;
  }

  const rawUrl = String(request?.url || '').trim();
  if (!rawUrl) {
    return '/';
  }

  const [pathOnly] = rawUrl.split('?');
  return pathOnly || '/';
}

function normalizeSessionId(request, explicitSessionId = null) {
  const candidate = explicitSessionId
    ?? request?.headers?.['x-session-id']
    ?? request?.id
    ?? null;

  const value = String(candidate || '').trim();
  return value || null;
}

function deriveUserIds(request, overrides = {}) {
  const telegramUserId = overrides.telegramUserId
    ?? request?.user?.telegram_user_id
    ?? null;

  const webappUserId = overrides.webappUserId
    ?? request?.user?.userId
    ?? null;

  const normalizedTelegramUserId = Number(telegramUserId);
  const normalizedWebappUserId = Number(webappUserId);

  return {
    telegramUserId: Number.isFinite(normalizedTelegramUserId) ? normalizedTelegramUserId : null,
    webappUserId: Number.isFinite(normalizedWebappUserId) ? normalizedWebappUserId : null,
  };
}

async function logUserEvent(fastify, request, {
  eventName,
  statusCode = 200,
  entityId = null,
  source = 'webapp',
  meta = {},
  telegramUserId = null,
  webappUserId = null,
  sessionId = null,
} = {}) {
  if (!fastify?.pg || typeof fastify.pg.connection !== 'function') {
    return false;
  }

  const normalizedEventName = String(eventName || '').trim();
  if (!normalizedEventName) {
    return false;
  }

  const userIds = deriveUserIds(request, { telegramUserId, webappUserId });
  const payloadMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

  try {
    await fastify.pg.connection(
      `SELECT *
         FROM logger.user_event_log_create(
           p_event_name       := $1,
           p_telegram_user_id := $2,
           p_webapp_user_id   := $3,
           p_path             := $4,
           p_method           := $5,
           p_status_code      := $6,
           p_entity_id        := $7,
           p_source           := $8,
           p_session_id       := $9,
           p_meta             := $10::jsonb
         )`,
      [
        normalizedEventName,
        userIds.telegramUserId,
        userIds.webappUserId,
        normalizePath(request),
        String(request?.method || 'GET').toUpperCase(),
        Number(statusCode) || 200,
        entityId == null ? null : String(entityId),
        String(source || 'webapp').trim() || 'webapp',
        normalizeSessionId(request, sessionId),
        JSON.stringify(payloadMeta),
      ],
    );
    return true;
  } catch (error) {
    request?.log?.warn?.({ err: error, eventName: normalizedEventName }, 'user event log insert failed');
    return false;
  }
}

module.exports = {
  logUserEvent,
  __private: {
    normalizePath,
    normalizeSessionId,
    deriveUserIds,
  },
};
