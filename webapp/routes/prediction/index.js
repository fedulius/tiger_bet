'use strict';

const { logUserEvent } = require('../../services/eventLogService');
async function predictionRoutes(fastify) {
  fastify.get('/:slug', async (request, reply) => {
    const { slug } = request.params;
    if (!slug) {
      return reply.code(400).send({ error: 'slug required' });
    }

    const rows = await fastify.pg.connection(
      `SELECT
        ma.match_analysis_id,
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
        s.sport_url,
        t.tournament_name,
        t.tournament_name_en,
        pm.system_match_id
      FROM public.match_analysis ma
      JOIN public.analysis_status ast ON ast.analysis_status_id = ma.analysis_status_id
      JOIN public.match_source ms ON ms.match_source_id = ma.match_source_id
      JOIN public.match m ON m.match_id = ms.match_id
      LEFT JOIN public.sport s ON s.sport_id = m.sport_id
      LEFT JOIN public.tournament t ON t.tournament_id = m.tournament_id
      LEFT JOIN external.public_match pm ON pm.match_id = m.match_id AND pm.system_id = 3
      WHERE ast.analysis_status_name = 'ready'
        AND (
          pm.system_match_slug = $1
          OR pm.system_match_id = $1
          OR ms.source_payload->>'match_slug' = $1
        )
      ORDER BY ma.analysis_create_at DESC
      LIMIT 1`,
      [slug],
    );

    if (!rows.length) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const row = rows[0];
    const bets = Array.isArray(row.recommended_bets) ? row.recommended_bets : [];

    const payload = {
      id: row.match_analysis_id,
      match_id: row.match_id,
      match_slug: slug,
      home_team: row.home_team,
      away_team: row.away_team,
      starts_at: row.match_start_at,
      sport_name: row.sport_name || '',
      league: row.tournament_name || row.tournament_name_en || '',
      headline: row.analysis_headline || '',
      brief: row.analysis_brief || '',
      risk_note: row.analysis_risk_note || '',
      bets: bets.map((b) => ({
        type: b.type || '',
        outcome: b.outcome || '',
        label: b.label || '',
        rate: b.rate ?? null,
        reason: b.reason || '',
        risk_label: b.risk_label || 'low',
      })),
      model_name: row.model_name || '',
      prompt_version: row.prompt_version || '',
      created_at: row.analysis_create_at || null,
      updated_at: row.analysis_update_at || null,
    };

    await logUserEvent(fastify, request, {
      eventName: 'prediction.open',
      statusCode: 200,
      entityId: slug,
      meta: {
        match_slug: slug,
        match_id: row.match_id,
        sport_name: row.sport_name || '',
        league_name: row.tournament_name || row.tournament_name_en || '',
      },
    });

    return payload;
  });
}

module.exports = predictionRoutes;
