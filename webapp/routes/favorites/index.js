function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    throw new Error('sports and leagues must be arrays');
  }

  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )];
}

function buildSportLookupKeys(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  const aliasMap = {
    football: ['football', 'soccer'],
    hockey: ['hockey', 'ice-hockey'],
    tennis: ['tennis'],
    basketball: ['basketball'],
    esports: ['esports', 'csgo', 'dota2'],
  };

  return aliasMap[normalized] || [normalized];
}

function normalizeSportOutput(row = {}) {
  return String(row.sport_url || row.sport_name || '').trim();
}

async function favoritesRoutes(fastify) {
  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    const rows = await fastify.pg.connection(`
      SELECT s.sport_name, s.sport_url
      FROM public.favorite_sport fs
      JOIN public.sport s ON s.sport_id = fs.sport_id
      WHERE fs.user_id = $1
      ORDER BY fs.sport_id
    `, [userId]);

    return {
      sports: rows.map(normalizeSportOutput).filter(Boolean),
      leagues: [],
      profile: String(request.user?.profile || ''),
    };
  });

  fastify.put('/', async (request, reply) => {
    const payload = request.body || {};

    try {
      const sports = normalizeStringArray(payload.sports);
      const leagues = normalizeStringArray(payload.leagues);
      const userId = Number(request.user?.userId);

      const allSports = await fastify.pg.connection(`
        SELECT sport_id, sport_name, sport_url
        FROM public.sport
      `);

      const resolvedRows = sports
        .map((sport) => {
          const keys = buildSportLookupKeys(sport);
          return allSports.find((row) => keys.includes(String(row.sport_url || '').trim().toLowerCase())
            || keys.includes(String(row.sport_name || '').trim().toLowerCase()));
        })
        .filter(Boolean);

      const resolvedSportIds = [...new Set(
        resolvedRows
          .map((row) => Number(row.sport_id))
          .filter(Number.isFinite),
      )];

      await fastify.pg.connection('DELETE FROM public.favorite_sport WHERE user_id = $1', [userId]);

      for (const sportId of resolvedSportIds) {
        await fastify.pg.connection(
          'INSERT INTO public.favorite_sport (user_id, sport_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, sportId],
        );
      }

      return {
        sports: resolvedRows.map(normalizeSportOutput).filter(Boolean),
        leagues,
        profile: String(request.user?.profile || ''),
      };
    } catch (error) {
      return reply.status(400).send({
        error: error.message || 'Invalid payload',
      });
    }
  });

  fastify.delete('/', async (req, res) => {
    res.send(1);
  });
}

module.exports = favoritesRoutes;
