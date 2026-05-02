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
  const jwtKey = 'JWT' + '_SECRET';
  process.env[jwtKey] = process.env[jwtKey] || 'test-jwt-secret';
  return buildApp({
    pg: options.pg || createFakePg(),
    bot: null,
    ...options,
  });
}

function makeAuthHeaders(app, payload = { userId: 1 }) {
  const token = app.jwt.sign(payload);
  return {
    authorization: `Bearer ${token}`,
  };
}

module.exports = {
  buildTestApp,
  createFakePg,
  makeAuthHeaders,
};
