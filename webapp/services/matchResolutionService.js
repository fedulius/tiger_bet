'use strict';

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function normalizeProviderTeamKey(value) {
  const transliterated = Array.from(String(value || '').trim().toLowerCase(), (character) => CYRILLIC_TO_LATIN[character] ?? character).join('');
  const tokens = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const filtered = tokens.filter((token) => !['fc', 'fk', 'fck', 'club'].includes(token));
  const womenIndex = filtered.findIndex((token) => ['zh', 'women', 'woman', 'female', 'w'].includes(token));
  if (womenIndex !== -1) {
    filtered.splice(womenIndex, 1);
    filtered.push('women');
  }
  return filtered.join('-');
}

function queryRows(pg, sql, params) {
  return pg.connection(sql, params).then((rows) => Array.isArray(rows) ? rows : []);
}

function teamDetails(input) {
  return {
    systemId: input.systemId,
    systemTeamId: input.systemTeamId || null,
    normalizedKey: normalizeProviderTeamKey(input.systemTeamSlug || input.systemTeamName),
  };
}

async function resolveCanonicalTeam(pg, input) {
  const details = teamDetails(input || {});
  try {
    if (details.systemId != null && details.systemTeamId) {
      const rows = await queryRows(pg, `
        SELECT pt.team_id, pt.mapping_confidence
        FROM external.public_team pt
        JOIN public.team t ON t.team_id = pt.team_id
        WHERE pt.system_id = $1 AND pt.system_team_id = $2 AND t.is_active = 1
      `, [details.systemId, details.systemTeamId]);
      if (rows.length === 1) return { status: 'resolved', teamId: rows[0].team_id, method: 'provider_id', confidence: 1, details: { systemId: details.systemId, systemTeamId: details.systemTeamId } };
      if (rows.length > 1) return { status: 'ambiguous', method: 'provider_id', confidence: 0, details: { ...details, candidateTeamIds: rows.map((row) => row.team_id) } };
    }
    if (!details.normalizedKey || input?.sportId == null) return { status: 'unresolved', method: 'unresolved', confidence: 0, details };

    const providerRows = await queryRows(pg, `
      SELECT a.team_id
      FROM public.team_alias a
      JOIN public.team t ON t.team_id = a.team_id
      WHERE a.sport_id = $1 AND a.alias_normalized = $2 AND a.system_id = $3
        AND a.is_active = 1 AND t.is_active = 1
    `, [input.sportId, details.normalizedKey, details.systemId]);
    if (providerRows.length === 1) return { status: 'resolved', teamId: providerRows[0].team_id, method: 'provider_alias', confidence: 0.8, details };
    if (providerRows.length > 1) return { status: 'ambiguous', method: 'provider_alias', confidence: 0, details: { ...details, candidateTeamIds: providerRows.map((row) => row.team_id) } };

    const globalRows = await queryRows(pg, `
      SELECT a.team_id
      FROM public.team_alias a
      JOIN public.team t ON t.team_id = a.team_id
      WHERE a.sport_id = $1 AND a.alias_normalized = $2 AND a.system_id IS NULL
        AND a.is_active = 1 AND t.is_active = 1
    `, [input.sportId, details.normalizedKey]);
    if (globalRows.length === 1) return { status: 'resolved', teamId: globalRows[0].team_id, method: 'global_alias', confidence: 0.7, details };
    if (globalRows.length > 1) return { status: 'ambiguous', method: 'global_alias', confidence: 0, details: { ...details, candidateTeamIds: globalRows.map((row) => row.team_id) } };
    return { status: 'unresolved', method: 'unresolved', confidence: 0, details };
  } catch (error) {
    return { status: 'error', method: 'read_error', confidence: 0, details: { ...details, error: error.message } };
  }
}

async function logDecision(pg, input, decision) {
  try {
    await queryRows(pg, `
      INSERT INTO public.match_resolution_log (
        source_system_id, source_match_id, source_match_slug, target_system_id, target_match_id,
        internal_match_id, resolution_status, resolution_method, resolution_confidence, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `, [
      input.source.systemId, input.source.matchId, input.source.matchSlug || null,
      input.target?.systemId || null, input.target?.matchId || null, decision.matchId || null,
      decision.status, decision.method, decision.confidence ?? null, JSON.stringify(decision.details || {}),
    ]);
  } catch (_) { /* audit logging is intentionally best effort */ }
}

async function resolveProviderFixture(pg, input) {
  let decision;
  try {
    const exactRows = await queryRows(pg, `
      SELECT pm.match_id
      FROM external.public_match pm
      WHERE pm.system_id = $1 AND pm.system_match_id = $2
    `, [input.source.systemId, input.source.matchId]);
    if (exactRows.length === 1) {
      decision = { status: 'resolved', matchId: exactRows[0].match_id, method: 'existing_match', confidence: 1, details: { sourceSystemId: input.source.systemId, sourceMatchId: input.source.matchId } };
    } else if (exactRows.length > 1) {
      decision = { status: 'ambiguous', method: 'existing_match', confidence: 0, details: { candidateMatchIds: exactRows.map((row) => row.match_id) } };
    } else {
      const [home, away] = await Promise.all([
        resolveCanonicalTeam(pg, { ...input.source.home, sportId: input.sportId }),
        resolveCanonicalTeam(pg, { ...input.source.away, sportId: input.sportId }),
      ]);
      if (home.status === 'error' || away.status === 'error') {
        decision = { status: 'error', method: 'read_error', confidence: 0, details: { home, away } };
      } else if (home.status !== 'resolved' || away.status !== 'resolved') {
        decision = { status: home.status === 'ambiguous' || away.status === 'ambiguous' ? 'ambiguous' : 'unresolved', method: 'canonical_pair_time', confidence: 0, details: { home, away } };
      } else {
        const candidates = await queryRows(pg, `
          SELECT m.match_id, pm.system_match_id
          FROM external.public_match pm
          JOIN public.match m ON m.match_id = pm.match_id
          WHERE pm.system_id = $1
            AND m.sport_id = $2
            AND m.home_team_id = $3 AND m.away_team_id = $4
            AND m.match_start_at BETWEEN $5::timestamptz - interval '3 hours' AND $5::timestamptz + interval '3 hours'
            AND ($6::integer IS NULL OR m.tournament_id = $6)
        `, [input.target.systemId, input.sportId, home.teamId, away.teamId, input.startAt, input.tournamentId ?? null]);
        if (candidates.length === 1) decision = { status: 'resolved', matchId: candidates[0].match_id, method: 'canonical_pair_time', confidence: 0.9, details: { targetSystemId: input.target.systemId, targetMatchId: candidates[0].system_match_id, homeTeamId: home.teamId, awayTeamId: away.teamId } };
        else if (candidates.length > 1) decision = { status: 'ambiguous', method: 'canonical_pair_time', confidence: 0, details: { candidateMatchIds: candidates.map((row) => row.match_id), homeTeamId: home.teamId, awayTeamId: away.teamId } };
        else decision = { status: 'unresolved', method: 'canonical_pair_time', confidence: 0, details: { homeTeamId: home.teamId, awayTeamId: away.teamId } };
      }
    }
  } catch (error) {
    decision = { status: 'error', method: 'read_error', confidence: 0, details: { error: error.message } };
  }
  if (decision.status !== 'error') await logDecision(pg, input, decision);
  return decision;
}

async function resolveExactProviderTeam(pg, team) {
  const systemTeamId = providerTeamId(team);
  if (team.systemId == null || !systemTeamId) return null;
  const rows = await queryRows(pg, `
    SELECT pt.team_id
    FROM external.public_team pt
    WHERE pt.system_id = $1 AND pt.system_team_id = $2
  `, [team.systemId, systemTeamId]);
  return rows.length === 1 ? rows[0].team_id : null;
}

function providerTeamId(team) {
  const normalizedKey = normalizeProviderTeamKey(team.systemTeamSlug || team.systemTeamName);
  return team.systemTeamId || (normalizedKey ? `slug:${normalizedKey}` : null);
}

async function insertProviderTeamMapping(pg, team, teamId, sourcePayload) {
  const systemTeamId = providerTeamId(team);
  if (team.systemId == null || !systemTeamId) throw new Error('provider_team_identity_missing');
  await queryRows(pg, `
    INSERT INTO external.public_team (
      system_id, system_team_id, system_team_slug, system_team_name, team_id, source_payload
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  `, [
    team.systemId,
    systemTeamId,
    team.systemTeamSlug || null,
    team.systemTeamName || null,
    teamId,
    JSON.stringify(sourcePayload || {}),
  ]);
}

async function bootstrapCanonicalPair(pg, { source, target, sportId, genderCode = 'unknown', sourcePayload }) {
  const sourceHome = source?.home || {};
  const sourceAway = source?.away || {};
  const targetHome = target?.home || {};
  const targetAway = target?.away || {};
  const targetHomeKey = normalizeProviderTeamKey(targetHome.systemTeamSlug || targetHome.systemTeamName);
  const targetAwayKey = normalizeProviderTeamKey(targetAway.systemTeamSlug || targetAway.systemTeamName);
  let decision;

  if (!targetHomeKey || !targetAwayKey || targetHomeKey === targetAwayKey) {
    decision = { status: 'rejected', method: 'manual', confidence: 0, details: { reason: 'equal_or_missing_target_teams' } };
    await logDecision(pg, { source: { ...source, systemId: source?.systemId ?? sourceHome.systemId }, target }, decision);
    return decision;
  }

  try {
    const teamIds = [];
    for (const [targetTeam, sourceTeam] of [[targetHome, sourceHome], [targetAway, sourceAway]]) {
      let teamId = await resolveExactProviderTeam(pg, targetTeam);
      if (teamId == null) {
        const canonicalSlug = normalizeProviderTeamKey(targetTeam.systemTeamSlug || targetTeam.systemTeamName);
        try {
          const created = await queryRows(pg, `
            INSERT INTO public.team (sport_id, team_gender_code, team_name, team_slug)
            VALUES ($1, $2, $3, $4)
            RETURNING team_id
          `, [sportId, genderCode, targetTeam.systemTeamName, canonicalSlug]);
          teamId = created[0]?.team_id;
          if (teamId == null) throw new Error('canonical_team_create_failed');
          await insertProviderTeamMapping(pg, targetTeam, teamId, targetTeam.sourcePayload || targetTeam);
        } catch (error) {
          if (error?.code === '23505') {
            teamId = await resolveExactProviderTeam(pg, targetTeam);
            if (teamId == null) {
              return { status: 'unresolved', method: 'manual', confidence: 0, details: { reason: 'concurrent_target_mapping_conflict' } };
            }
          } else {
            throw error;
          }
        }
      }
      const sourceMappedTeamId = await resolveExactProviderTeam(pg, sourceTeam);
      if (sourceMappedTeamId != null && sourceMappedTeamId !== teamId) {
        throw new Error('source_provider_mapping_conflicts_with_canonical_team');
      }
      if (sourceMappedTeamId == null) {
        await insertProviderTeamMapping(pg, sourceTeam, teamId, sourcePayload || sourceTeam.sourcePayload || sourceTeam);
      }
      teamIds.push(teamId);
    }
    decision = { status: 'resolved', method: 'manual', confidence: 1, homeTeamId: teamIds[0], awayTeamId: teamIds[1], details: { targetSystemId: targetHome.systemId, sourceSystemId: sourceHome.systemId } };
  } catch (error) {
    decision = { status: 'error', method: 'manual', confidence: 0, details: { error: error.message } };
  }
  await logDecision(pg, { source: { ...source, systemId: source?.systemId ?? sourceHome.systemId }, target }, decision);
  return decision;
}

module.exports = { normalizeProviderTeamKey, resolveCanonicalTeam, resolveProviderFixture, bootstrapCanonicalPair };
