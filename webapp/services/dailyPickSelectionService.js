const { pickBestMatch } = require('./dailyPickRankingService');

function selectUserSlotForDate({ userId, matches, targetDate }) {
  if (!matches || matches.length === 0) return null;
  const best = pickBestMatch(matches);
  if (!best) return null;
  return {
    user_id: userId,
    slot_date: targetDate,
    match_id: best.id,
  };
}

function buildUserSelections({ users, candidatesByUserId, todayDate, tomorrowDate }) {
  const userSlots = [];
  const matchIdSet = new Set();

  for (const user of users) {
    const userId = user.id ?? user.user_id;
    const candidates = candidatesByUserId[userId] || [];

    const todayMatches = candidates.filter(m => m.date_msk === todayDate);
    const tomorrowMatches = candidates.filter(m => m.date_msk === tomorrowDate);

    const todaySlot = selectUserSlotForDate({ userId, matches: todayMatches, targetDate: todayDate });
    const tomorrowSlot = selectUserSlotForDate({ userId, matches: tomorrowMatches, targetDate: tomorrowDate });

    if (todaySlot) {
      userSlots.push(todaySlot);
      matchIdSet.add(todaySlot.match_id);
    }
    if (tomorrowSlot) {
      userSlots.push(tomorrowSlot);
      matchIdSet.add(tomorrowSlot.match_id);
    }
  }

  return {
    userSlots,
    uniqueMatchIds: [...matchIdSet],
  };
}

module.exports = { selectUserSlotForDate, buildUserSelections };
