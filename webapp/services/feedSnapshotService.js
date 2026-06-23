const { normalizeFeedItem } = require('./feedService');
const { createClient } = require('redis');

const SNAPSHOT_KEY = 'feed:snapshot';
const LOCK_KEY = 'feed:snapshot:lock';
const FRESH_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_REDIS_TTL_S = 3600;
const LOCK_TTL_MS = 15000;

let _defaultRedisClient = null;
let _defaultRedisInit = false;

// null → lazy-init in production; null in NODE_ENV=test → no Redis
// non-null provided → use provided client
async function resolveRedisClient(provided) {
  if (provided != null) return provided;
  if (process.env.NODE_ENV === 'test') return null;
  if (_defaultRedisInit) return _defaultRedisClient;
  _defaultRedisInit = true;
  try {
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    _defaultRedisClient = client;
  } catch {
    // Redis unavailable — snapshot disabled
  }
  return _defaultRedisClient;
}

async function buildSnapshot(loader) {
  const rawItems = await loader();
  const items = rawItems.map(normalizeFeedItem).filter(Boolean);
  const generated_at_ms = Date.now();
  return {
    feed_version: `v${generated_at_ms}`,
    generated_at: new Date(generated_at_ms).toISOString(),
    generated_at_ms,
    items,
  };
}

async function getOrBuildSnapshot(redisClient, loader) {
  const redis = await resolveRedisClient(redisClient);
  if (!redis) return null;

  let snapshot = null;
  try {
    const raw = await redis.get(SNAPSHOT_KEY);
    if (raw) snapshot = JSON.parse(raw);
  } catch {
    return null;
  }

  const now = Date.now();
  if (snapshot && now - snapshot.generated_at_ms < FRESH_TTL_MS) {
    return snapshot;
  }

  // Stale or missing — try to acquire rebuild lock
  let lockAcquired = false;
  try {
    const result = await redis.set(LOCK_KEY, '1', { NX: true, PX: LOCK_TTL_MS });
    lockAcquired = result !== null;
  } catch {
    return snapshot;
  }

  // Lock held by another request — serve stale if available
  if (!lockAcquired) {
    return snapshot;
  }

  try {
    const newSnapshot = await buildSnapshot(loader);
    await redis.set(SNAPSHOT_KEY, JSON.stringify(newSnapshot), { EX: SNAPSHOT_REDIS_TTL_S });
    return newSnapshot;
  } catch {
    return snapshot;
  } finally {
    try { await redis.del(LOCK_KEY); } catch {}
  }
}

module.exports = { getOrBuildSnapshot, SNAPSHOT_KEY, LOCK_KEY, FRESH_TTL_MS };
