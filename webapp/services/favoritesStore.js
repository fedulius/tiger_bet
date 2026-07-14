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

function normalizeSportName(row = {}) {
  return String(row.sport_name || row.sport_url || '').trim();
}

async function loadResolvedFavoriteSports(pg, userId) {
  const rows = await pg.connection(`
    SELECT
      s.sport_id,
      s.sport_name,
      s.sport_url,
      t.tournament_id,
      t.tournament_name,
      t.tournament_name_en
    FROM public.user_tournament ut
    JOIN public.tournament t ON t.tournament_id = ut.tournament_id
    JOIN public.sport s ON s.sport_id = t.sport_id
    WHERE ut.user_id = $1
      AND COALESCE(s.is_active, 0) = 1
    ORDER BY s.sport_id, t.tournament_name_en, t.tournament_name
  `, [userId]);

  const bySportId = new Map();
  for (const row of rows) {
    const sportId = Number(row.sport_id);
    if (!Number.isFinite(sportId)) continue;

    if (!bySportId.has(sportId)) {
      bySportId.set(sportId, {
        sport_id: sportId,
        sport_name: normalizeSportName(row),
        sport_url: String(row.sport_url || '').trim(),
        leagues: [],
      });
    }

    const entry = bySportId.get(sportId);
    const league = String(row.tournament_name_en || row.tournament_name || '').trim();
    if (league && !entry.leagues.includes(league)) {
      entry.leagues.push(league);
    }
  }

  return [...bySportId.values()];
}

module.exports = {
  getFavoritesByProfile,
  getGuestFavorites,
  normalizeSportsSettings,
  saveFavoritesByProfile,
  saveGuestFavorites,
  loadResolvedFavoriteSports,
};
