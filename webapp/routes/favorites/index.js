const { getCatalogBySportNames, getAvailableLeaguesForSport } = require('../../services/sportLeaguesCatalog');
const { getFavoritesByProfile, normalizeSportsSettings, saveFavoritesByProfile } = require('../../services/favoritesStore');
const { invalidateRecommendationsCache } = require('../../services/recommendationService');

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

async function loadResolvedFavoriteSports(fastify, userId, profile) {
  const rows = await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.user_sport fs
    JOIN public.sport s ON s.sport_id = fs.sport_id
    WHERE fs.user_id = $1
    ORDER BY fs.sport_id
  `, [userId]);
  const stored = getFavoritesByProfile(profile);
  const sportSettings = stored.sport_settings || [];
  const sportSettingsMap = new Map(sportSettings.map((item) => [item.name, item]));

  let resolvedRows = rows;
  if (resolvedRows.length === 0 && sportSettings.length > 0) {
    const allSports = await fastify.pg.connection(`
      SELECT sport_id, sport_name, sport_url
      FROM public.sport
      ORDER BY sport_id
    `);

    resolvedRows = allSports.filter((row) => {
      const rowKeys = buildSportLookupKeys(normalizeSportOutput(row));
      return sportSettings.some((item) => {
        const wantedKeys = buildSportLookupKeys(item?.name);
        return wantedKeys.some((key) => rowKeys.includes(key));
      });
    });
  }

  return resolvedRows.map((row) => {
    const resolvedName = normalizeSportOutput(row);
    const existing = sportSettingsMap.get(resolvedName);

    return {
      sport_id: Number(row.sport_id),
      sport_name: resolvedName,
      leagues: Array.isArray(existing?.leagues) ? existing.leagues : [],
    };
  });
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
    const profile = String(request.user?.profile || '');
    let rows = await fastify.pg.connection(`
      SELECT s.sport_name, s.sport_url
      FROM public.user_sport fs
      JOIN public.sport s ON s.sport_id = fs.sport_id
      WHERE fs.user_id = $1
      ORDER BY fs.sport_id
    `, [userId]);
    const allSports = await fastify.pg.connection(`
      SELECT sport_id, sport_name, sport_url
      FROM public.sport
      ORDER BY sport_id
    `);

    const stored = getFavoritesByProfile(profile);
    const sportSettings = stored.sport_settings || [];
    const sportSettingsMap = new Map(sportSettings.map((item) => [item.name, item]));
    if (rows.length === 0 && sportSettings.length > 0) {
      rows = allSports.filter((row) => {
        const rowKeys = buildSportLookupKeys(normalizeSportOutput(row));
        return sportSettings.some((item) => {
          const wantedKeys = buildSportLookupKeys(item?.name);
          return wantedKeys.some((key) => rowKeys.includes(key));
        });
      });
    }
    const sportRows = rows
      .map((row) => ({ name: normalizeSportOutput(row), sport_url: String(row.sport_url || '').trim() }))
      .filter((item) => item.name);
    const sportSettingsResponse = sportRows.map(({ name, sport_url }) => {
      const existing = sportSettingsMap.get(name);
      return buildResponseSportSetting({ ...(existing || { name, leagues: [] }), sport_url });
    });

    return {
      sports: sportSettingsResponse,
      profile,
      available_sports: allSports
        .map((row) => ({ sport_name: normalizeSportOutput(row), sport_url: String(row.sport_url || '').trim() }))
        .filter((item) => item.sport_name),
      leagues_catalog: getCatalogBySportNames(allSports.map(normalizeSportOutput)),
    };
  });

  fastify.put('/', async (request, reply) => {
    const payload = request.body || {};

    try {
      const requestedSports = normalizeSportsSettings(payload.sports);
      const userId = Number(request.user?.userId);
      const profile = String(request.user?.profile || '');
      const previousFavorites = await loadResolvedFavoriteSports(fastify, userId, profile);

      const allSports = await fastify.pg.connection(`
        SELECT sport_id, sport_name, sport_url
        FROM public.sport
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

      await fastify.pg.connection('DELETE FROM public.user_sport WHERE user_id = $1', [userId]);

      for (const sportId of resolvedSportIds) {
        await fastify.pg.connection(
          'INSERT INTO public.user_sport (user_id, sport_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, sportId],
        );
      }

      const updatedFavorites = resolvedRows.map(({ row, setting }) => {
        const resolvedName = normalizeSportOutput(row);
        const allowedLeagues = new Set(getAvailableLeaguesForSport(resolvedName));
        const leagues = (setting.leagues || []).filter((league) => allowedLeagues.has(league));

        return {
          sport_id: Number(row.sport_id),
          sport_name: resolvedName,
          sport_url: String(row.sport_url || '').trim(),
          leagues,
        };
      });
      const persistedSettings = updatedFavorites.map(({ sport_name, leagues }) => ({
        name: sport_name,
        leagues,
      }));

      saveFavoritesByProfile(profile, { sport_settings: persistedSettings });
      await invalidateRecommendationsCache({
        favoriteSportsSets: [previousFavorites, updatedFavorites],
        redisClient: fastify.recommendationsRedis,
      });

      return {
        sports: updatedFavorites.map(({ sport_name, sport_url, leagues }) => buildResponseSportSetting({ name: sport_name, sport_url, leagues })),
        profile,
      };
    } catch (error) {
      return reply.status(400).send({
        error: error.message || 'Invalid payload',
      });
    }
  });

  fastify.delete('/', async (request, reply) => {
    const userId = Number(request.user?.userId);
    const profile = String(request.user?.profile || '');
    const previousFavorites = await loadResolvedFavoriteSports(fastify, userId, profile);

    await fastify.pg.connection('DELETE FROM public.user_sport WHERE user_id = $1', [userId]);
    saveFavoritesByProfile(profile, { sport_settings: [] });
    await invalidateRecommendationsCache({
      favoriteSportsSets: [previousFavorites, []],
      redisClient: fastify.recommendationsRedis,
    });

    return reply.send(1);
  });
}

module.exports = favoritesRoutes;
