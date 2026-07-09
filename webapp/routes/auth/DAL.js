class DAL {
  constructor(pg) {
    this.pg = pg;
  }

  async checkWebappAccess(telegramUserId) {
    if (telegramUserId === undefined || telegramUserId === null) {
      throw new Error('telegramUserId is required');
    }

    const rows = await this.pg.connection(`
      SELECT
        u.user_id,
        epu.system_user_id AS telegram_user_id,
        ua.is_allowed,
        s.access_scope_name AS granted_scope
      FROM external.public_user epu
      JOIN public.user u ON u.user_id = epu.user_id
      JOIN public.access_scope s ON s.access_scope_name IN ('admin', 'webapp')
      JOIN public.user_access ua
        ON ua.user_id = u.user_id
       AND ua.access_scope_id = s.access_scope_id
      WHERE epu.system_id = 1
        AND epu.system_user_id = $1
        AND ua.is_allowed = true
      ORDER BY s.access_scope_id ASC
      LIMIT 1;
    `, [telegramUserId]);

    return rows[0] || null;
  }
}

module.exports = DAL;
