'use strict';

const stavkaApi = require('../lib/stavkaApi');
const sstatsApi = require('../lib/sstatsApi');
const { normalizeCandidate, getCandidateMatchesForDate } = require('../webapp/services/dailyPickCandidateService');
const { rankCandidateMatches } = require('../webapp/services/dailyPickRankingService');
const { resolveDbContextForCandidate } = require('../webapp/services/dailyPickMappingService');
const { persistBundleSnapshot, persistAnalysisSnapshot } = require('../webapp/services/dailyPickPersistenceService');
const { getMoscowDate } = require('../webapp/services/dailyPickReadService');

const MATCHES_PER_DAY = 3; // максимум матчей на слот (today + tomorrow)

// ── Load users with favorites ──────────────────────────────
async function loadUsersWithFavorites(pg) {
  const rows = await pg.connection(`
    SELECT DISTINCT us.user_id
    FROM public.user_sport us
    ORDER BY us.user_id
  `);
  return rows.map(r => ({ id: r.user_id, user_id: r.user_id }));
}

// ── Load user's favorite league scope ──────────────────────
async function loadUserLeagueScope(pg, userId) {
  const rows = await pg.connection(`
    SELECT t.tournament_id, t.tournament_name, t.tournament_name_en
    FROM public.user_tournament ut
    JOIN public.tournament t ON t.tournament_id = ut.tournament_id
    WHERE ut.user_id = $1
  `, [userId]);

  const leagueIds = rows.map(r => Number(r.tournament_id)).filter(Number.isFinite);
  const leagueNames = [];
  for (const r of rows) {
    if (r.tournament_name_en) leagueNames.push(String(r.tournament_name_en).trim().toLowerCase());
    if (r.tournament_name) leagueNames.push(String(r.tournament_name).trim().toLowerCase());
  }
  const uniqueLeagueNames = [...new Set(leagueNames)].filter(Boolean);

  return { leagueIds, leagueSlugs: uniqueLeagueNames };
}

// ── Load candidates for a user + date ──────────────────────
async function loadCandidatesForUser({ pg, user, targetDate, allMatches }) {
  const userId = user.id ?? user.user_id;
  const scope = await loadUserLeagueScope(pg, userId);

  if (scope.leagueIds.length === 0 && scope.leagueSlugs.length === 0) {
    return [];
  }

  // Filter matches by Moscow date and league scope
  const candidates = getCandidateMatchesForDate({
    allMatches,
    userLeagueScope: scope,
    targetDateMsk: targetDate,
  });

  return candidates;
}

// ── Build source payload for LLM (reuses aiBriefSourceService logic) ─────────
async function buildSourcePayload(match, popularBetsLoader, matchDetailLoader, riskBetsSelector) {
  const slug = match.match_slug || match.slug;
  if (!slug) return null;

  const [popularBetsData, matchDetailData] = await Promise.all([
    popularBetsLoader(slug).catch(() => null),
    typeof matchDetailLoader === 'function' ? matchDetailLoader(slug).catch(() => null) : Promise.resolve(null),
  ]);

  if (!popularBetsData) return null;

  const groupedBets = stavkaApi.groupBetsByType(popularBetsData);
  const MIN_BET_COUNT = 5;
  const usableBets = groupedBets.filter(b => (b.count || 0) >= MIN_BET_COUNT);

  if (usableBets.length < 2) return null;

  const riskBets = typeof riskBetsSelector === 'function'
    ? riskBetsSelector(popularBetsData)
    : stavkaApi.selectRiskBets(popularBetsData);

  const summaryText = matchDetailData
    ? ((matchDetailData.predictionSummary && String(matchDetailData.predictionSummary).trim())
        ? matchDetailData.predictionSummary
        : matchDetailData.prediction || null)
    : null;
  const summarySnippet = summaryText
    ? stavkaApi.extractSummarySnippet(summaryText) || null
    : null;

  const sourceMode = (summarySnippet && summarySnippet.length > 20) ? 'full' : 'light';

  const topBets = groupedBets.slice(0, 5).map(b => ({
    type: b.type,
    outcome: b.outcome,
    count: b.count,
    rate: b.rate,
    percent: b.percent != null ? b.percent : null,
    label: b.label,
  }));

  const normalizedRiskBets = riskBets.map(b => ({
    type: b.type,
    outcome: b.outcome,
    rate: b.rate,
    count: b.count,
    percent: b.percent != null ? b.percent : null,
    label: b.label,
    risk_order: b.risk_order,
    risk_label: b.risk_label,
    risk_name: b.risk_name,
  }));

  const primarySignal = topBets.length > 0 ? {
    type: topBets[0].type,
    outcome: topBets[0].outcome,
    count: topBets[0].count,
    rate: topBets[0].rate,
    percent: topBets[0].percent,
    label: topBets[0].label,
  } : null;

  const crypto = require('crypto');
  const hashInput = JSON.stringify({
    match_slug: slug,
    source_mode: sourceMode,
    primary_signal: primarySignal ? {
      type: primarySignal.type,
      outcome: primarySignal.outcome,
      count: primarySignal.count,
      rate: primarySignal.rate,
    } : null,
    top_bets: topBets.map(b => ({
      type: b.type, outcome: b.outcome, count: b.count, rate: b.rate,
    })),
    summary_snippet: summarySnippet || null,
  });
  const sourceHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  return {
    match_id: match.match_id || match.id,
    match_slug: slug,
    sport_slug: match.sport_slug || match.sportSlug || null,
    source_mode: sourceMode,
    source_url: 'https://stavka.tv/matches/' + (match.sport_slug || 'soccer') + '/' + slug,
    top_bets: topBets,
    risk_bets: normalizedRiskBets,
    primary_signal: primarySignal,
    summary_snippet: summarySnippet,
    source_hash: sourceHash,
  };
}

// ── Enrich payload with SStats data ────────────────────────
async function enrichPayloadWithSStatsData(payload, pg) {
  if (!sstatsApi.hasApiKey()) return payload;
  if (!payload || payload.sport_slug !== 'soccer') return payload;

  try {
    const slug = payload.match_slug || '';
    if (!slug) return payload;

    // 1. Try to find SStats game ID from database
    let sstatsGameId = null;
    if (pg) {
      const rows = await pg.connection(
        'SELECT system_match_id FROM external.public_match WHERE system_match_slug = $1 AND system_id = 3 LIMIT 1',
        [slug],
      ).catch(() => []);
      if (rows.length && rows[0].system_match_id) {
        sstatsGameId = Number(rows[0].system_match_id);
      }
    }

    // 2. If not in DB, search by team names
    if (!sstatsGameId) {
      const parts = slug.split('-').filter(p => !/^\d+$/.test(p) && p.length > 1);
      if (parts.length < 2) return payload;

      const homeSearch = parts[parts.length - 2];
      const awaySearch = parts[parts.length - 1];

      // Search WC games
      const wcGames = await sstatsApi.apiGet('/Games/list', {
        LeagueId: '1',
        Year: '2026',
        limit: '200',
        TimeZone: '3',
      });

      if (wcGames?.length) {
        for (const g of wcGames) {
          const home = (g.homeTeam?.name || '').toLowerCase();
          const away = (g.awayTeam?.name || '').toLowerCase();
          if (home.includes(homeSearch) && away.includes(awaySearch)) {
            sstatsGameId = g.id;
            // Store in DB for future use
            if (pg) {
              await pg.connection(
                'UPDATE external.public_match SET system_match_id = $1 WHERE system_match_slug = $2 AND system_id = 3',
                [String(sstatsGameId), slug],
              ).catch(() => {});
            }
            break;
          }
        }
      }
    }

    if (!sstatsGameId) return payload;

    // 3. Build full payload with lineups, form, statistics
    const sstatsPayload = await sstatsApi.buildMatchPayload(sstatsGameId);
    if (!sstatsPayload) return payload;

    return {
      ...payload,
      sstats_data: {
        fixture_id: sstatsPayload.fixture_id,
        status: sstatsPayload.status,
        round: sstatsPayload.round,
        referee: sstatsPayload.referee,
        lineups: sstatsPayload.lineups,
        events: sstatsPayload.events,
        statistics: sstatsPayload.statistics,
        recent_form: sstatsPayload.recent_form,
        team_stats: sstatsPayload.team_stats,
        odds: sstatsPayload.odds,
      },
    };
  } catch {
    return payload;
  }
}

// ── Main orchestrator ──────────────────────────────────────
async function runDailyPicks(pg, options = {}) {
  const {
  popularBetsLoader = stavkaApi.fetchPopularBets,
  matchDetailLoader = stavkaApi.fetchMatchDetail,
  riskBetsSelector = stavkaApi.selectRiskBets,
  apiLoader = stavkaApi.fetchAllMatches,
  generator = null,
  generatorProvider = null,
  modelName = null,
  promptVersion = null,
  now = new Date(),
  } = options;

  // 1. Load all upcoming matches
  const allMatches = await apiLoader();
  if (!Array.isArray(allMatches) || allMatches.length === 0) {
    return { users_processed: 0, slots_created: 0, snapshots_created: 0, matches_analyzed: 0 };
  }

  // 2. Load users
  const users = await loadUsersWithFavorites(pg);
  if (users.length === 0) {
    return { users_processed: 0, slots_created: 0, snapshots_created: 0, matches_analyzed: 0 };
  }

  const todayDate = getMoscowDate(0, now);
  const tomorrowDate = getMoscowDate(1, now);

  // 3. Collect candidates per user
  const candidatesByUserId = {};
  for (const user of users) {
    const userId = user.id ?? user.user_id;
    const [todayCandidates, tomorrowCandidates] = await Promise.all([
      loadCandidatesForUser({ pg, user, targetDate: todayDate, allMatches }),
      loadCandidatesForUser({ pg, user, targetDate: tomorrowDate, allMatches }),
    ]);
    candidatesByUserId[userId] = [
      ...(todayCandidates || []),
      ...(tomorrowCandidates || []),
    ];
  }

  // 4. Rank and select top matches per user per day
  const allSelectedMatches = new Map(); // match_id → candidate
  const userSlots = [];

  for (const user of users) {
    const userId = user.id ?? user.user_id;
    const candidates = candidatesByUserId[userId] || [];

    for (const targetDate of [todayDate, tomorrowDate]) {
      const dayCandidates = candidates.filter(c => c.date_msk === targetDate);
      if (dayCandidates.length === 0) continue;

      const ranked = rankCandidateMatches(dayCandidates);
      const topN = ranked.slice(0, MATCHES_PER_DAY);

      for (const entry of topN) {
        const matchId = String(entry.match.match_id || entry.match.id);
        allSelectedMatches.set(matchId, entry.match);
        userSlots.push({
          user_id: userId,
          slot_date: targetDate,
          match_id: matchId,
        });
      }
    }
  }

  if (allSelectedMatches.size === 0) {
    return { users_processed: users.length, slots_created: 0, snapshots_created: 0, matches_analyzed: 0 };
  }

  // 5. Check existing snapshots
  const matchIds = [...allSelectedMatches.keys()];
  const existingSnapshots = new Map();
  if (matchIds.length > 0) {
    const placeholders = matchIds.map((_, i) => `$${i + 1}`).join(', ');
    const existing = await pg.connection(
      `SELECT pm.system_match_id FROM external.public_match pm
       JOIN public.match_source ms ON ms.match_id = pm.match_id
       JOIN public.match_analysis ma ON ma.match_source_id = ms.match_source_id
       WHERE pm.system_match_id IN (${placeholders})
         AND pm.system_id = 3
         AND ma.analysis_status_id = (SELECT analysis_status_id FROM public.analysis_status WHERE analysis_status_name = 'ready')`,
      [...matchIds],
    ).catch(() => []);
    for (const row of existing) {
      existingSnapshots.set(String(row.system_match_id), true);
    }
  }

  // 6. Generate analysis for new matches
  let snapshotsCreated = 0;
  for (const [matchId, match] of allSelectedMatches) {
    if (existingSnapshots.has(matchId)) continue;

    const sourcePayload = await buildSourcePayload(match, popularBetsLoader, matchDetailLoader, riskBetsSelector);
    if (!sourcePayload || sourcePayload.source_mode === 'skip') continue;

    // Enrich with SStats data (lineups, form, statistics)
    const enrichedPayload = await enrichPayloadWithSStatsData(sourcePayload, pg);

    // Resolve DB context (match is already normalized from getCandidateMatchesForDate)
    const { systemId, sportId, tournamentId } = await resolveDbContextForCandidate(pg, { candidate: match });
    if (systemId == null || sportId == null || tournamentId == null) continue;

    // Persist match + source
    let sourceId;
    try {
      const result = await persistBundleSnapshot(pg, {
        systemId, sportId, tournamentId, candidate: match, sourcePayload,
      });
      sourceId = result.sourceId;
    } catch (err) {
      continue;
    }

    if (sourceId == null) continue;

    // Generate analysis via LLM (if generator provided)
    if (typeof generator === 'function') {
      try {
        const genResult = await generator({ sourcePayload: enrichedPayload, modelName, promptVersion, provider: generatorProvider });
        if (genResult && genResult.status === 'ready') {
          await persistAnalysisSnapshot(pg, {
            matchSourceId: sourceId,
            snapshot: {
              status: 'ready',
              headline: genResult.output.headline,
              brief: genResult.output.brief,
              risk_note: genResult.output.risk_note || null,
              recommended_bets: genResult.output.recommended_bets || [],
              model_name: genResult.model_name || modelName,
              prompt_version: genResult.prompt_version || promptVersion,
            },
          });
          snapshotsCreated++;
        }
      } catch (err) {
        // skip silently
      }
    }
  }

  return {
    users_processed: users.length,
    unique_matches: allSelectedMatches.size,
    snapshots_created: snapshotsCreated,
    existing_snapshots: existingSnapshots.size,
  };
}

module.exports = { runDailyPicks, loadUsersWithFavorites, loadUserLeagueScope, buildSourcePayload, enrichPayloadWithSStatsData };
