BEGIN;

-- =========================================================
-- 0. Schemas
-- =========================================================

CREATE SCHEMA IF NOT EXISTS notification;

-- =========================================================
-- 1. External mapping: provider match statuses -> public.match_status
--    Universal mapping for all providers/sports. Do NOT create SStats-only
--    status dictionaries; map every provider status to public.match_status.
-- =========================================================

-- Ensure core domain statuses are present and flags are correct.
-- Existing IDs are preserved by matching on match_status_name.
INSERT INTO public.match_status (
    match_status_name,
    is_not_started,
    is_live,
    is_finished,
    is_cancelled,
    updated_at
)
VALUES
    ('scheduled', true,  false, false, false, now()),
    ('live',      false, true,  false, false, now()),
    ('finished',  false, false, true,  false, now()),
    ('cancelled', false, false, false, true,  now())
ON CONFLICT DO NOTHING;

UPDATE public.match_status
SET
    is_not_started = CASE WHEN match_status_name = 'scheduled' THEN true ELSE false END,
    is_live = CASE WHEN match_status_name = 'live' THEN true ELSE false END,
    is_finished = CASE WHEN match_status_name = 'finished' THEN true ELSE false END,
    is_cancelled = CASE WHEN match_status_name = 'cancelled' THEN true ELSE false END,
    updated_at = now()
WHERE match_status_name IN ('scheduled', 'live', 'finished', 'cancelled');

CREATE TABLE IF NOT EXISTS external.public_match_status (
    system_match_status_id    varchar(128) NOT NULL,
    system_match_status_name  varchar(128) NULL,

    match_status_id           integer NOT NULL,
    system_id                 integer NOT NULL,

    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NULL,

    CONSTRAINT public_match_status_pk
        PRIMARY KEY (system_id, system_match_status_id),

    CONSTRAINT public_match_status_match_status_fk
        FOREIGN KEY (match_status_id)
        REFERENCES public.match_status (match_status_id),

    CONSTRAINT public_match_status_system_fk
        FOREIGN KEY (system_id)
        REFERENCES external.system (system_id)
);

COMMENT ON TABLE external.public_match_status IS
'Маппинг внешних статусов матча из разных систем в универсальный public.match_status.';

COMMENT ON COLUMN external.public_match_status.system_match_status_id IS
'Raw status id/code внешней системы. Хранится varchar, потому что у разных провайдеров это могут быть числа или строки: 8, FT, LIVE, POSTPONED.';

COMMENT ON COLUMN external.public_match_status.system_match_status_name IS
'Raw readable status name внешней системы для диагностики.';

CREATE INDEX IF NOT EXISTS ix_public_match_status_match_status
    ON external.public_match_status (match_status_id);

-- Seed SStats status mapping (external.system system_id=3 = sstats).
INSERT INTO external.public_match_status (
    system_match_status_id,
    system_match_status_name,
    match_status_id,
    system_id
)
SELECT
    v.system_match_status_id,
    v.system_match_status_name,
    ms.match_status_id,
    3 AS system_id
FROM (
    VALUES
        ('1',  'Not Announced',             'scheduled'),
        ('2',  'Not Started',               'scheduled'),

        ('3',  'First Half',                'live'),
        ('4',  'Half Time',                 'live'),
        ('5',  'Second Half',               'live'),
        ('6',  'Extra Time',                'live'),
        ('7',  'Penalty Shootout',          'live'),

        ('8',  'Finished',                  'finished'),
        ('9',  'Finished After Extra Time', 'finished'),
        ('10', 'Finished After Penalty',    'finished'),

        ('12', 'Postponed',                 'scheduled'),
        ('13', 'Suspended',                 'live'),
        ('14', 'Cancelled',                 'cancelled'),
        ('15', 'Abandoned',                 'cancelled')
) AS v(system_match_status_id, system_match_status_name, match_status_name)
JOIN public.match_status ms
  ON ms.match_status_name = v.match_status_name
ON CONFLICT (system_id, system_match_status_id) DO UPDATE SET
    system_match_status_name = EXCLUDED.system_match_status_name,
    match_status_id = EXCLUDED.match_status_id,
    updated_at = now();

-- =========================================================
-- 2. Generic notification schema
-- =========================================================

-- ---------------------------------------------------------
-- 2.1 notification.channel
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.channel (
    channel_id      smallserial PRIMARY KEY,

    channel_code    varchar(64) NOT NULL,
    channel_name    varchar(128) NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ux_notification_channel_code
        UNIQUE (channel_code),

    CONSTRAINT chk_notification_channel_code
        CHECK (channel_code ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE notification.channel IS
'Справочник каналов доставки уведомлений: telegram, web_push, email, in_app.';

INSERT INTO notification.channel (
    channel_code,
    channel_name,
    is_active
)
VALUES
    ('telegram', 'Telegram', true)
ON CONFLICT (channel_code) DO UPDATE SET
    channel_name = EXCLUDED.channel_name,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ---------------------------------------------------------
-- 2.2 notification.type
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.type (
    notification_type_id      smallserial PRIMARY KEY,

    type_code                 varchar(128) NOT NULL,
    domain_name               varchar(64) NOT NULL,

    default_channel_id        smallint NULL,
    default_priority          smallint NOT NULL DEFAULT 100,

    is_user_configurable      boolean NOT NULL DEFAULT true,
    is_active                 boolean NOT NULL DEFAULT true,

    description               text NULL,

    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ux_notification_type_code
        UNIQUE (type_code),

    CONSTRAINT fk_notification_type_default_channel
        FOREIGN KEY (default_channel_id)
        REFERENCES notification.channel (channel_id),

    CONSTRAINT chk_notification_type_priority
        CHECK (default_priority BETWEEN 0 AND 1000),

    CONSTRAINT chk_notification_type_code
        CHECK (type_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

COMMENT ON TABLE notification.type IS
'Справочник семантических типов уведомлений: match.started, match.score_changed, prediction.published и т.д.';

COMMENT ON COLUMN notification.type.type_code IS
'Стабильный код типа уведомления. Не содержит текст сообщения.';

INSERT INTO notification.type (
    type_code,
    domain_name,
    default_channel_id,
    default_priority,
    is_user_configurable,
    is_active,
    description
)
SELECT
    v.type_code,
    v.domain_name,
    c.channel_id,
    v.default_priority,
    v.is_user_configurable,
    true,
    v.description
FROM (
    VALUES
        ('match.started',       'match', 100::smallint, true, 'Матч начался'),
        ('match.score_changed', 'match', 100::smallint, true, 'Изменился счёт матча'),
        ('match.finished',      'match', 100::smallint, true, 'Матч завершён'),
        ('match.cancelled',     'match', 100::smallint, true, 'Матч отменён или прерван'),

        ('prediction.published',     'prediction', 100::smallint, true, 'Опубликован прогноз'),
        ('prediction.vip_published', 'prediction', 200::smallint, true, 'Опубликован VIP-прогноз'),

        ('subscription.expiring', 'subscription', 100::smallint, true, 'Подписка скоро закончится'),
        ('system.announcement',   'system',        50::smallint, true, 'Системное объявление')
) AS v(type_code, domain_name, default_priority, is_user_configurable, description)
JOIN notification.channel c
  ON c.channel_code = 'telegram'
ON CONFLICT (type_code) DO UPDATE SET
    domain_name = EXCLUDED.domain_name,
    default_channel_id = EXCLUDED.default_channel_id,
    default_priority = EXCLUDED.default_priority,
    is_user_configurable = EXCLUDED.is_user_configurable,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    updated_at = now();

-- ---------------------------------------------------------
-- 2.3 notification.preference
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.preference (
    user_id                 integer NOT NULL,
    notification_type_id    smallint NOT NULL,
    channel_id              smallint NOT NULL,

    is_enabled              boolean NOT NULL DEFAULT true,
    settings                jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_notification_preference
        PRIMARY KEY (user_id, notification_type_id, channel_id),

    CONSTRAINT fk_notification_preference_user
        FOREIGN KEY (user_id)
        REFERENCES public."user" (user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notification_preference_type
        FOREIGN KEY (notification_type_id)
        REFERENCES notification.type (notification_type_id),

    CONSTRAINT fk_notification_preference_channel
        FOREIGN KEY (channel_id)
        REFERENCES notification.channel (channel_id),

    CONSTRAINT chk_notification_preference_settings_object
        CHECK (jsonb_typeof(settings) = 'object')
);

COMMENT ON TABLE notification.preference IS
'Пользовательские настройки включения/отключения типов уведомлений по каналам. Отсутствие строки = использовать default.';

CREATE INDEX IF NOT EXISTS ix_notification_preference_user_channel_enabled
    ON notification.preference (user_id, channel_id)
    WHERE is_enabled = true;

-- ---------------------------------------------------------
-- 2.4 notification.template
-- Optional, but useful for future universal notification rendering.
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.template (
    notification_template_id    bigserial PRIMARY KEY,

    notification_type_id        smallint NOT NULL,
    channel_id                  smallint NOT NULL,

    locale_code                 varchar(16) NOT NULL DEFAULT 'ru',
    template_version            integer NOT NULL DEFAULT 1,

    title_template              text NULL,
    body_template               text NOT NULL,
    payload_template            jsonb NULL,

    is_active                   boolean NOT NULL DEFAULT true,

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_notification_template_type
        FOREIGN KEY (notification_type_id)
        REFERENCES notification.type (notification_type_id),

    CONSTRAINT fk_notification_template_channel
        FOREIGN KEY (channel_id)
        REFERENCES notification.channel (channel_id),

    CONSTRAINT ux_notification_template_version
        UNIQUE (notification_type_id, channel_id, locale_code, template_version),

    CONSTRAINT chk_notification_template_payload_object
        CHECK (payload_template IS NULL OR jsonb_typeof(payload_template) = 'object')
);

COMMENT ON TABLE notification.template IS
'Шаблоны сообщений по типу уведомления, каналу и локали. История delivery хранит rendered_payload отдельно.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_template_active
    ON notification.template (notification_type_id, channel_id, locale_code)
    WHERE is_active = true;

-- Seed basic Telegram templates.
INSERT INTO notification.template (
    notification_type_id,
    channel_id,
    locale_code,
    template_version,
    title_template,
    body_template,
    is_active
)
SELECT
    nt.notification_type_id,
    c.channel_id,
    'ru',
    1,
    v.title_template,
    v.body_template,
    true
FROM (
    VALUES
        ('match.started',       '⚽ Матч начался',   '⚽ Матч начался\n\n{{match_title}}\n{{league_name}}\n\nСчёт: {{score}}'),
        ('match.score_changed', '⚽ Изменился счёт', '⚽ Изменился счёт\n\n{{match_title}}\n{{league_name}}\n\nСчёт: {{score}}\n{{elapsed}}'),
        ('match.finished',      '🏁 Матч завершён', '🏁 Матч завершён\n\n{{match_title}}\n{{league_name}}\n\nИтоговый счёт: {{score}}'),
        ('match.cancelled',     '⚠️ Матч отменён',  '⚠️ Матч отменён или прерван\n\n{{match_title}}\n{{league_name}}')
) AS v(type_code, title_template, body_template)
JOIN notification.type nt
  ON nt.type_code = v.type_code
JOIN notification.channel c
  ON c.channel_code = 'telegram'
ON CONFLICT (notification_type_id, channel_id, locale_code, template_version) DO UPDATE SET
    title_template = EXCLUDED.title_template,
    body_template = EXCLUDED.body_template,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ---------------------------------------------------------
-- 2.5 notification.event
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.event (
    notification_event_id     bigserial PRIMARY KEY,

    notification_type_id      smallint NOT NULL,

    source_name               varchar(128) NOT NULL,
    source_event_key          varchar(256) NOT NULL,

    aggregate_type            varchar(64) NULL,
    aggregate_id              varchar(128) NULL,

    occurred_at               timestamptz NOT NULL,
    available_at              timestamptz NOT NULL DEFAULT now(),

    payload                   jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id            varchar(128) NULL,

    created_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_notification_event_type
        FOREIGN KEY (notification_type_id)
        REFERENCES notification.type (notification_type_id),

    CONSTRAINT ux_notification_event_source_key
        UNIQUE (source_name, source_event_key),

    CONSTRAINT chk_notification_event_payload_object
        CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE notification.event IS
'Универсальный журнал событий-кандидатов на уведомление. Одно событие может породить много delivery.';

COMMENT ON COLUMN notification.event.source_event_key IS
'Идемпотентный ключ события в источнике. Например match_event:<id> или provider-specific key.';

CREATE INDEX IF NOT EXISTS ix_notification_event_type_occurred
    ON notification.event (notification_type_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_event_aggregate
    ON notification.event (aggregate_type, aggregate_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_event_correlation
    ON notification.event (correlation_id)
    WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------
-- 2.6 notification.delivery
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.delivery (
    notification_delivery_id   bigserial PRIMARY KEY,

    notification_event_id      bigint NOT NULL,
    user_id                    integer NOT NULL,
    channel_id                 smallint NOT NULL,

    recipient_address          varchar(256) NOT NULL,

    notification_template_id   bigint NULL,

    delivery_status            varchar(32) NOT NULL DEFAULT 'pending',
    priority                   smallint NOT NULL DEFAULT 100,

    scheduled_at               timestamptz NOT NULL DEFAULT now(),
    next_attempt_at            timestamptz NOT NULL DEFAULT now(),

    attempt_count              integer NOT NULL DEFAULT 0,
    max_attempts               integer NOT NULL DEFAULT 5,

    locked_at                  timestamptz NULL,
    locked_by                  varchar(128) NULL,

    sent_at                    timestamptz NULL,
    failed_at                  timestamptz NULL,

    provider_message_id        varchar(128) NULL,

    last_error_code            varchar(128) NULL,
    last_error                 text NULL,

    rendered_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_notification_delivery_event
        FOREIGN KEY (notification_event_id)
        REFERENCES notification.event (notification_event_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notification_delivery_user
        FOREIGN KEY (user_id)
        REFERENCES public."user" (user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notification_delivery_channel
        FOREIGN KEY (channel_id)
        REFERENCES notification.channel (channel_id),

    CONSTRAINT fk_notification_delivery_template
        FOREIGN KEY (notification_template_id)
        REFERENCES notification.template (notification_template_id),

    CONSTRAINT ux_notification_delivery_event_user_channel
        UNIQUE (notification_event_id, user_id, channel_id),

    CONSTRAINT chk_notification_delivery_status
        CHECK (delivery_status IN (
            'pending',
            'processing',
            'sent',
            'retry',
            'failed',
            'cancelled',
            'suppressed'
        )),

    CONSTRAINT chk_notification_delivery_attempts
        CHECK (
            attempt_count >= 0
            AND max_attempts > 0
            AND attempt_count <= max_attempts
        ),

    CONSTRAINT chk_notification_delivery_priority
        CHECK (priority BETWEEN 0 AND 1000),

    CONSTRAINT chk_notification_delivery_sent_at
        CHECK (
            (delivery_status = 'sent' AND sent_at IS NOT NULL)
            OR delivery_status <> 'sent'
        ),

    CONSTRAINT chk_notification_delivery_failed_at
        CHECK (
            (delivery_status = 'failed' AND failed_at IS NOT NULL)
            OR delivery_status <> 'failed'
        ),

    CONSTRAINT chk_notification_delivery_rendered_payload_object
        CHECK (jsonb_typeof(rendered_payload) = 'object')
);

COMMENT ON TABLE notification.delivery IS
'Универсальная очередь и ledger доставки уведомлений. Одна строка = одно сообщение одному пользователю через один канал.';

COMMENT ON COLUMN notification.delivery.recipient_address IS
'Snapshot адреса получателя на момент постановки в очередь. Для Telegram — external.public_user.system_user_id при system_id=1.';

CREATE INDEX IF NOT EXISTS ix_notification_delivery_ready
    ON notification.delivery (priority DESC, next_attempt_at, created_at, notification_delivery_id)
    WHERE delivery_status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS ix_notification_delivery_processing_locked
    ON notification.delivery (locked_at)
    WHERE delivery_status = 'processing';

CREATE INDEX IF NOT EXISTS ix_notification_delivery_user_created
    ON notification.delivery (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_delivery_event
    ON notification.delivery (notification_event_id);

CREATE INDEX IF NOT EXISTS ix_notification_delivery_status_updated
    ON notification.delivery (delivery_status, updated_at);

-- ---------------------------------------------------------
-- 2.7 notification.delivery_attempt
-- Optional but useful operational audit.
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification.delivery_attempt (
    notification_delivery_attempt_id  bigserial PRIMARY KEY,

    notification_delivery_id          bigint NOT NULL,
    attempt_no                        integer NOT NULL,

    started_at                        timestamptz NOT NULL DEFAULT now(),
    finished_at                       timestamptz NULL,

    outcome                           varchar(32) NOT NULL,

    provider_message_id               varchar(128) NULL,

    error_code                        varchar(128) NULL,
    error_message                     text NULL,
    provider_response                 jsonb NULL,

    created_at                        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_notification_delivery_attempt_delivery
        FOREIGN KEY (notification_delivery_id)
        REFERENCES notification.delivery (notification_delivery_id)
        ON DELETE CASCADE,

    CONSTRAINT ux_notification_delivery_attempt_no
        UNIQUE (notification_delivery_id, attempt_no),

    CONSTRAINT chk_notification_delivery_attempt_outcome
        CHECK (outcome IN ('sent', 'retry', 'failed', 'cancelled', 'suppressed')),

    CONSTRAINT chk_notification_delivery_attempt_provider_response_object
        CHECK (provider_response IS NULL OR jsonb_typeof(provider_response) = 'object')
);

COMMENT ON TABLE notification.delivery_attempt IS
'История попыток доставки конкретного notification.delivery.';

CREATE INDEX IF NOT EXISTS ix_notification_delivery_attempt_delivery_started
    ON notification.delivery_attempt (notification_delivery_id, started_at DESC);

-- =========================================================
-- 3. Match domain tables
-- =========================================================

-- ---------------------------------------------------------
-- 3.1 public.match_follow
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.match_follow (
    match_follow_id      bigserial PRIMARY KEY,

    user_id              integer NOT NULL,
    match_id             integer NOT NULL,

    follow_status        varchar(32) NOT NULL DEFAULT 'active',

    settings             jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),

    unfollowed_at        timestamptz NULL,
    completed_at         timestamptz NULL,

    CONSTRAINT fk_match_follow_user
        FOREIGN KEY (user_id)
        REFERENCES public."user" (user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_match_follow_match
        FOREIGN KEY (match_id)
        REFERENCES public."match" (match_id)
        ON DELETE CASCADE,

    CONSTRAINT ux_match_follow_user_match
        UNIQUE (user_id, match_id),

    CONSTRAINT chk_match_follow_status
        CHECK (follow_status IN ('active', 'cancelled', 'completed', 'paused')),

    CONSTRAINT chk_match_follow_settings_object
        CHECK (jsonb_typeof(settings) = 'object')
);

COMMENT ON TABLE public.match_follow IS
'Предметная подписка пользователя на отслеживание конкретного матча. Не является очередью доставки.';

COMMENT ON COLUMN public.match_follow.settings IS
'Будущие настройки подписки на матч: какие события получать, порог движения коэффициента и т.д. В MVP может быть пустым.';

CREATE INDEX IF NOT EXISTS ix_match_follow_active_match_user
    ON public.match_follow (match_id, user_id)
    WHERE follow_status = 'active';

CREATE INDEX IF NOT EXISTS ix_match_follow_active_user_created
    ON public.match_follow (user_id, created_at DESC)
    WHERE follow_status = 'active';

CREATE INDEX IF NOT EXISTS ix_match_follow_user_status_created
    ON public.match_follow (user_id, follow_status, created_at DESC);

-- ---------------------------------------------------------
-- 3.2 public.match_event
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.match_event (
    match_event_id           bigserial PRIMARY KEY,

    match_id                 integer NOT NULL,

    provider_code            varchar(64) NOT NULL DEFAULT 'sstats',
    provider_event_key       varchar(256) NOT NULL,

    event_kind               varchar(64) NOT NULL,

    occurred_at              timestamptz NOT NULL,
    detected_at              timestamptz NOT NULL DEFAULT now(),

    minute                   smallint NULL,

    subject_team_id          varchar(128) NULL,

    score_home               smallint NULL,
    score_away               smallint NULL,

    match_status_id          integer NULL,

    data                     jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_match_event_match
        FOREIGN KEY (match_id)
        REFERENCES public."match" (match_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_match_event_match_status
        FOREIGN KEY (match_status_id)
        REFERENCES public.match_status (match_status_id),

    CONSTRAINT ux_match_event_provider_key
        UNIQUE (provider_code, provider_event_key),

    CONSTRAINT chk_match_event_kind
        CHECK (event_kind IN (
            'started',
            'score_changed',
            'goal',
            'red_card',
            'halftime',
            'finished',
            'cancelled',
            'postponed',
            'odds_changed'
        )),

    CONSTRAINT chk_match_event_minute
        CHECK (minute IS NULL OR minute BETWEEN 0 AND 130),

    CONSTRAINT chk_match_event_score_home
        CHECK (score_home IS NULL OR score_home >= 0),

    CONSTRAINT chk_match_event_score_away
        CHECK (score_away IS NULL OR score_away >= 0),

    CONSTRAINT chk_match_event_data_object
        CHECK (jsonb_typeof(data) = 'object')
);

COMMENT ON TABLE public.match_event IS
'Предметные события матча: старт, изменение счёта, гол, финал и т.д. Существуют независимо от подписчиков.';

COMMENT ON COLUMN public.match_event.provider_event_key IS
'Идемпотентный ключ события у провайдера или сформированный ключ: match:<id>:score:1:0.';

CREATE INDEX IF NOT EXISTS ix_match_event_match_occurred
    ON public.match_event (match_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_match_event_match_kind
    ON public.match_event (match_id, event_kind);

CREATE INDEX IF NOT EXISTS ix_match_event_match_status
    ON public.match_event (match_status_id)
    WHERE match_status_id IS NOT NULL;

-- =========================================================
-- 4. Useful views
-- =========================================================

CREATE OR REPLACE VIEW public.v_match_follow_active_sstats_matches AS
SELECT DISTINCT
    mf.match_id,
    epm.system_match_id AS sstats_match_id,
    epm.system_match_slug AS sstats_match_slug
FROM public.match_follow mf
JOIN external.public_match epm
    ON epm.match_id = mf.match_id
   AND epm.system_id = 3
WHERE mf.follow_status = 'active';

COMMENT ON VIEW public.v_match_follow_active_sstats_matches IS
'Активно отслеживаемые матчи с SStats id для worker polling.';

CREATE OR REPLACE VIEW public.v_match_follow_active_recipients AS
SELECT
    mf.match_follow_id,
    mf.user_id,
    mf.match_id,
    epu.system_user_id AS telegram_user_id
FROM public.match_follow mf
JOIN external.public_user epu
    ON epu.user_id = mf.user_id
   AND epu.system_id = 1
WHERE mf.follow_status = 'active';

COMMENT ON VIEW public.v_match_follow_active_recipients IS
'Активные подписчики матчей с Telegram recipient id.';

-- =========================================================
-- 5. updated_at trigger helper
-- =========================================================

CREATE OR REPLACE FUNCTION notification.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_channel_updated_at ON notification.channel;
CREATE TRIGGER trg_notification_channel_updated_at
BEFORE UPDATE ON notification.channel
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_type_updated_at ON notification.type;
CREATE TRIGGER trg_notification_type_updated_at
BEFORE UPDATE ON notification.type
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_preference_updated_at ON notification.preference;
CREATE TRIGGER trg_notification_preference_updated_at
BEFORE UPDATE ON notification.preference
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_template_updated_at ON notification.template;
CREATE TRIGGER trg_notification_template_updated_at
BEFORE UPDATE ON notification.template
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_delivery_updated_at ON notification.delivery;
CREATE TRIGGER trg_notification_delivery_updated_at
BEFORE UPDATE ON notification.delivery
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_match_follow_updated_at ON public.match_follow;
CREATE TRIGGER trg_match_follow_updated_at
BEFORE UPDATE ON public.match_follow
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

DROP TRIGGER IF EXISTS trg_external_public_match_status_updated_at ON external.public_match_status;
CREATE TRIGGER trg_external_public_match_status_updated_at
BEFORE UPDATE ON external.public_match_status
FOR EACH ROW
EXECUTE FUNCTION notification.set_updated_at();

COMMIT;
