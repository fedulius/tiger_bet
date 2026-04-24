class DAL {

  constructor({pg}) {
    this.pg = pg;
  }

  async getCategories() {
    return await this.pg.connection(`
      SELECT *
      FROM public.sport_category
    `);
  }

  async getUser(userId, username, first_name, language_code) {
    return await this.pg.connection(`
      SELECT *
      FROM public.user_sync($1, $2, $3, $4, $5)
    `, [
      userId, 1, username, first_name, language_code
    ]);
  }
}

module.exports = DAL;
