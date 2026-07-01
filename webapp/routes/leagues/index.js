async function leaguesRoutes(fastify) {

  // Auth preHandler for favorites endpoints
  async function requireAuth(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }

  // GET /leagues/sports — все виды спорта с количеством турниров
  fastify.get('/sports', async (request, reply) => {
    const rows = await fastify.pg.connection(`
      SELECT s.sport_id, s.sport_name, s.sport_url,
             COUNT(t.tournament_id) AS tournament_count
      FROM public.sport s
      LEFT JOIN public.tournament t ON t.sport_id = s.sport_id
      GROUP BY s.sport_id, s.sport_name, s.sport_url
      ORDER BY s.sport_id
    `);
    return { sports: rows };
  });

  // GET /leagues/sports/:sportId/countries — страны для вида спорта
  fastify.get('/sports/:sportId/countries', async (request, reply) => {
    const sportId = Number(request.params.sportId);
    if (!Number.isFinite(sportId)) {
      reply.code(400);
      return { error: 'Invalid sportId' };
    }

    const rows = await fastify.pg.connection(`
      SELECT c.country_id, c.country_name, c.country_name_en, c.country_code, c.country_image_path,
             COUNT(t.tournament_id) AS tournament_count
      FROM public.country c
      INNER JOIN public.tournament t ON t.country_id = c.country_id AND t.sport_id = $1
      GROUP BY c.country_id, c.country_name, c.country_name_en, c.country_code, c.country_image_path
      ORDER BY c.country_name
    `, [sportId]);

    return { countries: rows };
  });

  // GET /leagues/sports/:sportId/countries/:countryId/leagues — лиги для страны
  fastify.get('/sports/:sportId/countries/:countryId/leagues', async (request, reply) => {
    const sportId = Number(request.params.sportId);
    const countryId = Number(request.params.countryId);
    if (!Number.isFinite(sportId) || !Number.isFinite(countryId)) {
      reply.code(400);
      return { error: 'Invalid sportId or countryId' };
    }

    const rows = await fastify.pg.connection(`
      SELECT t.tournament_id, t.tournament_name, t.tournament_name_en,
             t.tournament_code, t.tournament_image_path, t.tournament_active,
             tt.type_title AS tournament_type
      FROM public.tournament t
      JOIN public.tournament_type tt ON t.tournament_type_id = tt.tournament_type_id
      WHERE t.sport_id = $1 AND t.country_id = $2
      ORDER BY t.tournament_name
    `, [sportId, countryId]);

    return { leagues: rows };
  });

  // GET /leagues/favorites — избранные турниры текущего пользователя
  fastify.get('/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number(request.user?.userId);
    if (!Number.isFinite(userId)) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const rows = await fastify.pg.connection(`
      SELECT t.tournament_id, t.tournament_name, t.tournament_name_en,
             t.tournament_image_path, c.country_name, s.sport_name
      FROM public.user_tournament ut
      JOIN public.tournament t ON t.tournament_id = ut.tournament_id
      JOIN public.country c ON c.country_id = t.country_id
      JOIN public.sport s ON s.sport_id = t.sport_id
      WHERE ut.user_id = $1
      ORDER BY c.country_name, t.tournament_name, t.tournament_id
    `, [userId]);

    return { favorites: rows };
  });

  // POST /leagues/favorites — добавить турнир в избранное
  fastify.post('/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number(request.user?.userId);
    if (!Number.isFinite(userId)) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const tournamentId = Number(request.body?.tournament_id);
    if (!Number.isFinite(tournamentId)) {
      reply.code(400);
      return { error: 'Invalid tournament_id' };
    }

    await fastify.pg.connection(
      'SELECT public.user_tournament_create($1, $2)',
      [userId, tournamentId]
    );

    return { ok: true };
  });

  // DELETE /leagues/favorites/:tournamentId — убрать из избранного
  fastify.delete('/favorites/:tournamentId', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number(request.user?.userId);
    if (!Number.isFinite(userId)) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const tournamentId = Number(request.params.tournamentId);
    if (!Number.isFinite(tournamentId)) {
      reply.code(400);
      return { error: 'Invalid tournamentId' };
    }

    await fastify.pg.connection(
      'SELECT public.user_tournament_delete($1, $2)',
      [userId, tournamentId]
    );

    return { ok: true };
  });
}

module.exports = leaguesRoutes;
