class DAL {

  constructor({pg}) {
    this.pg = pg;
  }

  async getCategories() {
    return await this.pg.connection(`
      SELECT *
      FROM public.prediction_category
    `);
  }
}

module.exports = DAL;
