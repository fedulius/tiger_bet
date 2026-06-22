# План внедрения JWT в tiger_bet

Дата: 2026-04-24
Проект: `/home/fedulov/tiger_bet`
Backend: Node.js + Fastify
Frontend: Telegram WebApp, React/Vite (`webapp-react`), публичный путь `/webapp`
Текущая авторизация: frontend передает Telegram initData в заголовке `x-telegram-init-data`
Целевая авторизация: backend проверяет Telegram initData один раз, выпускает JWT, далее API работает через `Authorization: Bearer <jwt>`

## 1. Цель внедрения

Цель — убрать постоянную передачу и ручной разбор Telegram initData/userId в каждом запросе к backend.

Сейчас в проекте уже есть зачатки схемы:

- frontend читает Telegram initData в `webapp-react/src/lib/telegram.js`;
- frontend добавляет заголовок `x-telegram-init-data` в `webapp-react/src/lib/api.js`;
- backend местами пытается читать `x-telegram-init-data`, например `/user`;
- в `server/app.js` есть `tryExtractTelegramUserId`, но это только небезопасный парсинг без проверки подписи;
- полноценного `/auth/telegram` и JWT middleware пока нет.

После внедрения:

1. Frontend отправляет `x-telegram-init-data` только на endpoint авторизации.
2. Backend проверяет подпись Telegram initData.
3. Backend проверяет, что Telegram user_id есть в пуле оплативших/разрешенных.
4. Backend выпускает JWT.
5. Frontend кладет JWT в runtime state.
6. Все дальнейшие запросы идут с заголовком:

```http
Authorization: Bearer <access_token>
```

7. Backend кладет текущего пользователя в:

```js
request.user
```

8. Роуты `/recommendations`, `/history`, `/favorites`, `/match/:id`, `/user` больше не разбирают Telegram initData сами.

## 2. Текущие endpoints tiger_bet

Роуты автозагружаются из:

```text
webapp/routes
```

через:

```js
fastify.register(require('@fastify/autoload'), {
  dir: path.join(__dirname, '..', 'webapp', 'routes'),
});
```

Из-за структуры файлов сейчас существуют короткие routes и alias routes под `/api/webapp/*`.

### 2.1. Публичные web routes

Эти endpoints должны остаться публичными:

```text
GET /health
GET /webapp
GET /webapp/
GET /webapp/match.html
GET /webapp/*
```

Назначение:

- `/health` — healthcheck;
- `/webapp` и `/webapp/*` — выдача React SPA из `webapp-react/dist`;
- `/webapp/match.html` — compatibility route для старых ссылок.

JWT на эти endpoints не нужен.

### 2.2. Текущие API endpoints

Основные короткие routes, которые сейчас использует React frontend:

```text
GET /user
GET /recommendations
GET /history
GET /favorites
PUT /favorites
DELETE /favorites
GET /match/:id
```

Alias routes, которые существуют через `webapp/routes/api/webapp/*`:

```text
GET /api/webapp/recommendations
GET /api/webapp/history
GET /api/webapp/favorites
PUT /api/webapp/favorites
DELETE /api/webapp/favorites
GET /api/webapp/match/:id
```

Рекомендация: оставить короткие routes для совместимости с текущим frontend, но целевым публичным API считать `/api/webapp/*`.

То есть на будущее frontend лучше перевести с:

```text
/recommendations
/history
/favorites
/match/:id
/user
```

на:

```text
/api/webapp/recommendations
/api/webapp/history
/api/webapp/favorites
/api/webapp/match/:id
/api/webapp/auth/me
```

## 3. Целевые auth endpoints для tiger_bet

Добавить новый модуль:

```text
webapp/routes/api/webapp/auth/index.js
```

И, если нужна короткая совместимость:

```text
webapp/routes/auth/index.js
```

Но предпочтительный целевой контракт — через `/api/webapp/auth/*`.

### 3.1. POST /api/webapp/auth/telegram

Назначение: обмен Telegram WebApp initData на JWT.

Request headers:

```http
content-type: application/json
```

Request body:

```json
{
  "initData": "query_id=...&user=...&auth_date=...&hash=..."
}
```

Допустимый fallback на этапе миграции:

```http
x-telegram-init-data: query_id=...&user=...&auth_date=...&hash=...
```

Если body пустой, backend может взять initData из header. Но целевой вариант — body.

Success 200:

```json
{
  "access_token": "jwt...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "id": 123,
    "telegram_user_id": 337412226,
    "username": "fedul",
    "first_name": "...",
    "last_name": "...",
    "role": "user",
    "subscription_status": "active"
  }
}
```

401, если initData отсутствует или подпись неверная:

```json
{
  "error": "unauthorized",
  "message": "Telegram initData не передан или не прошел проверку подписи"
}
```

403, если пользователь не оплатил/не разрешен:

```json
{
  "error": "forbidden",
  "message": "Нет доступа к Tiger Bet WebApp"
}
```

### 3.2. GET /api/webapp/auth/me

Назначение: получить текущего пользователя по JWT.

Request headers:

```http
Authorization: Bearer <access_token>
```

Success 200:

```json
{
  "user": {
    "id": 123,
    "telegram_user_id": 337412226,
    "username": "fedul",
    "first_name": "...",
    "last_name": "...",
    "role": "user",
    "subscription_status": "active"
  }
}
```

401:

```json
{
  "error": "unauthorized",
  "message": "Необходима авторизация"
}
```

403:

```json
{
  "error": "forbidden",
  "message": "Доступ пользователя отозван или подписка истекла"
}
```

### 3.3. Deprecated GET /user

Текущий endpoint:

```text
GET /user
```

Сейчас он читает `x-telegram-init-data` и возвращает 401, если user id не извлечен. В целевой схеме он должен стать alias для `/api/webapp/auth/me`.

Целевой контракт:

```text
GET /user
Authorization: Bearer <access_token>
```

Response — тот же, что у `/api/webapp/auth/me`.

На миграции можно временно поддержать оба варианта:

1. если есть `Authorization`, использовать JWT;
2. если JWT нет, но есть `x-telegram-init-data`, проверить initData полноценно, выпустить warning в лог и вернуть user;
3. после миграции убрать fallback по `x-telegram-init-data`.

## 4. Целевые бизнес endpoints tiger_bet

### 4.1. GET /api/webapp/recommendations

Текущий короткий route:

```text
GET /recommendations
```

Текущий alias:

```text
GET /api/webapp/recommendations
```

Целевой статус: защищенный JWT endpoint.

Request:

```http
GET /api/webapp/recommendations
Authorization: Bearer <access_token>
```

Query parameters:

```text
category_id? number, optional
sport? string, optional на будущее
```

MVP может оставить без query parameters.

Success 200:

```json
{
  "items": [
    {
      "id": "stavka-match-slug-or-fallback-1",
      "match": "Arsenal vs Chelsea",
      "league": "Premier League",
      "starts_at": "2026-04-22T17:30:00.000Z",
      "main_thought": "Обе забьют, но Arsenal выглядит сильнее",
      "confidence": 68,
      "source_url": "https://stavka.tv/matches/...",
      "is_new": true
    }
  ],
  "source": "stavka-live",
  "updated_at": "2026-04-24T20:00:00.000Z"
}
```

Допустимые `source`:

```text
stavka-live
fallback-top
```

Auth usage:

```js
const user = request.user;
```

На первом этапе `request.user` может использоваться только для проверки доступа и логирования. На следующем этапе — для персонализации рекомендаций по избранным видам спорта/лигам.

Короткий route `/recommendations` оставить как совместимый alias, но тоже закрыть JWT.

### 4.2. GET /api/webapp/history

Текущий короткий route:

```text
GET /history
```

Текущий alias:

```text
GET /api/webapp/history
```

Целевой статус: защищенный JWT endpoint.

Request:

```http
GET /api/webapp/history
Authorization: Bearer <access_token>
```

Query parameters:

```text
sample? 1|0, только для dev/test, в production лучше убрать
limit? number, optional на будущее
cursor? string, optional на будущее
```

Success 200, если истории нет:

```json
{
  "items": [],
  "empty_state": {
    "message": "Здесь появятся ваши последние прогнозы",
    "cta": {
      "label": "Открыть рекомендации",
      "target": "#recommendations"
    }
  },
  "updated_at": "2026-04-24T20:00:00.000Z"
}
```

Success 200, если история есть:

```json
{
  "items": [
    {
      "id": "history-1",
      "match": "Arsenal vs Chelsea",
      "league": "Premier League",
      "starts_at": "2026-04-22T17:30:00.000Z",
      "main_thought": "Победа Arsenal",
      "confidence": 68,
      "source_url": "https://stavka.tv/matches/...",
      "viewed_at": "2026-04-24T20:00:00.000Z"
    }
  ],
  "empty_state": null,
  "updated_at": "2026-04-24T20:00:00.000Z"
}
```

Auth usage:

```js
const telegramUserId = request.user.telegram_user_id;
```

История должна быть персональной. Нельзя возвращать общую историю всем пользователям, кроме временного fallback в MVP.

### 4.3. GET /api/webapp/favorites

Текущий короткий route:

```text
GET /favorites
```

Текущий alias:

```text
GET /api/webapp/favorites
```

Целевой статус: защищенный JWT endpoint.

Request:

```http
GET /api/webapp/favorites
Authorization: Bearer <access_token>
```

Success 200:

```json
{
  "sports": ["football", "tennis"],
  "leagues": ["Premier League", "ATP"],
  "profile": "telegram:337412226"
}
```

Важно: текущий сервис `favoritesStore.js` хранит только `guest` профиль в JSON-файле. После JWT нужно заменить `guest` на пользовательский ключ:

```text
telegram:<telegram_user_id>
```

или лучше хранить в PostgreSQL.

Для быстрого MVP можно оставить JSON-файл, но сделать профиль не `guest`, а per-user:

```js
const profile = `telegram:${request.user.telegram_user_id}`;
```

### 4.4. PUT /api/webapp/favorites

Текущий короткий route:

```text
PUT /favorites
```

Текущий alias:

```text
PUT /api/webapp/favorites
```

Целевой статус: защищенный JWT endpoint.

Request:

```http
PUT /api/webapp/favorites
Authorization: Bearer <access_token>
content-type: application/json
```

Request body:

```json
{
  "sports": ["football", "tennis"],
  "leagues": ["Premier League", "ATP"]
}
```

Validation:

- `sports` обязателен;
- `sports` должен быть массивом строк;
- `leagues` обязателен;
- `leagues` должен быть массивом строк;
- пустые строки удаляются;
- дубли удаляются;
- `telegram_user_id`, `user_id`, `profile` из body запрещены.

Success 200:

```json
{
  "sports": ["football", "tennis"],
  "leagues": ["Premier League", "ATP"],
  "profile": "telegram:337412226"
}
```

400:

```json
{
  "error": "sports and leagues must be arrays"
}
```

400 при попытке передать пользователя руками:

```json
{
  "error": "invalid_payload",
  "message": "Поля user_id, telegram_user_id и profile запрещены. Пользователь определяется через JWT."
}
```

### 4.5. DELETE /api/webapp/favorites

Текущий короткий route:

```text
DELETE /favorites
```

Текущий alias:

```text
DELETE /api/webapp/favorites
```

Сейчас route просто возвращает `1`.

Целевой статус: защищенный JWT endpoint.

Request:

```http
DELETE /api/webapp/favorites
Authorization: Bearer <access_token>
```

Success 200:

```json
{
  "sports": [],
  "leagues": [],
  "profile": "telegram:337412226"
}
```

Логика:

- удалить/очистить избранное только текущего пользователя;
- не трогать чужое избранное;
- не принимать `profile` из body/query.

### 4.6. GET /api/webapp/match/:id

Текущий короткий route:

```text
GET /match/:id
```

Текущий alias:

```text
GET /api/webapp/match/:id
```

Целевой статус: защищенный JWT endpoint.

Request:

```http
GET /api/webapp/match/fallback-1
Authorization: Bearer <access_token>
```

Path params:

```json
{
  "id": "fallback-1"
}
```

Success 200:

```json
{
  "id": "fallback-1",
  "match": "Arsenal vs Chelsea",
  "league": "Premier League",
  "starts_at": "2026-04-22T17:30:00.000Z",
  "main_thought": "Обе забьют, но Arsenal выглядит сильнее",
  "confidence": 68,
  "basis": "Последние 5 матчей, xG-тренд и преимущество домашнего поля Arsenal.",
  "source_url": "https://stavka.tv/matches/..."
}
```

404:

```json
{
  "error": "Match not found"
}
```

Auth usage:

- проверить, что пользователь имеет доступ к WebApp;
- на следующем этапе можно писать просмотр в историю текущего пользователя.

## 5. JWT payload для tiger_bet

Минимальный payload:

```json
{
  "sub": "123",
  "telegram_user_id": 337412226,
  "role": "user",
  "iat": 1710000000,
  "exp": 1710086400
}
```

Где:

- `sub` — внутренний id пользователя в БД tiger_bet;
- `telegram_user_id` — Telegram user id, не chat_id;
- `role` — `user` или `admin`;
- `iat` — время выпуска;
- `exp` — время истечения.

Не класть в JWT:

- `TELEGRAM_BOT_TOKEN`;
- OpenRouter/API keys;
- Redis/Postgres credentials;
- список всех избранных лиг;
- полную историю прогнозов;
- флаг оплаты как единственный источник истины, если доступ может быть отозван.

JWT нужен для идентификации. Актуальный доступ лучше проверять в БД/Redis.

## 6. Рекомендуемые схемы данных PostgreSQL

В проекте уже используется PostgreSQL через:

```text
DataBase/Postgres.js
```

и SQL-функции/таблицы вида:

```text
public.user_sync(...)
public.user_logger(...)
public.sport_category
public.prediction_category
public.favorite_sport
```

JWT-авторизацию лучше добавить поверх существующей схемы, не ломая bot-часть.

### 6.1. tg_users / webapp_users

Если уже есть таблица пользователей под `public.user_sync`, лучше использовать существующую. Если нужна отдельная таблица для WebApp, рекомендуемая схема:

```sql
CREATE TABLE IF NOT EXISTS public.webapp_user (
  webapp_user_id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  language_code text,
  role text NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
```

### 6.2. webapp_access

Пул оплативших/разрешенных пользователей:

```sql
CREATE TABLE IF NOT EXISTS public.webapp_access (
  telegram_user_id bigint PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  paid_until timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Правила:

- `status='active'` — доступ разрешен;
- `status='blocked'` — доступ запрещен;
- `paid_until IS NULL` — бессрочный доступ;
- `paid_until > now()` — доступ активен;
- `paid_until <= now()` — доступ истек.

### 6.3. webapp_favorite

Если уходим от JSON-файла `webapp/data/favorites.json`, лучше хранить избранное в PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS public.webapp_favorite (
  webapp_favorite_id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES public.webapp_user(telegram_user_id) ON DELETE CASCADE,
  sports text[] NOT NULL DEFAULT '{}',
  leagues text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id)
);
```

MVP-вариант без миграции на PostgreSQL:

- оставить `WEBAPP_FAVORITES_FILE`;
- хранить профили по ключу `telegram:<telegram_user_id>` вместо `guest`.

Пример JSON:

```json
{
  "telegram:337412226": {
    "sports": ["football"],
    "leagues": ["Premier League"]
  }
}
```

### 6.4. webapp_prediction_history

Для будущей персональной истории прогнозов:

```sql
CREATE TABLE IF NOT EXISTS public.webapp_prediction_history (
  webapp_prediction_history_id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES public.webapp_user(telegram_user_id) ON DELETE CASCADE,
  match_id text NOT NULL,
  match text NOT NULL,
  league text,
  starts_at timestamptz,
  main_thought text,
  confidence integer,
  source_url text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
```

Для MVP `GET /history` может оставаться fallback/empty-state, но контракт уже должен быть персональным по `request.user.telegram_user_id`.

## 7. Env-конфигурация tiger_bet

Добавить в `.env`/runtime окружение:

```env
JWT_SECRET=replace_with_64_random_chars
JWT_EXPIRES_IN=24h
TELEGRAM_BOT_TOKEN=123456:ABC...
WEBAPP_AUTH_REQUIRED=1
WEBAPP_AUTH_INITDATA_MAX_AGE_SECONDS=86400
```

Опционально:

```env
WEBAPP_AUTH_ALLOW_INITDATA_FALLBACK=1
WEBAPP_AUTH_ALLOW_GUEST=0
WEBAPP_FAVORITES_STORE=postgres
```

Пояснения:

- `JWT_SECRET` — только backend, не коммитить;
- `JWT_EXPIRES_IN=24h` достаточно для MVP;
- `TELEGRAM_BOT_TOKEN` уже нужен для бота, но для проверки initData его тоже использует backend;
- `WEBAPP_AUTH_REQUIRED=1` включает обязательный JWT на API;
- `WEBAPP_AUTH_INITDATA_MAX_AGE_SECONDS=86400` ограничивает возраст Telegram initData;
- `WEBAPP_AUTH_ALLOW_INITDATA_FALLBACK=1` временно разрешает старую схему `x-telegram-init-data` на бизнес-endpoints;
- после миграции fallback выключить.

## 8. Файлы, которые нужно добавить

### 8.1. Auth services

```text
webapp/services/auth/jwtService.js
webapp/services/auth/telegramInitData.js
webapp/services/auth/accessService.js
webapp/services/auth/userService.js
webapp/services/auth/authMiddleware.js
```

Назначение:

- `jwtService.js` — `createAccessToken`, `verifyAccessToken`;
- `telegramInitData.js` — проверка подписи Telegram initData;
- `accessService.js` — проверка оплаты/доступа;
- `userService.js` — создание/обновление webapp user;
- `authMiddleware.js` — Fastify preHandler/decorator для `request.user`.

### 8.2. Auth routes

```text
webapp/routes/api/webapp/auth/index.js
```

Опционально compatibility route:

```text
webapp/routes/auth/index.js
```

### 8.3. Тесты

```text
tests/webapp/auth-telegram.test.js
tests/webapp/auth-me.test.js
tests/webapp/protected-routes-auth.test.js
tests/webapp/favorites-user-scope.test.js
```

## 9. Файлы, которые нужно изменить

### 9.1. server/app.js

Сейчас там есть локальная функция:

```js
function tryExtractTelegramUserId(initDataRaw = '') { ... }
```

Ее нужно убрать из `server/app.js` или перенести в auth service, но не использовать как авторизацию.

Что изменить:

1. Зарегистрировать auth helpers/decorators до autoload routes.
2. Добавить `fastify.decorateRequest('user', null)`.
3. Добавить `fastify.decorate('auth', ...)` или подключить plugin.
4. Убрать `console.log(telegramUserId)` из `/webapp`.
5. Оставить `/webapp` публичным.

### 9.2. webapp-react/src/lib/telegram.js

Оставить функцию получения initData, но использовать ее только на этапе login.

Текущий `withTelegramInitDataHeaders` не должен применяться ко всем API-запросам после JWT-миграции.

Добавить/оставить:

```js
getTelegramInitData()
```

### 9.3. webapp-react/src/lib/api.js

Сейчас:

```js
headers: withTelegramInitDataHeaders()
```

Целевое состояние:

- добавить `loginWithTelegram()`;
- хранить access token в памяти;
- добавлять `Authorization: Bearer ...`;
- перевести endpoints на `/api/webapp/*`.

Целевые функции:

```js
loginWithTelegram()
getCurrentUser()
getRecommendations()
getHistory()
getFavorites()
setFavorites(payload)
deleteFavorites()
getMatchDetails(id)
```

Целевые URL:

```text
POST /api/webapp/auth/telegram
GET /api/webapp/auth/me
GET /api/webapp/recommendations
GET /api/webapp/history
GET /api/webapp/favorites
PUT /api/webapp/favorites
DELETE /api/webapp/favorites
GET /api/webapp/match/:id
```

### 9.4. webapp/routes/user/index.js

Сейчас route неполный: он проверяет Telegram initData, но не отправляет успешный ответ.

Целевое изменение:

- сделать `/user` alias на `/api/webapp/auth/me`;
- требовать JWT;
- вернуть `{ user }`.

### 9.5. webapp/routes/favorites/index.js

Сейчас есть проблема: используется `telegramUserId`, но переменная не определена в scope. Также экспортируется `tryExtractTelegramUserId`, которого в файле нет.

Целевое изменение:

- удалить ручной разбор Telegram initData;
- брать пользователя из `request.user`;
- хранить favorites per-user;
- закрыть `GET/PUT/DELETE /favorites` через auth middleware.

### 9.6. webapp/services/favoritesStore.js

Сейчас сервис работает только с `guest`.

Целевое изменение для MVP:

- добавить параметр `profile`;
- profile строить на route-уровне из `request.user.telegram_user_id`;
- не принимать profile из body.

Пример функций:

```js
getFavorites(profile)
saveFavorites(profile, input)
clearFavorites(profile)
```

### 9.7. webapp/routes/recommendations/index.js

Целевое изменение:

- добавить auth preHandler;
- оставить текущий response schema;
- использовать `request.user` для будущей персонализации.

### 9.8. webapp/routes/history/index.js

Целевое изменение:

- добавить auth preHandler;
- убрать/ограничить `sample=1` в production;
- в будущем читать историю по `request.user.telegram_user_id`.

### 9.9. webapp/routes/match/index.js

Целевое изменение:

- добавить auth preHandler;
- при успешном просмотре можно писать запись в историю пользователя.

## 10. Telegram initData verification

Алгоритм:

1. Принять raw initData string.
2. Распарсить через `URLSearchParams`.
3. Достать `hash`.
4. Удалить `hash` из набора.
5. Отсортировать пары по ключу.
6. Собрать `data_check_string` через `\n`.
7. Посчитать secret key:

```js
HMAC_SHA256('WebAppData', TELEGRAM_BOT_TOKEN)
```

8. Посчитать hash:

```js
HMAC_SHA256(data_check_string, secret_key)
```

9. Сравнить с Telegram hash через `crypto.timingSafeEqual`.
10. Проверить `auth_date`.
11. Распарсить `user`.
12. Вернуть нормализованного Telegram user.

Нормализованный Telegram user:

```json
{
  "telegram_user_id": 337412226,
  "username": "fedul",
  "first_name": "...",
  "last_name": "...",
  "language_code": "ru"
}
```

Важно: использовать именно Telegram user id, не chat id.

## 11. Auth middleware для Fastify

Целевой интерфейс:

```js
async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization || '';
  const token = extractBearerToken(authHeader);

  if (!token) {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Необходима авторизация',
    });
  }

  const claims = verifyAccessToken(token);
  const user = await getUserById(claims.sub);
  const access = await checkWebAppAccess(user.telegram_user_id);

  if (!access.allowed) {
    return reply.status(403).send({
      error: 'forbidden',
      message: 'Доступ пользователя отозван или подписка истекла',
    });
  }

  request.user = user;
}
```

Подключение к route:

```js
fastify.get('/', { preHandler: fastify.requireAuth }, async (request) => {
  return await getRecommendations({ user: request.user });
});
```

## 12. Auth matrix для tiger_bet endpoints

```text
GET  /health                         public
GET  /webapp                         public
GET  /webapp/*                       public
POST /api/webapp/auth/telegram       public
GET  /api/webapp/auth/me             JWT required
GET  /user                           JWT required, deprecated alias
GET  /recommendations                JWT required, compatibility alias
GET  /api/webapp/recommendations     JWT required
GET  /history                        JWT required, compatibility alias
GET  /api/webapp/history             JWT required
GET  /favorites                      JWT required, compatibility alias
PUT  /favorites                      JWT required, compatibility alias
DELETE /favorites                    JWT required, compatibility alias
GET  /api/webapp/favorites           JWT required
PUT  /api/webapp/favorites           JWT required
DELETE /api/webapp/favorites         JWT required
GET  /match/:id                      JWT required, compatibility alias
GET  /api/webapp/match/:id           JWT required
```

## 13. Ошибки API

Единый формат:

### 401 — нет токена

```json
{
  "error": "unauthorized",
  "message": "Необходима авторизация"
}
```

### 401 — token истек

```json
{
  "error": "token_expired",
  "message": "Сессия истекла, откройте приложение заново"
}
```

### 401 — Telegram initData невалиден

```json
{
  "error": "invalid_telegram_init_data",
  "message": "Telegram initData не прошел проверку подписи"
}
```

### 403 — доступ запрещен

```json
{
  "error": "forbidden",
  "message": "Нет доступа к Tiger Bet WebApp"
}
```

### 400 — запрещенные поля пользователя в payload

```json
{
  "error": "invalid_payload",
  "message": "Пользователь определяется через JWT. Не передавайте user_id, telegram_user_id или profile."
}
```

### 404 — матч не найден

```json
{
  "error": "Match not found"
}
```

## 14. Frontend flow

### 14.1. Startup

1. React App стартует на `/webapp`.
2. `getTelegramInitData()` читает:
   - `Telegram.WebApp.initData`, или
   - fallback `tgWebAppData` из hash/search.
3. `loginWithTelegram()` вызывает:

```http
POST /api/webapp/auth/telegram
```

4. Backend возвращает JWT.
5. Frontend сохраняет token в памяти.
6. Frontend вызывает:

```http
GET /api/webapp/auth/me
GET /api/webapp/recommendations
GET /api/webapp/history
GET /api/webapp/favorites
```

с `Authorization: Bearer`.

### 14.2. Token storage

Для MVP хранить token в памяти JS-приложения.

Не использовать `localStorage` на первом этапе, если можно избежать.

При перезагрузке WebApp повторно выполнять `/api/webapp/auth/telegram`.

## 15. Порядок внедрения

1. Добавить env-переменные `JWT_SECRET`, `JWT_EXPIRES_IN`, `WEBAPP_AUTH_REQUIRED`, `WEBAPP_AUTH_INITDATA_MAX_AGE_SECONDS`.
2. Добавить `webapp/services/auth/telegramInitData.js`.
3. Добавить тесты проверки Telegram initData.
4. Добавить `webapp/services/auth/jwtService.js`.
5. Добавить тесты JWT sign/verify/expired.
6. Добавить `webapp/services/auth/userService.js`.
7. Добавить `webapp/services/auth/accessService.js`.
8. Добавить route `POST /api/webapp/auth/telegram`.
9. Добавить route `GET /api/webapp/auth/me`.
10. Добавить Fastify auth middleware/decorator.
11. Закрыть JWT route `/api/webapp/recommendations` и alias `/recommendations`.
12. Закрыть JWT route `/api/webapp/history` и alias `/history`.
13. Переделать favoritesStore с `guest` на per-user profile.
14. Закрыть JWT `GET/PUT/DELETE /api/webapp/favorites` и alias `/favorites`.
15. Закрыть JWT `/api/webapp/match/:id` и alias `/match/:id`.
16. Переделать `/user` в alias `/api/webapp/auth/me`.
17. Обновить `webapp-react/src/lib/api.js`: login + Authorization header + `/api/webapp/*` URLs.
18. Оставить старый `x-telegram-init-data` fallback только на auth endpoint.
19. Убрать `x-telegram-init-data` из обычных API-запросов frontend.
20. Прогнать targeted tests.
21. Прогнать полный test suite.
22. Проверить `/webapp` через Caddy/production URL.
23. Выключить fallback на `x-telegram-init-data` для бизнес endpoints.

## 16. Тест-план

### 16.1. Auth tests

Добавить:

```text
tests/webapp/auth-telegram.test.js
tests/webapp/auth-me.test.js
```

Проверки:

1. `POST /api/webapp/auth/telegram` с валидным initData возвращает `access_token`.
2. Невалидный hash возвращает 401.
3. Старый `auth_date` возвращает 401.
4. Неоплаченный/неразрешенный пользователь возвращает 403.
5. `GET /api/webapp/auth/me` без token возвращает 401.
6. `GET /api/webapp/auth/me` с валидным token возвращает user.
7. Заблокированный пользователь с валидным token получает 403.

### 16.2. Protected route tests

Обновить существующие tests:

```text
tests/webapp/recommendations-api.test.js
tests/webapp/history-api.test.js
tests/webapp/favorites-api.test.js
tests/webapp/match-details-api.test.js
```

Добавить проверки:

1. Без `Authorization` endpoint возвращает 401.
2. С валидным JWT endpoint возвращает текущий успешный payload.
3. С истекшим JWT endpoint возвращает 401.
4. С пользователем без доступа endpoint возвращает 403.

### 16.3. Favorites per-user tests

Добавить:

1. Пользователь A сохраняет `sports=['football']`.
2. Пользователь B сохраняет `sports=['tennis']`.
3. `GET /favorites` пользователя A возвращает только football.
4. `GET /favorites` пользователя B возвращает только tennis.
5. Попытка передать `profile` в body возвращает 400.
6. Попытка передать `telegram_user_id` в body возвращает 400.

## 17. Команды проверки

Targeted backend tests:

```bash
cd /home/fedulov/tiger_bet
node --test tests/webapp/auth-telegram.test.js tests/webapp/auth-me.test.js
node --test tests/webapp/recommendations-api.test.js tests/webapp/history-api.test.js tests/webapp/favorites-api.test.js tests/webapp/match-details-api.test.js
```

Full tests:

```bash
cd /home/fedulov/tiger_bet
node --test tests/**/*.test.js
npm test
```

Frontend build:

```bash
cd /home/fedulov/tiger_bet/webapp-react
npm run build
```

Smoke checks на сервере:

```bash
curl -I http://127.0.0.1:8084/webapp
curl -s http://127.0.0.1:8084/health
curl -s http://127.0.0.1:8084/api/webapp/recommendations
```

После включения JWT последний запрос без token должен вернуть 401.

## 18. Production/Caddy нюансы

Для tiger_bet уже зафиксировано:

- публичный домен: `https://bet.twfed.com/webapp`;
- TLS/reverse proxy идет через Caddy в Docker (`n8n-caddy-1`);
- предпочтительная схема: Caddy завершает TLS, Node/Fastify работает в HTTP mode;
- backend должен слушать `0.0.0.0`, чтобы Caddy из Docker мог достучаться до host backend.

JWT не меняет публичный `/webapp` URL.

Меняются только API-вызовы внутри WebApp.

## 19. Что не делать

1. Не читать `window` на backend.
2. Не использовать Telegram chat_id вместо Telegram user id.
3. Не доверять распарсенному `user.id` без HMAC-проверки initData.
4. Не отправлять `telegram_user_id`, `user_id`, `profile` в business payload.
5. Не хранить JWT в git/logs.
6. Не логировать raw initData.
7. Не закрывать `/webapp` JWT middleware — это публичная SPA-страница.
8. Не ломать compatibility routes `/recommendations`, `/favorites`, `/history`, `/match/:id` до обновления frontend.
9. Не оставлять `favorites` глобальным `guest` после включения авторизации.
10. Не забывать, что `/api/webapp/*` и короткие routes должны иметь одинаковую auth-политику.

## 20. Итоговый контракт после внедрения

Frontend:

1. Один раз вызывает:

```text
POST /api/webapp/auth/telegram
```

2. Получает JWT.
3. Дальше вызывает:

```text
GET /api/webapp/auth/me
GET /api/webapp/recommendations
GET /api/webapp/history
GET /api/webapp/favorites
PUT /api/webapp/favorites
DELETE /api/webapp/favorites
GET /api/webapp/match/:id
```

с:

```http
Authorization: Bearer <access_token>
```

Backend:

1. Проверяет JWT в auth middleware.
2. Кладет пользователя в `request.user`.
3. Проверяет доступ/подписку.
4. Роуты работают только с `request.user`, а не с user id из body/header.

Главный результат: в tiger_bet появляется нормальный auth слой, а Telegram initData перестает быть «ручным userId, который надо тащить в каждый запрос».
