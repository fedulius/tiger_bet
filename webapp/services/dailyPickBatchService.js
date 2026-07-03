'use strict';

const { buildUserSelections } = require('./dailyPickSelectionService');
const { analyzeMatches } = require('./dailyPickAnalysisService');
const { resolveDbContextForCandidate } = require('./dailyPickMappingService');
const { persistBundleSnapshot, persistAnalysisSnapshot } = require('./dailyPickPersistenceService');

function normalizeSnapshots(analysisResult) {
  return Array.isArray(analysisResult)
    ? analysisResult
    : analysisResult instanceof Map
      ? [...analysisResult.values()]
      : [];
}

function findCandidateForSnapshot(matchId, candidatesByUserId) {
  const id = String(matchId);
  for (const candidates of Object.values(candidatesByUserId)) {
    if (!Array.isArray(candidates)) continue;
    for (const c of candidates) {
      if (String(c.match_id || c.id) === id) return c;
    }
  }
  return null;
}

async function runDailyPickBatch({
  store,
  users,
  todayDate,
  tomorrowDate,
  candidateLoader,
  analysisLoader,
  sourceBuilder,
  generator,
  modelName,
  promptVersion,
  pg,
}) {
  // 1. Resolve users (array or async loader)
  const resolvedUsers = typeof users === 'function' ? await users() : users;

  // 2. Load candidates for each user across both dates
  const candidatesByUserId = {};
  for (const user of resolvedUsers) {
    const userId = user.id ?? user.user_id;
    const [todayCandidates, tomorrowCandidates] = await Promise.all([
      candidateLoader({ user, targetDate: todayDate }),
      candidateLoader({ user, targetDate: tomorrowDate }),
    ]);
    candidatesByUserId[userId] = [
      ...(todayCandidates || []),
      ...(tomorrowCandidates || []),
    ];
  }

  // 3. Build user slot selections and collect unique match IDs
  const { userSlots, uniqueMatchIds } = buildUserSelections({
    users: resolvedUsers,
    candidatesByUserId,
    todayDate,
    tomorrowDate,
  });

  // 4. Check which match snapshots already exist
  const existingSnapshots = await store.getExistingMatchSnapshots({ matchIds: uniqueMatchIds });

  // 5. Only call analysisLoader for missing snapshots
  const missingMatchIds = uniqueMatchIds.filter(id => !existingSnapshots.has(id));

  let snapshots_created = 0;
  if (missingMatchIds.length > 0) {
    const analysisResult = analysisLoader
      ? await analysisLoader({
          uniqueMatchIds: missingMatchIds,
          candidatesByUserId,
          existingSnapshots,
        })
      : await analyzeMatches({
          matchIds: missingMatchIds,
          candidatesByUserId,
          existingSnapshots,
          sourceBuilder,
          generator,
          modelName,
          promptVersion,
        });

    const newSnapshots = normalizeSnapshots(analysisResult);

    // 6. Persist new snapshots
    for (const snapshot of newSnapshots) {
      if (pg && snapshot.source_payload) {
        const candidate = findCandidateForSnapshot(snapshot.match_id, candidatesByUserId);
        if (candidate) {
          try {
            const { systemId, sportId, tournamentId } = await resolveDbContextForCandidate(pg, { candidate });
            if (systemId != null && sportId != null && tournamentId != null) {
              const { sourceId } = await persistBundleSnapshot(pg, {
                systemId, sportId, tournamentId, candidate, sourcePayload: snapshot.source_payload,
              });
              if (sourceId != null) {
                await persistAnalysisSnapshot(pg, { matchSourceId: sourceId, snapshot });
              }
            }
          } catch (_) {
            // skip silently
          }
        }
      }
      await store.upsertMatchSnapshot(snapshot);
      snapshots_created++;
    }
  }

  // 7. Persist user slots (only slots that have a match)
  let slots_created = 0;
  for (const slot of userSlots) {
    await store.upsertUserSlot(slot);
    slots_created++;
  }

  return {
    users_processed: resolvedUsers.length,
    slots_created,
    unique_matches_selected: uniqueMatchIds.length,
    snapshots_created,
  };
}

module.exports = { runDailyPickBatch };
