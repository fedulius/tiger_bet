function createFakePg({ rows = [] } = {}) {
  const calls = [];

  return {
    calls,
    async connection(query, params) {
      calls.push({ query, params });
      return rows;
    },
  };
}

function buildTestApp(buildApp, options = {}) {
  return buildApp({
    pg: options.pg || createFakePg(),
    bot: null,
    ...options,
  });
}

module.exports = {
  buildTestApp,
  createFakePg,
};
