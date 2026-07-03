const { getRecommendations } = require('../../services/recommendationService');
const { fetchAllMatches, fetchPopularBets, selectRiskBets } = require('../../../lib/stavkaApi');
const { getCurrentBriefsByMatchIds, getCurrentBriefsByMatchSlugs, mapCurrentRowToApiBrief } = require('../../services/aiBriefStore');

async function loadFavoriteSports(fastify, userId) {
  const rows = await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.user_sport fs
    JOIN public.sport s ON s.sport_id = fs.sport_id
    WHERE fs.user_id = $1
    ORDER BY fs.sport_id
  `, [userId]);

  return rows.map((row) => ({
    ...row,
    leagues: [],
  }));
}

function isSyntheticMatchId(id) {
  return !(typeof id === 'number' && Number.isFinite(id));
}

function normalizeForecast(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyRiskByCoeff(coeff) {
  const rate = Number(coeff);
  if (!Number.isFinite(rate)) return 'medium';
  if (rate <= 1.95) return 'low';
  if (rate <= 3.3) return 'medium';
  return 'high';
}

function riskDescription(label) {
  if (label === 'low') return 'Низкий риск';
  if (label === 'medium') return 'Средний риск';
  return 'Высокий риск';
}

function riskRank(label) {
  if (label === 'low') return 0;
  if (label === 'medium') return 1;
  return 2;
}

function buildPriorityBetFromBrief(row) {
  const forecast = String(row?.primary_forecast || '').trim();
  const coeff = Number(row?.primary_coeff);
  if (!forecast || !Number.isFinite(coeff)) return null;

  const riskLabel = classifyRiskByCoeff(coeff);
  return {
    type: 'primary',
    risk_order: 1,
    risk_label: riskLabel,
    forecast,
    coeff: Number(coeff.toFixed(2)),
    probability: Math.max(5, Math.min(70, Math.round((1 / coeff) * 100))),
    confidence: row?.primary_confidence ? String(row.primary_confidence) : (riskLabel === 'low' ? 'высокая' : riskLabel === 'medium' ? 'средняя' : 'ниже средней'),
    description: riskDescription(riskLabel),
    source: 'ai_brief_primary',
  };
}

function mergePriorityBetIntoItem(item, priorityBet) {
  if (!priorityBet) return item;

  const existing = Array.isArray(item?.bets) ? item.bets : [];
  const seenForecasts = new Set([normalizeForecast(priorityBet.forecast)]);
  const usedRiskLabels = new Set([String(priorityBet.risk_label || '')]);
  const uniqueByRisk = [];

  for (const bet of existing) {
    if (!bet) continue;
    const forecastKey = normalizeForecast(bet.forecast);
    if (forecastKey && seenForecasts.has(forecastKey)) {
      continue;
    }
    if (forecastKey) seenForecasts.add(forecastKey);

    const riskLabel = String(bet.risk_label || '');
    if (riskLabel && !usedRiskLabels.has(riskLabel)) {
      uniqueByRisk.push(bet);
      usedRiskLabels.add(riskLabel);
    }
  }

  const merged = [priorityBet, ...uniqueByRisk]
    .sort((a, b) => {
      const rankDiff = riskRank(String(a?.risk_label || '')) - riskRank(String(b?.risk_label || ''));
      if (rankDiff !== 0) return rankDiff;
      return Number(a?.coeff || 999) - Number(b?.coeff || 999);
    })
    .slice(0, 3)
    .map((bet, index) => ({
      ...bet,
      type: index === 0 ? 'primary' : index === 1 ? 'value' : 'additional',
      risk_order: index + 1,
    }));

  return {
    ...item,
    bets: merged,
  };
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
      const mergedItem = mergePriorityBetIntoItem(item, buildPriorityBetFromBrief(row));
      const aiBrief = mapCurrentRowToApiBrief(row);
      return { ...mergedItem, ai_brief: aiBrief };
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
    const favoriteSports = await loadFavoriteSports(fastify, userId);
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
