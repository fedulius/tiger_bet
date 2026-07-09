CREATE OR REPLACE FUNCTION logger.user_event_log_create(
    p_event_name         text,
    p_telegram_user_id   bigint DEFAULT NULL,
    p_webapp_user_id     bigint DEFAULT NULL,
    p_event_ts           timestamptz DEFAULT now(),
    p_event_date_msk     date DEFAULT NULL,
    p_path               text DEFAULT NULL,
    p_method             varchar(10) DEFAULT NULL,
    p_status_code        integer DEFAULT NULL,
    p_entity_id          text DEFAULT NULL,
    p_source             text DEFAULT 'webapp',
    p_session_id         text DEFAULT NULL,
    p_meta               jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    user_event_log_id    bigint,
    log_event_type_id    bigint,
    telegram_user_id     bigint,
    webapp_user_id       bigint,
    event_ts             timestamptz,
    event_date_msk       date,
    path                 text,
    method               varchar(10),
    status_code          integer,
    entity_type          text,
    entity_id            text,
    source               text,
    session_id           text,
    meta                 jsonb,
    created_at           timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_log_event_type_id bigint;
    v_group_name        text;
    v_resolved_name     text;
    v_entity_type       text;
    v_event_ts          timestamptz;
    v_event_date_msk    date;
BEGIN
    v_event_ts := COALESCE(p_event_ts, now());

    SELECT
        r.log_event_type_id,
        r.group_name,
        r.event_name,
        r.entity_type
    INTO
        v_log_event_type_id,
        v_group_name,
        v_resolved_name,
        v_entity_type
    FROM logger.log_event_type_resolve(p_event_name) r;

    v_event_date_msk := COALESCE(
        p_event_date_msk,
        (v_event_ts AT TIME ZONE 'Europe/Moscow')::date
    );

    RETURN QUERY
    INSERT INTO logger.user_event_log (
        log_event_type_id,
        telegram_user_id,
        webapp_user_id,
        event_ts,
        event_date_msk,
        path,
        method,
        status_code,
        entity_type,
        entity_id,
        source,
        session_id,
        meta
    )
    VALUES (
        v_log_event_type_id::integer,
        p_telegram_user_id,
        p_webapp_user_id,
        v_event_ts,
        v_event_date_msk,
        COALESCE(NULLIF(btrim(p_path), ''), '/'),
        UPPER(COALESCE(NULLIF(btrim(p_method), ''), 'GET')),
        COALESCE(p_status_code, 200),
        v_entity_type,
        NULLIF(btrim(p_entity_id), ''),
        COALESCE(NULLIF(btrim(p_source), ''), 'webapp'),
        NULLIF(btrim(p_session_id), ''),
        COALESCE(p_meta, '{}'::jsonb)
    )
    RETURNING
        logger.user_event_log.user_event_log_id,
        logger.user_event_log.log_event_type_id::bigint,
        logger.user_event_log.telegram_user_id,
        logger.user_event_log.webapp_user_id,
        logger.user_event_log.event_ts,
        logger.user_event_log.event_date_msk,
        logger.user_event_log.path,
        logger.user_event_log.method,
        logger.user_event_log.status_code,
        logger.user_event_log.entity_type,
        logger.user_event_log.entity_id,
        logger.user_event_log.source,
        logger.user_event_log.session_id,
        logger.user_event_log.meta,
        logger.user_event_log.created_at;
END;
$$;
