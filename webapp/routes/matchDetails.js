const { getMatchDetailsById } = require('../services/matchDetailsService');

async function matchDetailsRoutes(fastify) {
  fastify.get('/api/webapp/match/:id', async (request, reply) => {
    const { id } = request.params;
    const details = getMatchDetailsById(id);

    if (!details) {
      return reply.status(404).send({
        error: 'Match not found',
      });
    }

    return details;
  });
}

module.exports = matchDetailsRoutes;
