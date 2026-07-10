const { getCatalogBySportNames, getAvailableLeaguesForSport } = require('../../services/sportLeaguesCatalog');
const { normalizeSportsSettings, loadResolvedFavoriteSports } = require('../../services/favoritesStore');
const { invalidateRecommendationsCache } = require('../../services/recommendationService');
const { logUserEvent } = require('../../services/eventLogService');

function buildSportLookupKeys(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  const aliasMap = {
    football: ['football', 'soccer', 'футбол'],
    hockey: ['hockey', 'ice-hockey', 'хоккей'],
    tennis: ['tennis', 'теннис'],
    basketball: ['basketball', 'баскетбол'],
    esports: ['esports', 'csgo', 'dota2', 'кс:го', 'дота2', 'киберспорт'],
  };

  return aliasMap[normalized] || [normalized];
}

function normalizeSportOutput(row = {}) {
  return String(row.sport_name || row.sport_url || '').trim();
}

function buildResponseSportSetting(setting = {}) {
  const name = String(setting.name || '').trim();
  const leagues = Array.isArray(setting.leagues) ? setting.leagues : [];
  const availableLeagues = getAvailableLeaguesForSport(name);
  const sportUrl = String(setting.sport_url || '').trim();

  return {
    name,
    leagues,
    all_leagues: leagues.length === 0,
    available_leagues: availableLeagues,
    leagues_summary: leagues.length === 0 ? 'Все лиги' : leagues.join(', '),
    sport_url: sportUrl,
  };
}

async function favoritesRoutes(fastify) {
  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    const favoriteSports = await loadResolvedFavoriteSports(fastify.pg, userId);
    const allSports = await fastify.pg.connection(`
      SELECT sport_id, sport_name, sport_url
      FROM public.sport
      WHERE COALESCE(is_active, 0) = 1
      ORDER BY sport_id
    `);

    const response = {
      sports: favoriteSports.map(({ sport_name, sport_url, leagues }) => buildResponseSportSetting({ name: sport_name, sport_url, leagues })),
      profile: String(request.user?.profile || ''),
      available_sports: allSports
        .map((row) => ({ sport_name: normalizeSportOutput(row), sport_url: String(row.sport_url || '').trim() }))
        .filter((item) => item.sport_name),
      leagues_catalog: getCatalogBySportNames(allSports.map(normalizeSportOutput)),
    };

    await logUserEvent(fastify, request, {
      eventName: 'screen.favorites_open',
      statusCode: 200,
      entityId: 'favorites',
      meta: {
        screen: 'favorites',
        sports_count: response.sports.length,
        leagues_count: response.sports.reduce((sum, item) => sum + item.leagues.length, 0),
      },
    });

    return response;
  });

  fastify.put('/', async (request, reply) => {
    const payload = request.body || {};

    try {
      const requestedSports = normalizeSportsSettings(payload.sports);
      const userId = Number(request.user?.userId);
      const previousFavorites = await loadResolvedFavoriteSports(fastify.pg, userId);

      const allSports = await fastify.pg.connection(`
        SELECT sport_id, sport_name, sport_url
        FROM public.sport
        WHERE COALESCE(is_active, 0) = 1
      `);

      const allTournaments = await fastify.pg.connection(`
        SELECT tournament_id, sport_id, tournament_name, tournament_name_en
        FROM public.tournament
      `);

      const resolvedRows = requestedSports
        .map((sportSetting) => {
          const keys = buildSportLookupKeys(sportSetting.name);
          const row = allSports.find((sportRow) => keys.includes(String(sportRow.sport_url || '').trim().toLowerCase())
            || keys.includes(String(sportRow.sport_name || '').trim().toLowerCase()));

          return row ? { row, setting: sportSetting } : null;
        })
        .filter(Boolean);

      const resolvedSportIds = [...new Set(
        resolvedRows
          .map(({ row }) => Number(row.sport_id))
          .filter(Number.isFinite),
      )];

      await fastify.pg.connection('DELETE FROM public.user_tournament WHERE user_id = $1', [userId]);
      await fastify.pg.connection('DELETE FROM public.user_sport WHERE user_id = $1', [userId]);

      for (const sportId of resolvedSportIds) {
        await fastify.pg.connection(
          'INSERT INTO public.user_sport (user_id, sport_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, sportId],
        );
      }

      for (const { row, setting } of resolvedRows) {
        const sportId = Number(row.sport_id);
        const selectedLeagues = Array.isArray(setting.leagues) ? setting.leagues : [];
        if (selectedLeagues.length === 0) continue;

        const tournaments = allTournaments.filter((tournament) => Number(tournament.sport_id) === sportId);
        for (const league of selectedLeagues) {
          const target = String(league || '').trim().toLowerCase();
          const tournament = tournaments.find((item) => {
            const name = String(item.tournament_name || '').trim().toLowerCase();
            const nameEn = String(item.tournament_name_en || '').trim().toLowerCase();
            return target && (name === target || nameEn === target);
          });
          if (!tournament) continue;

          await fastify.pg.connection(
            'INSERT INTO public.user_tournament (user_id, tournament_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, Number(tournament.tournament_id)],
          );
        }
      }

      const updatedFavorites = await loadResolvedFavoriteSports(fastify.pg, userId);

      await invalidateRecommendationsCache({
        favoriteSportsSets: [previousFavorites, updatedFavorites],
        redisClient: fastify.recommendationsRedis,
      });

      const response = {
        sports: updatedFavorites.map(({ sport_name, sport_url, leagues }) => buildResponseSportSetting({ name: sport_name, sport_url, leagues })),
        profile: String(request.user?.profile || ''),
      };

      await logUserEvent(fastify, request, {
        eventName: 'favorites.update',
        statusCode: 200,
        entityId: 'profile',
        meta: {
          sports_count: response.sports.length,
          leagues_count: response.sports.reduce((sum, item) => sum + item.leagues.length, 0),
          favorites_count: response.sports.length + response.sports.reduce((sum, item) => sum + item.leagues.length, 0),
        },
      });

      return response;
    } catch (error) {
      return reply.status(400).send({
        error: error.message || 'Invalid payload',
      });
    }
  });

  fastify.delete('/', async (request, reply) => {
    const userId = Number(request.user?.userId);
    const previousFavorites = await loadResolvedFavoriteSports(fastify.pg, userId);

    await fastify.pg.connection('DELETE FROM public.user_tournament WHERE user_id = $1', [userId]);
    await fastify.pg.connection('DELETE FROM public.user_sport WHERE user_id = $1', [userId]);
    await invalidateRecommendationsCache({
      favoriteSportsSets: [previousFavorites, []],
      redisClient: fastify.recommendationsRedis,
    });

    await logUserEvent(fastify, request, {
      eventName: 'favorites.clear',
      statusCode: 200,
      entityId: 'profile',
      meta: {
        sports_count: 0,
        leagues_count: 0,
        favorites_count: 0,
      },
    });

    return reply.send(1);
  });
}

module.exports = favoritesRoutes;
