CREATE OR REPLACE FUNCTION logger.log_event_type_resolve(
    p_event_name text
)
RETURNS TABLE (
    log_event_type_id bigint,
    group_name text,
    event_name text,
    entity_type text
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_event_name IS NULL OR btrim(p_event_name) = '' THEN
        RAISE EXCEPTION 'p_event_name is required';
    END IF;

    RETURN QUERY
    SELECT
        let.log_event_type_id::bigint,
        let.group_name,
        let.event_name,
        let.entity_type
    FROM logger.log_event_type let
    WHERE let.event_name = btrim(p_event_name)
      AND COALESCE(let.is_active, 0) = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown or inactive event_name: %', p_event_name;
    END IF;
END;
$$;
