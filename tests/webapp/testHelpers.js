function createFakePg({ rows = [], handler = null } = {}) {
  const calls = [];

  return {
    calls,
    async connection(query, params) {
      calls.push({ query, params });
      if (typeof handler === 'function') {
        return handler(query, params, calls);
      }
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
