CREATE OR REPLACE VIEW logger.v_user_event_daily_stats AS
SELECT
    uel.event_date_msk,
    uel.telegram_user_id,
    uel.webapp_user_id,
    MAX(uel.event_ts) AS last_event_ts,
    COUNT(*)::bigint AS interactions_count,
    (COUNT(DISTINCT uel.session_id) FILTER (WHERE uel.session_id IS NOT NULL))::bigint AS sessions_count,
    COUNT(DISTINCT let.event_name)::bigint AS unique_event_types_count,
    (COUNT(*) FILTER (WHERE let.group_name = 'auth'))::bigint AS auth_interactions_count,
    (COUNT(*) FILTER (WHERE let.group_name = 'screen'))::bigint AS screen_interactions_count,
    (COUNT(*) FILTER (WHERE let.group_name = 'match'))::bigint AS match_interactions_count,
    (COUNT(*) FILTER (WHERE let.group_name = 'prediction'))::bigint AS prediction_interactions_count,
    (COUNT(*) FILTER (WHERE let.group_name = 'favorites'))::bigint AS favorites_interactions_count
FROM logger.user_event_log uel
JOIN logger.log_event_type let
  ON let.log_event_type_id = uel.log_event_type_id
GROUP BY
    uel.event_date_msk,
    uel.telegram_user_id,
    uel.webapp_user_id;

CREATE OR REPLACE VIEW logger.v_user_event_log_enriched AS
SELECT
    uel.user_event_log_id,
    uel.event_ts,
    uel.event_date_msk,
    uel.created_at,
    uel.telegram_user_id,
    uel.webapp_user_id,
    let.log_event_type_id::bigint AS log_event_type_id,
    let.group_name,
    let.event_name,
    let.entity_type AS event_entity_type,
    uel.entity_type AS log_entity_type,
    uel.entity_id,
    uel.path,
    uel.method,
    uel.status_code,
    uel.source,
    uel.session_id,
    uel.meta,
    uel.meta ->> 'screen' AS screen_name,
    uel.meta ->> 'auth_provider' AS auth_provider,
    uel.meta ->> 'access_mode' AS access_mode,
    uel.meta ->> 'match_slug' AS match_slug,
    COALESCE(uel.meta ->> 'prediction_slug', uel.meta ->> 'match_slug') AS prediction_slug,
    uel.meta ->> 'league_name' AS league_name,
    CASE
        WHEN jsonb_typeof(uel.meta -> 'is_preview') = 'boolean'
            THEN (uel.meta ->> 'is_preview')::boolean
        ELSE NULL
    END AS is_preview,
    CASE
        WHEN jsonb_typeof(uel.meta -> 'is_live') = 'boolean'
            THEN (uel.meta ->> 'is_live')::boolean
        ELSE NULL
    END AS is_live,
    CASE
        WHEN jsonb_typeof(uel.meta -> 'today_exists') = 'boolean'
            THEN (uel.meta ->> 'today_exists')::boolean
        ELSE NULL
    END AS today_exists,
    CASE
        WHEN jsonb_typeof(uel.meta -> 'tomorrow_exists') = 'boolean'
            THEN (uel.meta ->> 'tomorrow_exists')::boolean
        ELSE NULL
    END AS tomorrow_exists,
    CASE
        WHEN (uel.meta ->> 'leagues_count') ~ '^-?\d+$'
            THEN (uel.meta ->> 'leagues_count')::integer
        ELSE NULL
    END AS leagues_count,
    CASE
        WHEN (uel.meta ->> 'sports_count') ~ '^-?\d+$'
            THEN (uel.meta ->> 'sports_count')::integer
        ELSE NULL
    END AS sports_count,
    CASE
        WHEN (uel.meta ->> 'items_count') ~ '^-?\d+$'
            THEN (uel.meta ->> 'items_count')::integer
        ELSE NULL
    END AS items_count
FROM logger.user_event_log uel
JOIN logger.log_event_type let
  ON let.log_event_type_id = uel.log_event_type_id;

CREATE OR REPLACE VIEW logger.v_user_event_top_events_daily AS
SELECT
    uel.event_date_msk,
    let.group_name,
    let.event_name,
    COUNT(*)::bigint AS interactions_count,
    (COUNT(DISTINCT uel.telegram_user_id) FILTER (WHERE uel.telegram_user_id IS NOT NULL))::bigint AS unique_telegram_users_count,
    (COUNT(DISTINCT uel.webapp_user_id) FILTER (WHERE uel.webapp_user_id IS NOT NULL))::bigint AS unique_webapp_users_count,
    (COUNT(DISTINCT uel.session_id) FILTER (WHERE uel.session_id IS NOT NULL))::bigint AS unique_sessions_count,
    MAX(uel.event_ts) AS last_event_ts
FROM logger.user_event_log uel
JOIN logger.log_event_type let
  ON let.log_event_type_id = uel.log_event_type_id
GROUP BY
    uel.event_date_msk,
    let.group_name,
    let.event_name;

CREATE OR REPLACE VIEW logger.v_user_event_funnel_daily AS
WITH per_user_day AS (
    SELECT
        uel.event_date_msk,
        COALESCE(uel.telegram_user_id::text, CONCAT('webapp:', uel.webapp_user_id::text), CONCAT('session:', uel.session_id), CONCAT('log:', uel.user_event_log_id::text)) AS actor_key,
        MAX(CASE WHEN let.event_name = 'auth.login_success' THEN 1 ELSE 0 END) AS has_auth_login_success,
        MAX(CASE WHEN let.event_name = 'screen.home_open' THEN 1 ELSE 0 END) AS has_screen_home_open,
        MAX(CASE WHEN let.event_name = 'screen.recommendations_open' THEN 1 ELSE 0 END) AS has_screen_recommendations_open,
        MAX(CASE WHEN let.event_name = 'screen.daily_picks_open' THEN 1 ELSE 0 END) AS has_screen_daily_picks_open,
        MAX(CASE WHEN let.event_name = 'match.open' THEN 1 ELSE 0 END) AS has_match_open,
        MAX(CASE WHEN let.event_name = 'prediction.open' THEN 1 ELSE 0 END) AS has_prediction_open
    FROM logger.user_event_log uel
    JOIN logger.log_event_type let
      ON let.log_event_type_id = uel.log_event_type_id
    GROUP BY
        uel.event_date_msk,
        COALESCE(uel.telegram_user_id::text, CONCAT('webapp:', uel.webapp_user_id::text), CONCAT('session:', uel.session_id), CONCAT('log:', uel.user_event_log_id::text))
)
SELECT
    event_date_msk,
    COUNT(*)::bigint AS users_in_scope_count,
    SUM(has_auth_login_success)::bigint AS auth_login_success_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_home_open = 1 THEN 1 ELSE 0 END)::bigint AS home_after_login_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_recommendations_open = 1 THEN 1 ELSE 0 END)::bigint AS recommendations_after_login_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_daily_picks_open = 1 THEN 1 ELSE 0 END)::bigint AS daily_picks_after_login_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_match_open = 1 THEN 1 ELSE 0 END)::bigint AS match_open_after_login_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_prediction_open = 1 THEN 1 ELSE 0 END)::bigint AS prediction_open_after_login_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_home_open = 1 AND has_screen_recommendations_open = 1 THEN 1 ELSE 0 END)::bigint AS home_to_recommendations_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_home_open = 1 AND has_match_open = 1 THEN 1 ELSE 0 END)::bigint AS home_to_match_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_recommendations_open = 1 AND has_prediction_open = 1 THEN 1 ELSE 0 END)::bigint AS recommendations_to_prediction_users_count,
    SUM(CASE WHEN has_auth_login_success = 1 AND has_screen_daily_picks_open = 1 AND has_prediction_open = 1 THEN 1 ELSE 0 END)::bigint AS daily_picks_to_prediction_users_count
FROM per_user_day
GROUP BY event_date_msk;
