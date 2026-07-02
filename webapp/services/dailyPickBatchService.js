'use strict';

const { buildUserSelections } = require('./dailyPickSelectionService');
const { analyzeMatches } = require('./dailyPickAnalysisService');

function normalizeSnapshots(analysisResult) {
  return Array.isArray(analysisResult)
    ? analysisResult
    : analysisResult instanceof Map
      ? [...analysisResult.values()]
      : [];
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
