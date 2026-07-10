'use strict';

const {
  assertMatchFollowFeatureAvailable,
  getFollowState,
  followMatch,
  unfollowMatch,
  defaultFetchSstats,
  __private: { parseSstatsId },
} = require('../../services/matchFollowService');

const FEATURE_DISABLED_MESSAGE = 'Отслеживание матчей временно недоступно: схема уведомлений ещё не применена.';

function sendFeatureDisabled(reply) {
  return reply.status(503).send({ error: 'FEATURE_DISABLED', message: FEATURE_DISABLED_MESSAGE });
}

async function requireMatchFollowFeature(fastify, reply) {
  const feature = await assertMatchFollowFeatureAvailable(fastify.pg);
  if (!feature.available) {
    sendFeatureDisabled(reply);
    return false;
  }
  return true;
}

function currentUserId(request) {
  return request.user?.userId;
}

function parseRequestId(request, reply) {
  const id = parseSstatsId(request.params?.id);
  if (id == null) {
    reply.status(400).send({ error: 'INVALID_MATCH_ID' });
    return null;
  }
  return id;
}

function sendServiceResult(reply, result) {
  if (result?.statusCode) return reply.status(result.statusCode).send({ error: result.error });
  return reply.send(result);
}

async function matchFollowRoutes(fastify) {
  fastify.get('/match/:id/follow', async (request, reply) => {
    if (!(await requireMatchFollowFeature(fastify, reply))) return;
    const id = parseRequestId(request, reply);
    if (id == null) return;
    const result = await getFollowState({ pg: fastify.pg, userId: currentUserId(request), sstatsId: id });
    return reply.send({ following: result.following, canFollow: result.canFollow, isFinished: result.isFinished });
  });

  fastify.put('/match/:id/follow', async (request, reply) => {
    if (!(await requireMatchFollowFeature(fastify, reply))) return;
    const id = parseRequestId(request, reply);
    if (id == null) return;
    const result = await followMatch({ pg: fastify.pg, userId: currentUserId(request), sstatsId: id, fetcher: fastify.matchFollowFetcher || defaultFetchSstats, fastify, loggerRequest: request });
    return sendServiceResult(reply, result);
  });

  fastify.delete('/match/:id/follow', async (request, reply) => {
    if (!(await requireMatchFollowFeature(fastify, reply))) return;
    const id = parseRequestId(request, reply);
    if (id == null) return;
    const result = await unfollowMatch({ pg: fastify.pg, userId: currentUserId(request), sstatsId: id, fastify, loggerRequest: request });
    return sendServiceResult(reply, result);
  });
}

module.exports = matchFollowRoutes;
module.exports.autoPrefix = false;
module.exports.__private = { FEATURE_DISABLED_MESSAGE, sendFeatureDisabled, currentUserId, parseRequestId };
