# Tiger Bet Feed MVP Implementation Plan

> **For Hermes:** use this as the execution plan for the new feed feature. Do not introduce `/api/webapp/*` aliases. Keep short routes. Before any `pm2 restart 0`, build frontend if it changed.

**Goal:** Добавить в Telegram WebApp отдельную ленту ставок как нижний tab: общий поток матчей на сегодня+завтра без прошедших, одна основная ставка на карточку, быстрая модалка без перехода в матч, догрузка чанками по 10 через versioned snapshot.

**Architecture:** Postgres остаётся источником долговременного каталога (`sport`, затем `country`/`league`), Redis используется как runtime-слой для versioned snapshot feed. Feed API отдаёт snapshot-версию и paginated items; React WebApp рендерит отдельный экран ленты с простыми фильтрами и chunk-loading. Архив витрин в этот MVP не входит.

**Tech Stack:** Node.js, Fastify, React/Vite, Redis, PostgreSQL, node:test.

---

## Product contract to implement

### Feed UX MVP
- отдельный нижний tab `Лента`
- поток общий для всех пользователей
- дефолтный диапазон: `сегодня + завтра`
- прошедшие матчи исключаются
- единый поток по `start_time asc`
- карточка содержит:
  - матч
  - время
  - спорт / страна / лига
  - одну основную ставку
  - коэффициент
  - короткий тезис
- tap по карточке открывает быструю модалку
- из ленты нет перехода в экран матча
- догрузка: по 10 элементов при достижении конца списка

### Filters MVP
- быстрые переключатели: `Все`, `Сегодня`, `Завтра`
- отдельный фильтр по спорту
- кнопка `Фильтры` открывает второй слой:
  - страна
  - лига

### Feed API contract MVP
`GET /feed?window=all|today|tomorrow&sport=...&country=...&league=...&limit=10&offset=0&feed_version=...`

Response shape:
```json
{
  "feed_version": "2026-06-23T17:00:00.000Z:abc123",
  "generated_at": "2026-06-23T17:00:01.000Z",
  "window": "all",
  "filters": {
    "sport": "Футбол",
    "country": "Англия",
    "league": "Premier League"
  },
  "items": [
    {
      "id": "stavka-123",
      "match_id": "stavka-123",
      "match": "Arsenal vs Chelsea",
      "sport": "Футбол",
      "country": "Англия",
      "league": "Premier League",
      "starts_at": "2026-06-23T18:30:00.000Z",
      "primary_bet": {
        "forecast": "П1",
        "coeff": 1.78,
        "description": "Арсенал стабильнее по форме и качеству моментов."
      },
      "summary": "Арсенал выглядит стабильнее по форме, у гостей потери в обороне."
    }
  ],
  "next_offset": 10,
  "has_more": true,
  "available_filters": {
    "sports": ["Футбол", "Теннис"],
    "countries": ["Англия", "Испания"],
    "leagues": ["Premier League", "La Liga"]
  }
}
```

---

## Phase 0. Preflight and boundaries

### Task 0.1: Freeze MVP scope in code-facing terms
**Objective:** Зафиксировать, что в эту итерацию не входят архив витрин, персонализация, лайки/дизлайки, переход в матч из ленты.

**Files:**
- Reference: `docs/plans/2026-06-23-tiger-bet-feed-mvp-plan.md`
- Reference: `webapp-react/src/App.jsx`
- Reference: `webapp/services/recommendationService.js`

**Steps:**
1. Использовать этот план как единственный source of scope.
2. Не добавлять в API и UI поля/кнопки для будущих архивов витрин.
3. Не трогать существующий экран `MatchPage` без прямой необходимости.

**Verification:** План остаётся согласованным с продуктовым решением из second-brain.

---

## Phase 1. Backend feed domain and snapshot service

### Task 1.1: Introduce feed service module skeleton
**Objective:** Создать отдельный сервис feed, не смешивая его с текущим `recommendationService`.

**Files:**
- Create: `webapp/services/feedService.js`
- Reference: `webapp/services/recommendationService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Вынести в новый сервис:
  - фильтрацию по окну today/tomorrow/all
  - исключение прошедших матчей
  - сортировку по времени
  - нормализацию primary-bet item shape
- Не тащить в первую версию runtime-зависимости UI.

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet && node --test tests/webapp/feed-service.test.js'
```

### Task 1.2: Define feed item normalization
**Objective:** Зафиксировать shape feed item, чтобы и API, и frontend работали на одном контракте.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- На вход принимать матч/рекомендацию из существующего recommendation pipeline.
- На выходе feed item должен включать:
  - `id`
  - `match_id`
  - `match`
  - `sport`
  - `country`
  - `league`
  - `starts_at`
  - `summary`
  - `primary_bet { forecast, coeff, description }`
- Если нет валидной основной ставки или стартового времени, item отбрасывать.

**Verification:** unit tests на happy path и skip invalid item.

### Task 1.3: Add time-window filtering logic
**Objective:** Реализовать правила `today`, `tomorrow`, `all(today+tomorrow)` и исключение уже прошедших матчей.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Опорная timezone для бизнес-логики: московское время.
- `all` = `today + tomorrow`
- `today` = только оставшиеся матчи текущего дня
- `tomorrow` = матчи завтрашнего дня
- всё, что `start_time < now`, исключать

**Verification:** tests на границы даты и уже прошедшие матчи.

### Task 1.4: Add sport/country/league filtering hooks
**Objective:** Подготовить серверную фильтрацию поверх общего feed snapshot.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Фильтры опциональны.
- Сравнения делать по нормализованному строковому key.
- Не кэшировать каждую комбинацию фильтров отдельным snapshot: фильтрация идёт поверх общего snapshot списка.

**Verification:** tests на каждый фильтр отдельно и их совместное применение.

### Task 1.5: Add versioned snapshot cache primitives
**Objective:** Создать в feed service runtime-механику snapshot version + current pointer + rebuild lock.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Ключи Redis вида:
  - `feed:current_version`
  - `feed:snapshot:{version}:items`
  - `feed:snapshot:{version}:meta`
  - `feed:rebuild_lock`
- Snapshot immutable после публикации.
- Новый snapshot публиковать только после полной сборки.
- Если Redis недоступен, разрешить graceful fallback в memory для dev/test.

**Verification:** tests/mocks на publish + read current version.

### Task 1.6: Add paginated read API over a fixed snapshot
**Objective:** Отдавать `limit/offset` чанки из конкретной версии snapshot.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Первый запрос без `feed_version` получает current version.
- Следующие запросы с `feed_version` читают ту же версию.
- Ответ должен включать `next_offset`, `has_more`, `feed_version`.
- Если версия устарела или отсутствует, вернуть controlled response для soft reload.

**Verification:** tests на pagination `0 -> 10 -> 20`, конец списка, missing version.

---

## Phase 2. Backend route and feed metadata

### Task 2.1: Add feed route
**Objective:** Добавить новый короткий route `/feed` под JWT.

**Files:**
- Create: `webapp/routes/feed/index.js`
- Modify: `server/app.js` (only if route registration behavior requires it)
- Test: `tests/webapp/feed-api.test.js`

**Implementation notes:**
- Route должен жить в short-routes стиле проекта.
- JWT обязателен так же, как для `/recommendations`.
- Поддержать query params:
  - `window`
  - `sport`
  - `country`
  - `league`
  - `limit`
  - `offset`
  - `feed_version`

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet && node --test tests/webapp/feed-api.test.js'
```

### Task 2.2: Return available filter metadata
**Objective:** Вместе с feed выдавать доступные значения фильтров для UI.

**Files:**
- Modify: `webapp/routes/feed/index.js`
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-api.test.js`

**Implementation notes:**
- В MVP можно строить метаданные из текущего snapshot.
- Shape:
  - `available_filters.sports`
  - `available_filters.countries`
  - `available_filters.leagues`
- Порядок должен быть детерминированным.

**Verification:** API tests на содержимое metadata.

### Task 2.3: Add snapshot refresh entry point
**Objective:** Подготовить явный метод пересборки feed snapshot для последующего cron/event wiring.

**Files:**
- Modify: `webapp/services/feedService.js`
- Optionally create: `webapp/services/feedSnapshotRefresh.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- Экспортировать функцию вроде `refreshFeedSnapshot()`.
- В этом MVP можно вызывать её по lazy path при первом запросе + по TTL.
- Событийный rebuild пока проектировать интерфейсно, без полного orchestration слоя.

**Verification:** tests на initial build и no-double-rebuild under lock.

---

## Phase 3. Catalog groundwork for country/league

### Task 3.1: Design DB-backed catalog boundary
**Objective:** Не внедряя ещё полный мировой каталог, отделить runtime feed от временных строковых полей.

**Files:**
- Modify: `webapp/services/feedService.js`
- Reference: `webapp/services/sportLeaguesCatalog.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- На первом шаге разрешить fallback на строки, приходящие из источника.
- Но internal shape feed item должен уже иметь поля `sport`, `country`, `league` как отдельные сущности/атрибуты.
- Не блокировать MVP отсутствием полной DB-миграции каталога стран/лиг.

**Verification:** feed работает даже если `country` частично заполняется эвристикой/источником.

### Task 3.2: Prepare follow-up migration notes for `country` and `league`
**Objective:** Зафиксировать точки расширения для следующей итерации DB catalog.

**Files:**
- Modify: `docs/plans/2026-06-23-tiger-bet-feed-mvp-plan.md`
- Optional create later: `docs/plans/2026-06-23-tiger-bet-feed-catalog-db-plan.md`

**Implementation notes:**
- В этом MVP не делать тяжёлую миграцию “все лиги мира”.
- Зафиксировать следующий шаг:
  - `country`
  - `league`
  - связь `league -> sport, country`

**Verification:** Plan notes updated; implementation scope unchanged.

---

## Phase 4. Frontend navigation and feed page

### Task 4.1: Introduce tab-based app shell
**Objective:** Добавить нижнюю навигацию с отдельным tab для feed.

**Files:**
- Modify: `webapp-react/src/App.jsx`
- Create: `webapp-react/src/components/WebAppTabs.jsx`
- Modify: `webapp-react/src/styles/app.css`
- Test: `tests/webapp/server-smoke.test.js` (route availability only if relevant)

**Implementation notes:**
- Не ломать текущую `RecommendationsPage`.
- Новый shell должен уметь показывать минимум два tab:
  - `Рекомендации`
  - `Лента`
- Использовать React Router routes, а не условные render-флаги в одном компоненте.

**Verification:** frontend build passes.

### Task 4.2: Add feed page component
**Objective:** Создать отдельный экран ленты.

**Files:**
- Create: `webapp-react/src/pages/FeedPage.jsx`
- Modify: `webapp-react/src/App.jsx`
- Modify: `webapp-react/src/styles/app.css`

**Implementation notes:**
- Состояния страницы:
  - initial loading
  - loaded
  - loading more
  - empty
  - error
  - stale snapshot / refresh needed
- Не reuse `RecommendationsPage` напрямую: у ленты другая модель карточки и поведения.

**Verification:** build + manual smoke after implementation.

### Task 4.3: Add feed API client methods
**Objective:** Добавить клиентские методы для первой загрузки и догрузки feed.

**Files:**
- Modify: `webapp-react/src/lib/api.js`
- Test: `tests/webapp/feed-api.test.js` (server-side), optional frontend util coverage later

**Implementation notes:**
- Добавить метод типа `getFeed(params)`.
- Поддержать `feed_version`, `offset`, `limit`, filters.
- Не ломать текущий auth flow: feed тоже использует `auth()` + Bearer JWT.

**Verification:** frontend build after API client integration.

### Task 4.4: Implement lightweight feed filters UI
**Objective:** Реализовать верхние фильтры MVP без перегруженного экрана.

**Files:**
- Modify: `webapp-react/src/pages/FeedPage.jsx`
- Modify: `webapp-react/src/styles/app.css`
- Optional create: `webapp-react/src/components/FeedFiltersModal.jsx`

**Implementation notes:**
- Быстрые кнопки сверху:
  - `Все`
  - `Сегодня`
  - `Завтра`
  - `Спорт`
- Второй слой фильтров для `Страна` и `Лига` можно сделать через modal/bottom sheet.
- Изменение фильтра должно сбрасывать offset и заново загружать первую страницу snapshot-потока.

**Verification:** build + manual visual check.

### Task 4.5: Build feed card and quick modal
**Objective:** Сделать компактную карточку и быструю модалку без перехода в match page.

**Files:**
- Modify: `webapp-react/src/pages/FeedPage.jsx`
- Create: `webapp-react/src/components/FeedBetModal.jsx`
- Modify: `webapp-react/src/styles/app.css`

**Implementation notes:**
- Карточка показывает одну основную ставку.
- Модалка показывает ту же ставку + краткое объяснение.
- В модалке нет ссылок/кнопок перехода в `/match/:id`.
- Не переиспользовать текущий `BetModal` без адаптации, если он жёстко завязан на multi-bet model recommendations page.

**Verification:** build + targeted manual smoke.

### Task 4.6: Add chunk-loading by scroll end
**Objective:** Реализовать догрузку следующих 10 элементов при достижении конца списка.

**Files:**
- Modify: `webapp-react/src/pages/FeedPage.jsx`
- Modify: `webapp-react/src/styles/app.css`

**Implementation notes:**
- Страница хранит:
  - `feedVersion`
  - `items`
  - `offset`
  - `hasMore`
- При догрузке передавать тот же `feedVersion`.
- Защита от двойного запроса при многократном scroll event.

**Verification:** manual smoke + build.

---

## Phase 5. Snapshot consistency and stale-version UX

### Task 5.1: Handle stale feed version safely
**Objective:** Не допускать смешивания чанков из разных snapshot version.

**Files:**
- Modify: `webapp/services/feedService.js`
- Modify: `webapp/routes/feed/index.js`
- Modify: `webapp-react/src/pages/FeedPage.jsx`
- Test: `tests/webapp/feed-api.test.js`

**Implementation notes:**
- Если requested `feed_version` больше недоступна:
  - вернуть controlled payload/409-style semantic response
  - frontend показывает мягкое сообщение `Лента обновилась` и перезагружает с начала
- Не подсовывать silently new version в середину текущего скролла.

**Verification:** tests on stale version + manual UI behavior.

### Task 5.2: Add TTL + rebuild lock policy
**Objective:** Подготовить гибридную стратегию обновления snapshot без наслоения.

**Files:**
- Modify: `webapp/services/feedService.js`
- Test: `tests/webapp/feed-service.test.js`

**Implementation notes:**
- TTL как safety net
- rebuild lock обязателен
- новый snapshot строится отдельно и только потом переключает `current_version`
- старые snapshot держать ещё короткое время, чтобы пользователь мог дочитать текущую ленту

**Verification:** unit tests на lock semantics и atomic switch.

---

## Phase 6. Testing and verification

### Task 6.1: Add backend API tests
**Objective:** Закрыть контракт feed route тестами.

**Files:**
- Create: `tests/webapp/feed-api.test.js`
- Modify: `tests/webapp/testHelpers.js` (if new mocks/helpers are required)

**Test cases:**
- GET `/feed` returns 200 with JWT
- returns first 10 items
- respects `window=today|tomorrow|all`
- filters by sport
- filters by country
- filters by league
- returns same `feed_version` across chunk requests
- handles stale version explicitly

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet && node --test tests/webapp/feed-api.test.js'
```

### Task 6.2: Add feed service unit tests
**Objective:** Зафиксировать snapshot assembly rules отдельно от HTTP.

**Files:**
- Create: `tests/webapp/feed-service.test.js`

**Test cases:**
- removes past matches
- sorts by nearest start time
- slices by window correctly
- emits normalized primary bet shape
- paginates with `limit/offset`
- preserves same data for same snapshot version
- rebuild publishes a new immutable version

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet && node --test tests/webapp/feed-service.test.js'
```

### Task 6.3: Run regression checks on existing WebApp
**Objective:** Убедиться, что добавление feed не ломает текущие recommendations/favorites/auth flows.

**Files:**
- Existing tests only

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet && node --test tests/webapp/auth-api.test.js tests/webapp/favorites-api.test.js tests/webapp/recommendations-api.test.js tests/webapp/match-details-api.test.js tests/webapp/user-api.test.js tests/webapp/feed-api.test.js tests/webapp/feed-service.test.js'
```

### Task 6.4: Run frontend build
**Objective:** Подтвердить, что React WebApp собирается после добавления feed tab/page/modal.

**Verification command:**
```bash
bash -ic 'cd /home/fedulov/tiger_bet/webapp-react && npm run build && npm run test:utils'
```

---

## Phase 7. Deployment checklist

### Task 7.1: Local verification before restart
**Objective:** Проверить, что frontend build and backend tests green before runtime restart.

**Steps:**
1. Run backend tests.
2. Run frontend build.
3. Review diff only for feed-related files.

### Task 7.2: Runtime restart discipline
**Objective:** Соблюсти проектное правило перезапуска.

**Steps:**
1. Если менялся frontend, сначала `npm run build` в `webapp-react`.
2. Только после этого `pm2 restart 0`.
3. Проверить `/health` и ручной сценарий в WebApp.

---

## File map summary

### Expected new backend files
- `webapp/services/feedService.js`
- `webapp/routes/feed/index.js`
- `tests/webapp/feed-service.test.js`
- `tests/webapp/feed-api.test.js`

### Expected modified backend files
- `server/app.js` (only if route loading needs explicit support)
- `webapp/services/recommendationService.js` (only if small extraction/helper reuse is needed)
- `tests/webapp/testHelpers.js`

### Expected new frontend files
- `webapp-react/src/pages/FeedPage.jsx`
- `webapp-react/src/components/WebAppTabs.jsx`
- `webapp-react/src/components/FeedBetModal.jsx`
- optionally `webapp-react/src/components/FeedFiltersModal.jsx`

### Expected modified frontend files
- `webapp-react/src/App.jsx`
- `webapp-react/src/lib/api.js`
- `webapp-react/src/styles/app.css`

---

## Non-goals for this iteration
- архив витрин
- fingerprint dedupe archive logic
- feed personalization
- likes/dislikes or learning preferences from feed actions
- переход из feed в `MatchPage`
- полный мировой DB-каталог лиг

---

## Ready-to-execute order
1. Backend feed service + tests
2. `/feed` route + API tests
3. Frontend tab shell + `FeedPage`
4. Quick modal + scroll pagination
5. Snapshot consistency UX
6. Regression tests + build
7. Only then runtime restart
