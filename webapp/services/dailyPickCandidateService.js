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
  if (!league) return { league_id: null, league_slug: null, league_label: '' };
  if (typeof league === 'string') return { league_id: null, league_slug: null, league_label: league };
  return {
    league_id: league.id != null ? Number(league.id) : null,
    league_slug: league.slug || null,
    league_label: league.name || '',
  };
}

function extractOdds(match) {
  const raw = match.odds;
  if (!raw) return { home: null, draw: null, away: null };
  // stavkaApi Tier-1 returns odds.one_x_two: { w1, x, w2 }
  if (raw.one_x_two) {
    const o = raw.one_x_two;
    return {
      home: o.w1 != null ? Number(o.w1) : null,
      draw: o.x  != null ? Number(o.x)  : null,
      away: o.w2 != null ? Number(o.w2) : null,
    };
  }
  // Fallback: already-normalized shape (home/draw/away)
  return {
    home: raw.home != null ? Number(raw.home) : null,
    draw: raw.draw != null ? Number(raw.draw) : null,
    away: raw.away != null ? Number(raw.away) : null,
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

  const startsAtRaw = match.starts_at || match.startsAt || '';
  const startsAtTs = Date.parse(startsAtRaw);
  const starts_at = Number.isFinite(startsAtTs) ? new Date(startsAtTs).toISOString() : '';

  const { league_id, league_slug, league_label } = extractLeague(match);

  const home_team = (match.homeTeam && match.homeTeam.name) || match.home_team || '';
  const away_team = (match.awayTeam && match.awayTeam.name) || match.away_team || '';

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

    const startsAtRaw = match.starts_at || match.startsAt;
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
