const fs = require('fs');
const path = require('path');

const DEFAULT_PROFILE = 'guest';

function normalizeStringArray(value, errorMessage = 'value must be an array') {
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )];
}

function ensureStoreFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

function readStore(filePath) {
  ensureStoreFile(filePath);

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
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

function normalizeSportSetting(value) {
  if (typeof value === 'string') {
    const name = String(value || '').trim();
    return name ? { name, leagues: [] } : null;
  }

  if (!value || typeof value !== 'object') {
    throw new Error('sports must contain strings or objects');
  }

  const name = String(value.name || value.sport || '').trim();
  if (!name) {
    throw new Error('sport name is required');
  }

  const leagues = value.leagues == null
    ? []
    : normalizeStringArray(value.leagues, 'sport leagues must be arrays');

  return { name, leagues };
}

function normalizeSportsSettings(value) {
  if (!Array.isArray(value)) {
    throw new Error('sports must be an array');
  }

  const byName = new Map();

  for (const item of value) {
    const normalized = normalizeSportSetting(item);
    if (!normalized) {
      continue;
    }
    byName.set(normalized.name, normalized);
  }

  return [...byName.values()];
}

function normalizeLegacyEntry(profileData = {}) {
  const sports = normalizeStringArray(profileData.sports || [], 'sports must be an array');
  const sportSettings = Array.isArray(profileData.sport_settings)
    ? normalizeSportsSettings(profileData.sport_settings)
    : sports.map((name) => ({ name, leagues: [] }));

  return {
    sport_settings: sportSettings,
  };
}

function getProfileKey(profile = DEFAULT_PROFILE) {
  const clean = String(profile || '').trim();
  return clean || DEFAULT_PROFILE;
}

function getFavoritesByProfile(profile = DEFAULT_PROFILE) {
  const filePath = getFavoritesFilePath();
  const store = readStore(filePath);
  const normalized = normalizeLegacyEntry(store[getProfileKey(profile)] || {});

  return {
    sport_settings: normalized.sport_settings,
    profile: getProfileKey(profile),
  };
}

function saveFavoritesByProfile(profile = DEFAULT_PROFILE, input = {}) {
  const sportSettings = normalizeSportsSettings(input.sport_settings || input.sports || []);
  const filePath = getFavoritesFilePath();
  const store = readStore(filePath);
  const profileKey = getProfileKey(profile);

  store[profileKey] = {
    sport_settings: sportSettings,
  };

  writeStoreAtomic(filePath, store);

  return {
    sport_settings: sportSettings,
    profile: profileKey,
  };
}

function getGuestFavorites() {
  return getFavoritesByProfile(DEFAULT_PROFILE);
}

function saveGuestFavorites(input) {
  return saveFavoritesByProfile(DEFAULT_PROFILE, input);
}

module.exports = {
  getFavoritesByProfile,
  getGuestFavorites,
  normalizeSportsSettings,
  saveFavoritesByProfile,
  saveGuestFavorites,
};
