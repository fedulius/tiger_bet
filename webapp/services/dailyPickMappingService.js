'use strict';

async function resolveSystemIdForDailyPickSource(pg, { systemName = 'sstats' } = {}) {
  if (!systemName) throw new Error('systemName is required');
  const [row] = await pg.connection(
    'SELECT system_id FROM external.system WHERE system_name = $1',
    [systemName],
  );
  return row ? (row.system_id ?? null) : null;
}

async function resolveSportIdBySportSlug(pg, { sportSlug }) {
  if (!sportSlug) throw new Error('sportSlug is required');
  const [row] = await pg.connection(
    'SELECT sport_id FROM public.sport WHERE sport_url = $1 AND COALESCE(is_active, 0) = 1',
    [sportSlug],
  );
  return row ? (row.sport_id ?? null) : null;
}

async function resolveTournamentIdForCandidate(pg, { systemId, candidate }) {
  if (systemId == null) throw new Error('systemId is required');
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');

  if (candidate.external_league_id != null) {
    const [row] = await pg.connection(
      'SELECT tournament_id FROM external.public_tournament WHERE system_id = $1 AND system_tournament_id = $2',
      [systemId, candidate.external_league_id],
    );
    if (row) return row.tournament_id ?? null;
  }

  if (candidate.league_slug) {
    const [row] = await pg.connection(
      'SELECT tournament_id FROM external.public_tournament WHERE system_id = $1 AND system_tournament_slug = $2',
      [systemId, candidate.league_slug],
    );
    if (row) return row.tournament_id ?? null;
  }

  return null;
}

async function resolveDbContextForCandidate(pg, { systemName = 'sstats', candidate } = {}) {
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');

  const systemId = await resolveSystemIdForDailyPickSource(pg, { systemName });
  if (systemId == null) return { systemId: null, sportId: null, tournamentId: null };

  const sportId = candidate.sport_slug
    ? await resolveSportIdBySportSlug(pg, { sportSlug: candidate.sport_slug })
    : null;

  const tournamentId = await resolveTournamentIdForCandidate(pg, { systemId, candidate });

  return {
    systemId,
    sportId: sportId ?? null,
    tournamentId: tournamentId ?? null,
  };
}

module.exports = {
  resolveSystemIdForDailyPickSource,
  resolveSportIdBySportSlug,
  resolveTournamentIdForCandidate,
  resolveDbContextForCandidate,
};
