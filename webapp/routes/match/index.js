const { getMatchDetailsById } = require('../../services/matchDetailsService');

async function matchRoutes(fastify) {
  fastify.get('/:id', async (request, reply) => {
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

module.exports = matchRoutes;
