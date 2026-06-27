const { getRecommendations } = require('../../services/recommendationService');
const { getFavoritesByProfile } = require('../../services/favoritesStore');
const { fetchAllMatches, fetchPopularBets, selectRiskBets } = require('../../../lib/stavkaApi');
const { getCurrentBriefsByMatchIds, getCurrentBriefsByMatchSlugs, mapCurrentRowToApiBrief } = require('../../services/aiBriefStore');

async function loadFavoriteSports(fastify, userId, profile) {
  const rows = await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.favorite_sport fs
    JOIN public.sport s ON s.sport_id = fs.sport_id
    WHERE fs.user_id = $1
    ORDER BY fs.sport_id
  `, [userId]);

  const stored = getFavoritesByProfile(profile);
  const settingsMap = new Map((stored.sport_settings || []).map((item) => [String(item.name || '').trim(), item]));

  return rows.map((row) => {
    const sportName = String(row.sport_name || row.sport_url || '').trim();
    const existing = settingsMap.get(sportName);

    return {
      ...row,
      leagues: Array.isArray(existing?.leagues) ? existing.leagues : [],
    };
  });
}

function isSyntheticMatchId(id) {
  return !(typeof id === 'number' && Number.isFinite(id));
}

async function enrichWithAiBriefs(pg, log, result) {
  const items = result?.items;
  if (!Array.isArray(items) || items.length === 0) return result;

  const matchIds = items
    .map((item) => item.match_id)
    .filter((id) => !isSyntheticMatchId(id));

  const matchSlugs = items
    .filter((item) => isSyntheticMatchId(item.match_id))
    .map((item) => item.match_slug)
    .filter((slug) => typeof slug === 'string' && slug.length > 0);

  if (matchIds.length === 0 && matchSlugs.length === 0) return result;

  try {
    const [briefsById, briefsBySlug] = await Promise.all([
      matchIds.length > 0
        ? getCurrentBriefsByMatchIds(pg, { matchIds })
        : Promise.resolve(new Map()),
      matchSlugs.length > 0
        ? getCurrentBriefsByMatchSlugs(pg, { matchSlugs })
        : Promise.resolve(new Map()),
    ]);

    const enrichedItems = items.map((item) => {
      const row = isSyntheticMatchId(item.match_id)
        ? briefsBySlug.get(String(item.match_slug || ''))
        : briefsById.get(Number(item.match_id));
      if (!row || (row.status !== 'ready' && row.status !== 'stale')) {
        return item;
      }
      return { ...item, ai_brief: mapCurrentRowToApiBrief(row) };
    });

    return { ...result, items: enrichedItems };
  } catch (err) {
    log.warn({ err }, 'ai brief enrichment failed');
    return result;
  }
}

async function recommendationsRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const userId = Number(request.user?.userId);
    const profile = String(request.user?.profile || '');
    const favoriteSports = await loadFavoriteSports(fastify, userId, profile);
    const recommendationsVersion = String(request.query?.recommendations_version || '').trim();
    const result = await getRecommendations({
      favoriteSports,
      recommendationsVersion,
      redisClient: fastify.recommendationsRedis,
      apiLoader: fetchAllMatches,
      popularBetsLoader: fetchPopularBets,
      riskBetsSelector: selectRiskBets,
    });

    if (result?.stale_version) {
      reply.code(409);
      return {
        error: 'STALE_RECOMMENDATIONS_VERSION',
        message: 'Рекомендации обновились',
        reload_from_start: true,
        recommendations_version: result.recommendations_version,
        current_recommendations_version: result.current_recommendations_version || '',
      };
    }

    return enrichWithAiBriefs(fastify.pg, fastify.log, result);
  });
}

module.exports = recommendationsRoutes;
