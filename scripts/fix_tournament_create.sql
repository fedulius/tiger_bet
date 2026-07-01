-- Fix tournament_create: use type_title instead of tournament_type
CREATE OR REPLACE FUNCTION public.tournament_create(
  in_system_id integer,
  in_sport_id integer,
  in_country_code varchar,
  in_country_name varchar,
  in_system_tournament_id varchar,
  in_system_tournament_slug varchar,
  in_tournament_name varchar,
  in_tournament_name_en varchar,
  in_tournament_code varchar,
  in_image_path varchar,
  in_tournament_type_name varchar
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    tmp_country_id integer;
    tmp_tournament_type_id integer;
    out_tournament_id integer;
BEGIN
    SELECT country_id
    FROM country
    WHERE country_name_en = in_country_name
      AND country_code = in_country_code
    INTO tmp_country_id;

    SELECT tournament_type_id
    FROM tournament_type
    WHERE type_title = lower(in_tournament_type_name)
    INTO tmp_tournament_type_id;

    IF tmp_country_id IS NULL THEN
       RETURN -1;
    END IF;

    IF tmp_tournament_type_id IS NULL THEN
        RETURN -2;
    END IF;

    INSERT INTO public.tournament(
        sport_id, country_id, tournament_name, tournament_code,
        tournament_image_path, tournament_type_id, tournament_name_en
    ) VALUES (
        in_sport_id, tmp_country_id, in_tournament_name, in_tournament_code,
        in_image_path, tmp_tournament_type_id, in_tournament_name_en
    )
    RETURNING tournament_id INTO out_tournament_id;

    PERFORM external.public_tournament_create(
        in_system_tournament_id => in_system_tournament_id,
        in_tournament_id => out_tournament_id,
        in_system_tournament_slug => in_system_tournament_slug,
        in_system_id => in_system_id
    );

    RETURN out_tournament_id;
END;
$$;
