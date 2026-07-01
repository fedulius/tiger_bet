const SPORT_LEAGUES_CATALOG = {
  football: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League'],
  hockey: ['KHL', 'NHL', 'World Championship'],
  tennis: ['ATP', 'WTA', 'Challenger'],
  basketball: ['NBA', 'EuroLeague', 'VTB United League'],
  esports: ['ESL Pro League', 'BLAST Premier', 'IEM', 'The International'],
};

const SPORT_KEY_ALIASES = {
  football: ['football', 'soccer', 'футбол'],
  hockey: ['hockey', 'ice-hockey', 'хоккей'],
  tennis: ['tennis', 'теннис'],
  basketball: ['basketball', 'баскетбол'],
  esports: ['esports', 'csgo', 'dota2', 'кс:го', 'дота2', 'киберспорт'],
};

function normalizeName(value = '') {
  return String(value || '').trim().toLowerCase();
}

function resolveSportCatalogKey(value = '') {
  const normalized = normalizeName(value);

  for (const [catalogKey, aliases] of Object.entries(SPORT_KEY_ALIASES)) {
    if (aliases.includes(normalized)) {
      return catalogKey;
    }
  }

  return '';
}

function getAvailableLeaguesForSport(value = '') {
  const key = resolveSportCatalogKey(value);
  return key ? [...(SPORT_LEAGUES_CATALOG[key] || [])] : [];
}

function getCatalogBySportNames(sportNames = []) {
  const entries = {};

  for (const sportName of sportNames) {
    const cleanName = String(sportName || '').trim();
    if (!cleanName) {
      continue;
    }
    entries[cleanName] = getAvailableLeaguesForSport(cleanName);
  }

  return entries;
}

module.exports = {
  getAvailableLeaguesForSport,
  getCatalogBySportNames,
  resolveSportCatalogKey,
};
