const { normalizeFeedItem } = require('./feedService');
const { createClient } = require('redis');

const CURRENT_VERSION_KEY = 'feed:current_version';
const LOCK_KEY = 'feed:rebuild_lock';
const SNAPSHOT_ITEMS_PREFIX = 'feed:snapshot:';
const SNAPSHOT_META_SUFFIX = ':meta';
const SNAPSHOT_ITEMS_SUFFIX = ':items';
const FRESH_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_VERSION_TTL_S = 30 * 60;
const CURRENT_VERSION_TTL_S = 60 * 60;
const LOCK_TTL_MS = 15000;

let _defaultRedisClient = null;
let _defaultRedisInit = false;

function getSnapshotItemsKey(version) {
  return `${SNAPSHOT_ITEMS_PREFIX}${version}${SNAPSHOT_ITEMS_SUFFIX}`;
}

function getSnapshotMetaKey(version) {
  return `${SNAPSHOT_ITEMS_PREFIX}${version}${SNAPSHOT_META_SUFFIX}`;
}

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

async function readSnapshotByVersion(redisClient, version) {
  const redis = await resolveRedisClient(redisClient);
  const normalizedVersion = String(version || '').trim();
  if (!redis || !normalizedVersion) return null;

  try {
    const [metaRaw, itemsRaw] = await Promise.all([
      redis.get(getSnapshotMetaKey(normalizedVersion)),
      redis.get(getSnapshotItemsKey(normalizedVersion)),
    ]);

    if (!metaRaw || !itemsRaw) return null;

    const meta = JSON.parse(metaRaw);
    const items = JSON.parse(itemsRaw);

    if (!meta || !Array.isArray(items)) return null;

    return {
      feed_version: String(meta.feed_version || normalizedVersion),
      generated_at: meta.generated_at,
      generated_at_ms: Number(meta.generated_at_ms) || 0,
      items,
    };
  } catch {
    return null;
  }
}

async function readCurrentSnapshot(redisClient) {
  const redis = await resolveRedisClient(redisClient);
  if (!redis) return null;

  try {
    const currentVersion = await redis.get(CURRENT_VERSION_KEY);
    if (!currentVersion) return null;
    return await readSnapshotByVersion(redis, currentVersion);
  } catch {
    return null;
  }
}

async function publishSnapshot(redisClient, snapshot) {
  const redis = await resolveRedisClient(redisClient);
  if (!redis || !snapshot?.feed_version) return null;

  const version = String(snapshot.feed_version);
  const meta = {
    feed_version: version,
    generated_at: snapshot.generated_at,
    generated_at_ms: snapshot.generated_at_ms,
  };

  await redis.set(getSnapshotItemsKey(version), JSON.stringify(snapshot.items || []), { EX: SNAPSHOT_VERSION_TTL_S });
  await redis.set(getSnapshotMetaKey(version), JSON.stringify(meta), { EX: SNAPSHOT_VERSION_TTL_S });
  await redis.set(CURRENT_VERSION_KEY, version, { EX: CURRENT_VERSION_TTL_S });

  return snapshot;
}

async function getOrBuildSnapshot(redisClient, loader) {
  const redis = await resolveRedisClient(redisClient);
  if (!redis) return null;

  const currentSnapshot = await readCurrentSnapshot(redis);
  const now = Date.now();
  if (currentSnapshot && now - currentSnapshot.generated_at_ms < FRESH_TTL_MS) {
    return currentSnapshot;
  }

  let lockAcquired = false;
  try {
    const result = await redis.set(LOCK_KEY, '1', { NX: true, PX: LOCK_TTL_MS });
    lockAcquired = result !== null;
  } catch {
    return currentSnapshot;
  }

  if (!lockAcquired) {
    return currentSnapshot;
  }

  try {
    const newSnapshot = await buildSnapshot(loader);
    await publishSnapshot(redis, newSnapshot);
    return newSnapshot;
  } catch {
    return currentSnapshot;
  } finally {
    try { await redis.del(LOCK_KEY); } catch {}
  }
}

module.exports = {
  getOrBuildSnapshot,
  readCurrentSnapshot,
  readSnapshotByVersion,
  publishSnapshot,
  buildSnapshot,
  resolveRedisClient,
  CURRENT_VERSION_KEY,
  LOCK_KEY,
  FRESH_TTL_MS,
  SNAPSHOT_VERSION_TTL_S,
  SNAPSHOT_KEY: CURRENT_VERSION_KEY,
  getSnapshotItemsKey,
  getSnapshotMetaKey,
};
