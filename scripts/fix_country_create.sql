-- Fix external.public_country_create
CREATE OR REPLACE FUNCTION external.public_country_create(
  in_system_country_id varchar,
  in_country_id integer,
  in_system_country_slug varchar,
  in_system_id integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO external.public_country(system_country_id, system_country_slug, country_id, system_id)
    VALUES (in_system_country_id, in_system_country_slug, in_country_id, in_system_id);
    RETURN 0;
END;
$$;

-- Fix public.country_create
CREATE OR REPLACE FUNCTION public.country_create(
  in_system_country_id varchar,
  in_system_id integer,
  in_system_country_slug varchar,
  in_country_name varchar,
  in_country_code varchar,
  in_country_image_path varchar,
  in_country_name_en varchar
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    out_country_id integer;
BEGIN
    INSERT INTO country(country_name, country_code, country_image_path, country_name_en)
    VALUES (in_country_name, in_country_code, in_country_image_path, in_country_name_en)
    RETURNING country_id INTO out_country_id;

    PERFORM external.public_country_create(
          in_system_country_id => in_system_country_id
        , in_country_id => out_country_id
        , in_system_country_slug => in_system_country_slug
        , in_system_id => in_system_id
    );

    RETURN out_country_id;
END;
$$;
