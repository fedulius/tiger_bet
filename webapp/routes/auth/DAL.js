class DAL {
  constructor(pg) {
    this.pg = pg;
  }

  async checkUser(telegramUserId) {
    if (telegramUserId === undefined || telegramUserId === null) {
      throw new Error('telegramUserId is required');
    }

    return await this.pg.connection(`
      SELECT user_id, system_user_id, system_id
      FROM external.public_user
      WHERE system_user_id = $1
        AND system_id = 1;
    `, [telegramUserId])
  }
}

module.exports = DAL;