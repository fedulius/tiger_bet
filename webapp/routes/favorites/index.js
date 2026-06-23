const { getCatalogBySportNames, getAvailableLeaguesForSport } = require('../../services/sportLeaguesCatalog');
const { getFavoritesByProfile, normalizeSportsSettings, saveFavoritesByProfile } = require('../../services/favoritesStore');

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

  return {
    name,
    leagues,
    all_leagues: leagues.length === 0,
    available_leagues: availableLeagues,
    leagues_summary: leagues.length === 0 ? 'Все лиги' : leagues.join(', '),
  };
}

async function favoritesRoutes(fastify) {
  fastify.get('/', async (request) => {
    const userId = Number(request.user?.userId);
    const profile = String(request.user?.profile || '');
    const rows = await fastify.pg.connection(`
      SELECT s.sport_name, s.sport_url
      FROM public.favorite_sport fs
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
    const sportSettingsMap = new Map((stored.sport_settings || []).map((item) => [item.name, item]));
    const sports = rows.map(normalizeSportOutput).filter(Boolean);
    const sportSettings = sports.map((name) => {
      const existing = sportSettingsMap.get(name);
      return buildResponseSportSetting(existing || { name, leagues: [] });
    });

    return {
      sports: sportSettings,
      profile,
      available_sports: allSports.map(normalizeSportOutput).filter(Boolean),
      leagues_catalog: getCatalogBySportNames(allSports.map(normalizeSportOutput)),
    };
  });

  fastify.put('/', async (request, reply) => {
    const payload = request.body || {};

    try {
      const requestedSports = normalizeSportsSettings(payload.sports);
      const userId = Number(request.user?.userId);
      const profile = String(request.user?.profile || '');

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

      await fastify.pg.connection('DELETE FROM public.favorite_sport WHERE user_id = $1', [userId]);

      for (const sportId of resolvedSportIds) {
        await fastify.pg.connection(
          'INSERT INTO public.favorite_sport (user_id, sport_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, sportId],
        );
      }

      const persistedSettings = resolvedRows.map(({ row, setting }) => {
        const resolvedName = normalizeSportOutput(row);
        const allowedLeagues = new Set(getAvailableLeaguesForSport(resolvedName));
        const leagues = (setting.leagues || []).filter((league) => allowedLeagues.has(league));

        return {
          name: resolvedName,
          leagues,
        };
      });

      saveFavoritesByProfile(profile, { sport_settings: persistedSettings });

      return {
        sports: persistedSettings.map(buildResponseSportSetting),
        profile,
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
