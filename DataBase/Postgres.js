const {Pool} = require('pg');
const config = require('../config/pgConfig');

class pgConnect {

  async connection(query, params) {
    const pool = new Pool(config);
    try {
      const results = await pool.query(query, params);
      return results.rows;
    } catch (e) {
      console.log(`something wrong ${e} in query ${query}`);
    } finally {
      pool.end();
    }
  }

}

module.exports = pgConnect;