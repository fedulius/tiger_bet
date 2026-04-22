const { getHistory } = require('../services/historyService');

function registerHistoryRoutes(fastify) {
  fastify.get('/api/webapp/history', async (request) => {
    const sample = String(request.query?.sample || '') === '1';
    return getHistory({ sample });
  });
}

module.exports = {
  registerHistoryRoutes,
};
