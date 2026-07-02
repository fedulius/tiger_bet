function createMemoryStore() {
  const snapshots = new Map(); // key: match_id
  const slots = new Map();     // key: `${user_id}:${slot_date}`
  const results = new Map();   // key: match_id

  async function getUserDailyPicks({ userId, todayDate, tomorrowDate }) {
    return {
      today: slots.get(`${userId}:${todayDate}`) || null,
      tomorrow: slots.get(`${userId}:${tomorrowDate}`) || null,
    };
  }

  async function getExistingMatchSnapshots({ matchIds }) {
    const out = new Map();
    for (const id of matchIds) {
      if (snapshots.has(id)) out.set(id, snapshots.get(id));
    }
    return out;
  }

  async function upsertMatchSnapshot(snapshot) {
    snapshots.set(snapshot.match_id, { ...snapshot });
    return snapshots.get(snapshot.match_id);
  }

  async function upsertUserSlot(slot) {
    const key = `${slot.user_id}:${slot.slot_date}`;
    slots.set(key, { ...slot });
    return slots.get(key);
  }

  async function getUnsettledPredictions() {
    const out = [];
    for (const slot of slots.values()) {
      if (slot.match_id != null && !results.has(slot.match_id)) {
        out.push(slot);
      }
    }
    return out;
  }

  async function upsertMatchResult(result) {
    results.set(result.match_id, { ...result });
    return results.get(result.match_id);
  }

  return {
    getUserDailyPicks,
    getExistingMatchSnapshots,
    upsertMatchSnapshot,
    upsertUserSlot,
    getUnsettledPredictions,
    upsertMatchResult,
  };
}

module.exports = { createMemoryStore };
