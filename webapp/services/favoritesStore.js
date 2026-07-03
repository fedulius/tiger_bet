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

function getProfileKey(profile = DEFAULT_PROFILE) {
  const clean = String(profile || '').trim();
  return clean || DEFAULT_PROFILE;
}

function getFavoritesByProfile(profile = DEFAULT_PROFILE) {
  return {
    sport_settings: [],
    profile: getProfileKey(profile),
  };
}

function saveFavoritesByProfile(profile = DEFAULT_PROFILE, input = {}) {
  const sportSettings = normalizeSportsSettings(input.sport_settings || input.sports || []);
  return {
    sport_settings: sportSettings,
    profile: getProfileKey(profile),
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
