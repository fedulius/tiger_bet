'use strict';

// Moscow is UTC+3 — all date filtering uses this offset.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function toMoscowDateStr(startsAtRaw) {
  const ts = Date.parse(startsAtRaw);
  if (!Number.isFinite(ts)) return null;
  const msk = new Date(ts + MOSCOW_OFFSET_MS);
  const y = msk.getUTCFullYear();
  const m = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const d = String(msk.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractLeague(match) {
  const league = match.league;
  if (!league) return { league_id: null, league_slug: null, league_label: '', external_league_id: null };
  if (typeof league === 'string') return { league_id: null, league_slug: null, league_label: league, external_league_id: null };
  const rawId = league.id;
  const numericId = rawId != null ? Number(rawId) : null;
  return {
    league_id: Number.isFinite(numericId) ? numericId : null,
    league_slug: league.slug || null,
    league_label: league.name || '',
    external_league_id: rawId != null ? String(rawId) : null,
  };
}

function readOddValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number(value);
  if (typeof value === 'object' && value.value != null) return Number(value.value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractOdds(match) {
  const raw = match.odds;
  if (!raw) return { home: null, draw: null, away: null };
  // stavkaApi Tier-1 returns odds.one_x_two: { w1, x, w2 }
  if (raw.one_x_two) {
    const o = raw.one_x_two;
    return {
      home: readOddValue(o.w1),
      draw: readOddValue(o.x),
      away: readOddValue(o.w2),
    };
  }
  // Fallback: already-normalized shape (home/draw/away)
  return {
    home: readOddValue(raw.home),
    draw: readOddValue(raw.draw),
    away: readOddValue(raw.away),
  };
}

/**
 * Convert a raw stavkaApi match object to the internal candidate shape
 * consumed by dailyPickRankingService and dailyPickSelectionService.
 *
 * Fields kept: id, match_id, match_slug, starts_at (UTC ISO), league
 * identifiers, league_label, home_team, away_team, odds {home,draw,away},
 * sport_slug, popularity_hints {is_featured, viewer_count, league_tier}.
 */
function normalizeCandidate(match) {
  const rawId = match.id ?? match.match_id;
  const id = String(rawId);

  const startsAtRaw = match.starts_at || match.startsAt || match.matchDate || '';
  const startsAtTs = Date.parse(startsAtRaw);
  const starts_at = Number.isFinite(startsAtTs) ? new Date(startsAtTs).toISOString() : '';

  const { league_id, league_slug, league_label, external_league_id } = extractLeague(match);

  const home_team = (match.homeTeam && match.homeTeam.name)
    || (match.teams && match.teams.home && match.teams.home.name)
    || match.home_team
    || '';
  const away_team = (match.awayTeam && match.awayTeam.name)
    || (match.teams && match.teams.away && match.teams.away.name)
    || match.away_team
    || '';

  const odds = extractOdds(match);
  const sport_slug = match.sportSlug || match.sport_slug || '';

  const leagueObj = match.league && typeof match.league === 'object' ? match.league : null;
  const popularity_hints = {
    is_featured: !!(match.isPopular || match.isFeatured || match.is_featured),
    viewer_count: match.viewerCount ?? match.viewer_count ?? null,
    league_tier: match.league_tier ?? (leagueObj ? leagueObj.tier : null) ?? null,
  };

  return {
    id,
    match_id: id,
    match_slug: match.slug || match.match_slug || '',
    starts_at,
    date_msk: toMoscowDateStr(startsAtRaw) || '',
    league_id,
    league_slug,
    league_label,
    external_league_id,
    home_team,
    away_team,
    odds,
    sport_slug,
    popularity_hints,
  };
}

/**
 * userLeagueScope shape: { leagueIds?: number[], leagueSlugs?: string[] }
 * A match passes if its league id OR slug appears in the scope.
 */
function isInLeagueScope(match, userLeagueScope) {
  const { leagueIds, leagueSlugs } = userLeagueScope;
  const hasIds = Array.isArray(leagueIds) && leagueIds.length > 0;
  const hasSlugs = Array.isArray(leagueSlugs) && leagueSlugs.length > 0;
  if (!hasIds && !hasSlugs) return false;

  const leagueObj = match.league && typeof match.league === 'object' ? match.league : null;
  const matchLeagueId = leagueObj && leagueObj.id != null ? Number(leagueObj.id) : null;
  const matchLeagueSlug = leagueObj ? leagueObj.slug || null : null;

  if (hasIds && matchLeagueId != null && leagueIds.some(lid => Number(lid) === matchLeagueId)) return true;
  if (hasSlugs && matchLeagueSlug && leagueSlugs.indexOf(matchLeagueSlug) !== -1) return true;

  // Fallback: match by league display name (API name vs DB tournament name)
  const matchLeagueName = leagueObj ? (leagueObj.name || '').toLowerCase().trim() : null;
  if (hasSlugs && matchLeagueName) {
    for (const slug of leagueSlugs) {
      if (matchLeagueName === slug || matchLeagueName.includes(slug) || slug.includes(matchLeagueName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter and normalize raw matches for a specific Moscow calendar date.
 *
 * @param {object[]} allMatches  — raw stavkaApi match objects
 * @param {object}   userLeagueScope — { leagueIds?: number[], leagueSlugs?: string[] }
 * @param {string}   targetDateMsk   — "YYYY-MM-DD" in Moscow time
 * @param {number}   [nowMs]         — current timestamp; defaults to Date.now()
 * @returns {object[]} normalized candidate matches
 */
function getCandidateMatchesForDate({ allMatches, userLeagueScope, targetDateMsk, nowMs }) {
  if (!Array.isArray(allMatches) || !userLeagueScope || !targetDateMsk) return [];

  const now = nowMs != null ? Number(nowMs) : Date.now();
  const candidates = [];

  for (const match of allMatches) {
    // Skip garbage: null entries or missing id
    if (!match) continue;
    if (match.id == null && match.match_id == null) continue;

    const startsAtRaw = match.starts_at || match.startsAt || match.matchDate;
    if (!startsAtRaw) continue;

    const startsAtTs = Date.parse(startsAtRaw);
    if (!Number.isFinite(startsAtTs)) continue;

    // Only future matches
    if (startsAtTs <= now) continue;

    // Filter by exact Moscow calendar date
    if (toMoscowDateStr(startsAtRaw) !== targetDateMsk) continue;

    // Filter by user's allowed leagues
    if (!isInLeagueScope(match, userLeagueScope)) continue;

    candidates.push(normalizeCandidate(match));
  }

  return candidates;
}

module.exports = { normalizeCandidate, getCandidateMatchesForDate };
