'use strict';

function normalizeName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^.*?:\s*/, '');
}

const LEAGUE_ALIAS_GROUPS = [
  ['champions league', 'uefa champions league', 'лига чемпионов', 'лига чемпионов уефа'],
  ['premier league', 'премьер-лига', 'апл'],
  ['world cup', 'чемпионат мира', 'world championship'],
  ['fifa club world cup', 'клубный чемпионат мира'],
];

function expandLeagueAliases(value = '') {
  const normalized = normalizeName(value);
  if (!normalized) return [];

  const group = LEAGUE_ALIAS_GROUPS.find((aliases) => aliases.includes(normalized));
  return group ? [...group] : [normalized];
}

function buildFavoriteLeagueMap(favoriteSports = []) {
  const entries = new Map();

  for (const sport of Array.isArray(favoriteSports) ? favoriteSports : []) {
    const sportName = normalizeName(sport?.sport_name || sport?.name || sport?.sport);
    if (!sportName) continue;

    entries.set(
      sportName,
      new Set(
        (Array.isArray(sport?.leagues) ? sport.leagues : [])
          .flatMap(expandLeagueAliases),
      ),
    );
  }

  return entries;
}

function filterRowsByFavoriteLeagues(rows = [], favoriteSports = []) {
  const leagueMap = buildFavoriteLeagueMap(favoriteSports);
  if (leagueMap.size === 0) return [];

  return rows.filter((row) => {
    const sportName = normalizeName(row?.sport_name);
    const selectedLeagues = leagueMap.get(sportName);
    if (!selectedLeagues) return false;
    if (selectedLeagues.size === 0) return true;

    return [row?.tournament_name_en, row?.tournament_name]
      .flatMap(expandLeagueAliases)
      .some((leagueName) => selectedLeagues.has(leagueName));
  });
}

function getMoscowDate(daysOffset = 0, now = new Date()) {
  const mskStr = now.toLocaleString('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = mskStr.split('-').map(Number);
  const mskDate = new Date(Date.UTC(y, m - 1, d + daysOffset));
  return mskDate.toISOString().slice(0, 10);
}

function buildSlotMap(rows = []) {
  const slots = new Map();
  for (const row of rows) {
    if (!row || !row.slot_date || slots.has(row.slot_date)) continue;

    const sourcePayload = row.source_payload && typeof row.source_payload === 'object'
      ? row.source_payload
      : {};
    const recommendedBets = Array.isArray(row.recommended_bets) ? row.recommended_bets : [];
    const primaryBet = recommendedBets[0] || null;
    const matchSlug = sourcePayload.match_slug || row.system_match_id || String(row.match_id || '');

    slots.set(row.slot_date, {
      id: `daily-pick:${row.slot_date}:${row.match_analysis_id}`,
      slot_date: row.slot_date,
      match_id: row.match_id,
      match_slug: matchSlug,
      match: [row.home_team, row.away_team].filter(Boolean).join(' — '),
      sport_name: row.sport_name || '',
      league: row.tournament_name || row.tournament_name_en || '',
      starts_at: row.match_start_at,
      status: row.analysis_status_name,
      headline: row.analysis_headline || '',
      brief: row.analysis_brief || '',
      risk_note: row.analysis_risk_note || '',
      recommended_bets: recommendedBets,
      primary_bet: primaryBet,
      source_url: sourcePayload.source_url || '',
      source_refs: Array.isArray(sourcePayload.source_refs) ? sourcePayload.source_refs : [],
      model_name: row.model_name || '',
      prompt_version: row.prompt_version || '',
      updated_at: row.analysis_update_at || row.analysis_create_at || null,
      created_at: row.analysis_create_at || null,
    });
  }
  return slots;
}

async function getDailyPicksByDateRange(pg, { startDate, endDate, favoriteSports = [] }) {
  const rows = await pg.connection(
    `SELECT
        to_char(m.match_start_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS slot_date,
        ma.match_analysis_id,
        ma.analysis_status_id,
        ast.analysis_status_name,
        ma.analysis_headline,
        ma.analysis_brief,
        ma.analysis_risk_note,
        ma.recommended_bets,
        ma.model_name,
        ma.prompt_version,
        ma.analysis_create_at,
        ma.analysis_update_at,
        m.match_id,
        m.home_team,
        m.away_team,
        m.match_start_at,
        s.sport_name,
        t.tournament_name,
        t.tournament_name_en,
        ms.source_payload,
        pm.system_match_id
      FROM public.match_analysis ma
      JOIN public.analysis_status ast ON ast.analysis_status_id = ma.analysis_status_id
      JOIN public.match_source ms ON ms.match_source_id = ma.match_source_id
      JOIN public.match m ON m.match_id = ms.match_id
      JOIN public.sport s ON s.sport_id = m.sport_id
      LEFT JOIN public.tournament t ON t.tournament_id = m.tournament_id
      LEFT JOIN external.public_match pm ON pm.match_id = m.match_id
      WHERE ast.analysis_status_name = 'ready'
        AND COALESCE(s.is_active, 0) = 1
        AND to_char(m.match_start_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') BETWEEN $1 AND $2
      ORDER BY slot_date ASC, m.match_start_at ASC, ma.analysis_create_at ASC, ma.match_analysis_id ASC`,
    [startDate, endDate],
  );

  return buildSlotMap(filterRowsByFavoriteLeagues(rows, favoriteSports));
}

async function getDailyPicksFeed(pg, { now = new Date(), favoriteSports = [] } = {}) {
  const todayDate = getMoscowDate(0, now);
  const tomorrowDate = getMoscowDate(1, now);
  const slots = await getDailyPicksByDateRange(pg, { startDate: todayDate, endDate: tomorrowDate, favoriteSports });

  return {
    today_date: todayDate,
    tomorrow_date: tomorrowDate,
    today: slots.get(todayDate) || null,
    tomorrow: slots.get(tomorrowDate) || null,
    updated_at: [slots.get(todayDate)?.updated_at, slots.get(tomorrowDate)?.updated_at].filter(Boolean).sort().at(-1) || null,
  };
}

module.exports = {
  buildFavoriteLeagueMap,
  expandLeagueAliases,
  filterRowsByFavoriteLeagues,
  getMoscowDate,
  buildSlotMap,
  getDailyPicksByDateRange,
  getDailyPicksFeed,
};
