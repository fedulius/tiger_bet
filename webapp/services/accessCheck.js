/**
 * Runtime access check for heavy routes.
 * Re-verifies user_access on each call so revoked users lose access immediately.
 *
 * @param {object} fastify - Fastify instance with pg decorator
 * @param {object} request - Fastify request with request.user from JWT
 * @returns {Promise<{allowed: boolean, scope?: string}>}
 */
async function checkHeavyRouteAccess(fastify, request) {
  const userId = Number(request.user?.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { allowed: false };
  }

  try {
    const rows = await fastify.pg.connection(`
      SELECT s.access_scope_name
      FROM public.user_access ua
      JOIN public.access_scope s ON s.access_scope_id = ua.access_scope_id
      WHERE ua.user_id = $1
        AND ua.is_allowed = true
        AND s.access_scope_name IN ('admin', 'webapp')
      ORDER BY ua.access_scope_id ASC
      LIMIT 1;
    `, [userId]);

    if (!rows[0]) {
      return { allowed: false };
    }

    return { allowed: true, scope: rows[0].access_scope_name };
  } catch {
    return { allowed: false };
  }
}

module.exports = { checkHeavyRouteAccess };
