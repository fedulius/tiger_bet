// Popularity first, betting second. No DB, no LLM — pure heuristics.

function computePopularityScore(match) {
  const hints = (match && match.popularity_hints) || {};
  let score = 0;

  const tier = hints.league_tier;
  if (tier === 1) score += 50;
  else if (tier === 2) score += 30;
  else if (tier === 3) score += 10;

  if (hints.is_featured) score += 20;

  if (hints.viewer_count) {
    score += Math.min(hints.viewer_count / 1000, 30);
  }

  return Math.round(score * 100) / 100;
}

function computeBettingScore(match) {
  const odds = match && match.odds;
  if (!odds || !odds.home || !odds.away) return 0;

  const impliedHome = 1 / odds.home;
  const impliedAway = 1 / odds.away;
  const impliedDraw = odds.draw ? 1 / odds.draw : 0;

  // Closer to 50/50 between home and away = more interesting for betting
  const balance = 1 - Math.abs(impliedHome - impliedAway);

  // Lower overround = fairer market
  const overround = impliedHome + impliedDraw + impliedAway;
  const marginScore = Math.max(0, 1 - (overround - 1) * 10);

  return Math.round((balance * 60 + marginScore * 40) * 100) / 100;
}

// Returns [{match, scores: {popularity, betting}}, ...] sorted descending by quality.
// Sort order: popularity DESC → betting DESC → starts_at ASC → id ASC (stable).
function rankCandidateMatches(matches) {
  return matches
    .map(m => ({
      match: m,
      scores: {
        popularity: computePopularityScore(m),
        betting: computeBettingScore(m),
      },
    }))
    .sort((a, b) => {
      if (b.scores.popularity !== a.scores.popularity) {
        return b.scores.popularity - a.scores.popularity;
      }
      if (b.scores.betting !== a.scores.betting) {
        return b.scores.betting - a.scores.betting;
      }
      if (a.match.starts_at !== b.match.starts_at) {
        return a.match.starts_at < b.match.starts_at ? -1 : 1;
      }
      return String(a.match.id) < String(b.match.id) ? -1 : 1;
    });
}

function pickBestMatch(matches) {
  const ranked = rankCandidateMatches(matches);
  return ranked.length > 0 ? ranked[0].match : null;
}

module.exports = {
  computePopularityScore,
  computeBettingScore,
  rankCandidateMatches,
  pickBestMatch,
};
