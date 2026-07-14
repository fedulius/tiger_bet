'use strict';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;
const _cache = new Map(); // key: SStats game id, value: { game, expiresAt }

function pruneExpired(now = Date.now()) {
  for (const [key, entry] of _cache.entries()) {
    if (!entry || now > entry.expiresAt) {
      _cache.delete(key);
    }
  }
}

function enforceMaxEntries() {
  while (_cache.size > MAX_ENTRIES) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
  }
}

function rememberSstatsListMatches(matches, ttlMs = DEFAULT_TTL_MS) {
  if (!Array.isArray(matches) || matches.length === 0) return;
  const now = Date.now();
  pruneExpired(now);
  const expiresAt = now + (Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS);

  for (const game of matches) {
    if (game?.id == null) continue;
    _cache.set(String(game.id), { game, expiresAt });
  }

  enforceMaxEntries();
}

function getSstatsListMatch(gameId) {
  const key = String(gameId || '').trim();
  if (!key) return null;
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.game || null;
}

function clearSstatsListMatchCache() {
  _cache.clear();
}

module.exports = {
  rememberSstatsListMatches,
  getSstatsListMatch,
  clearSstatsListMatchCache,
  __private: {
    pruneExpired,
    size: () => _cache.size,
  },
};
