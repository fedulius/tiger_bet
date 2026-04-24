const {Pool} = require('pg');
const config = require('../config/pgConfig');

class pgConnect {

  connection(query, params) {
    const pool = new Pool(config);
    return pool.query(query, params)
      .then((results) => results.rows)
      .catch((e) => {
        console.log(`something wrong ${e} in query ${query}`);
        throw e;
      })
      .finally(() => {
        pool.end();
      });
  }

}

module.exports = pgConnect;
