const fs = require('fs');
const path = require('path');

const DEFAULT_PROFILE = 'guest';

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    throw new Error('sports and leagues must be arrays');
  }

  const normalized = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return [...new Set(normalized)];
}

function ensureStoreFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initial = {
      [DEFAULT_PROFILE]: {
        sports: [],
        leagues: [],
      },
    };

    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
  }
}

function readStore(filePath) {
  ensureStoreFile(filePath);

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStoreAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function getFavoritesFilePath() {
  return process.env.WEBAPP_FAVORITES_FILE
    || path.join(__dirname, '..', 'data', 'favorites.json');
}

function getGuestFavorites() {
  const filePath = getFavoritesFilePath();
  const store = readStore(filePath);
  const profileData = store[DEFAULT_PROFILE] || { sports: [], leagues: [] };

  return {
    sports: normalizeStringArray(profileData.sports || []),
    leagues: normalizeStringArray(profileData.leagues || []),
    profile: DEFAULT_PROFILE,
  };
}

function saveGuestFavorites(input) {
  const sports = normalizeStringArray(input.sports);
  const leagues = normalizeStringArray(input.leagues);

  const filePath = getFavoritesFilePath();
  const store = readStore(filePath);

  store[DEFAULT_PROFILE] = {
    sports,
    leagues,
  };

  writeStoreAtomic(filePath, store);

  return {
    sports,
    leagues,
    profile: DEFAULT_PROFILE,
  };
}

module.exports = {
  getGuestFavorites,
  saveGuestFavorites,
};
