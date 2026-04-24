const { getHistory } = require('../services/historyService');

async function historyRoutes(fastify) {
  fastify.get('/api/webapp/history', async (request) => {
    const sample = String(request.query?.sample || '') === '1';
    return getHistory({ sample });
  });
}

module.exports = historyRoutes;
