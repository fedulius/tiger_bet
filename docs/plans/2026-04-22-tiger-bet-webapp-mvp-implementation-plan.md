# Tiger Bet WebApp MVP — Implementation Plan

> For Hermes: implement task-by-task with strict TDD (RED → GREEN → REFACTOR), and verify each claim with fresh command output.

Goal: Реализовать MVP webApp для tiger_bet по утвержденной спецификации v1: single-page кабинет с рекомендациями, избранным (спорт/лиги), историей прогнозов и внутренней страницей деталей.

Architecture:
- Fastify API + static frontend (без SPA-фреймворка на MVP, vanilla JS).
- Backend отдает JSON для рекомендаций/избранного/истории и static assets для UI.
- Временное хранилище избранного на MVP: JSON-файл с дефолтным профилем `guest` (до появления авторизации).
- Детали прогноза открываются на внутреннем роуте `/webapp/match/:id`, источник stavka.tv — внешней кнопкой.

Tech Stack:
- Node.js 18+, Fastify, cheerio/request (уже в проекте)
- Node test runner (`node --test`)
- Vanilla HTML/CSS/JS

---

## Phase 0 — Bootstrap webApp runtime

### Task 1: Включить HTTP сервер и статическую раздачу webapp
Objective: Поднять Fastify и начать отдавать webapp-страницы.

Files:
- Modify: `index.js`
- Create: `webapp/public/index.html`
- Create: `webapp/public/app.js`
- Create: `webapp/public/styles.css`

Steps:
1) RED: Добавить smoke-тест, что HTTP endpoint отвечает 200.
   - Create: `tests/webapp/server-smoke.test.js`
2) Run: `node --test tests/webapp/server-smoke.test.js`
   - Expected: FAIL (сервер/роут еще не реализован).
3) GREEN: В `index.js`:
   - раскомментировать запуск fastify,
   - зарегистрировать static route `/webapp` на `webapp/public`.
4) Run: `node --test tests/webapp/server-smoke.test.js`
   - Expected: PASS.
5) Commit:
   - `git add index.js webapp/public/index.html webapp/public/app.js webapp/public/styles.css tests/webapp/server-smoke.test.js`
   - `git commit -m "feat(webapp): enable fastify and serve webapp static shell"`

### Task 2: Вынести fastify app factory для тестируемости
Objective: Разделить создание app и запуск процесса.

Files:
- Create: `server/app.js`
- Modify: `index.js`
- Create: `tests/webapp/app-factory.test.js`

Steps:
1) RED: тест на `buildApp()` и health-route.
2) Run: `node --test tests/webapp/app-factory.test.js` (FAIL).
3) GREEN: сделать `buildApp({ pg, bot })`, а в `index.js` только запуск.
4) Run: `node --test tests/webapp/app-factory.test.js` (PASS).
5) Commit.

---

## Phase 1 — API contract for MVP blocks

### Task 3: Добавить endpoint рекомендаций (3 карточки, сортировка по времени)
Objective: Отдавать `/api/webapp/recommendations` по правилам MVP.

Files:
- Create: `webapp/api/recommendations.js`
- Create: `webapp/services/recommendationService.js`
- Create: `tests/webapp/recommendations-api.test.js`

Response contract:
```json
{
  "items": [
    {
      "id": "match-123",
      "match": "Team A vs Team B",
      "league": "Premier League",
      "starts_at": "2026-04-22T19:30:00Z",
      "main_thought": "Победа Team A",
      "confidence": 72,
      "is_new": true
    }
  ],
  "source": "favorites|fallback-top",
  "updated_at": "2026-04-22T13:00:00Z"
}
```

Steps:
1) RED: тесты на limit=3 и сортировку по времени.
2) Run test (FAIL).
3) GREEN: реализовать сервис с fallback на топ-матчи, если персональных нет.
4) Run test (PASS).
5) Commit.

### Task 4: Добавить endpoint избранного (виды спорта и лиги)
Objective: Отдавать и сохранять избранное для `guest`.

Files:
- Create: `webapp/api/favorites.js`
- Create: `webapp/services/favoritesStore.js`
- Create: `webapp/data/favorites.json`
- Create: `tests/webapp/favorites-api.test.js`

Endpoints:
- `GET /api/webapp/favorites`
- `PUT /api/webapp/favorites`

PUT body:
```json
{
  "sports": ["football", "tennis"],
  "leagues": ["Premier League", "ATP"]
}
```

Steps:
1) RED: тесты GET/PUT с валидацией массива строк.
2) GREEN: JSON-file store с атомарной записью.
3) PASS tests.
4) Commit.

### Task 5: Добавить endpoint последних прогнозов
Objective: Отдавать блок истории в формате A (минимум).

Files:
- Create: `webapp/api/history.js`
- Create: `webapp/services/historyService.js`
- Create: `tests/webapp/history-api.test.js`

Response item fields:
- `id`, `match`, `league`, `starts_at`, `main_thought`, `confidence`

Steps:
1) RED test for shape + empty-state payload.
2) GREEN implementation.
3) PASS tests.
4) Commit.

### Task 6: Добавить endpoint деталей матча
Objective: Внутренняя страница деталей получает данные через API.

Files:
- Create: `webapp/api/matchDetails.js`
- Create: `webapp/services/matchDetailsService.js`
- Create: `tests/webapp/match-details-api.test.js`

Endpoint:
- `GET /api/webapp/match/:id`

Response minimum:
- `match`, `league`, `starts_at`, `main_thought`, `confidence`, `basis`, `source_url`

Steps: RED → GREEN → PASS → Commit.

---

## Phase 2 — Frontend MVP UI

### Task 7: Собрать single-page layout с якорями
Objective: Реализовать главный экран в порядке блоков: Recommendations → Favorites Sports → Favorites Leagues → History.

Files:
- Modify: `webapp/public/index.html`
- Modify: `webapp/public/styles.css`
- Modify: `webapp/public/app.js`
- Create: `tests/webapp-ui/layout-render.test.js`

UI requirements:
- sticky header with anchors;
- balanced density;
- auto theme via `prefers-color-scheme`.

Steps:
1) RED UI test/snapshot on critical DOM ids.
2) GREEN HTML/CSS structure.
3) PASS test.
4) Commit.

### Task 8: Реализовать блок рекомендаций (3 карточки, бейдж “Новые”)
Objective: Отрисовка рекомендаций и ручное обновление.

Files:
- Modify: `webapp/public/app.js`
- Modify: `webapp/public/styles.css`
- Create: `tests/webapp-ui/recommendations-render.test.js`

Behavior:
- fetch `/api/webapp/recommendations`;
- render exactly 3 cards;
- show `Новые` badge when `is_new=true`;
- show "Обновлено X сек назад" статус после ручного refresh.

Steps: RED → GREEN → PASS → Commit.

### Task 9: Реализовать модалку «Управление избранным»
Objective: Кнопка `+ Добавить` открывает модалку с поиском и чекбоксами.

Files:
- Modify: `webapp/public/index.html`
- Modify: `webapp/public/app.js`
- Modify: `webapp/public/styles.css`
- Create: `tests/webapp-ui/favorites-modal.test.js`

Behavior:
- search filter over sports/leagues list;
- checkbox select;
- apply button → PUT favorites;
- chips with remove (×) in blocks.

Steps: RED → GREEN → PASS → Commit.

### Task 10: Реализовать блок истории прогнозов и empty-state с CTA
Objective: Формат A + кнопка «Открыть рекомендации» при пустом списке.

Files:
- Modify: `webapp/public/app.js`
- Modify: `webapp/public/index.html`
- Modify: `webapp/public/styles.css`
- Create: `tests/webapp-ui/history-empty-state.test.js`

Steps: RED → GREEN → PASS → Commit.

### Task 11: Реализовать внутреннюю страницу деталей матча
Objective: `webapp/public/match.html?id=...` + кнопка "Открыть источник".

Files:
- Create: `webapp/public/match.html`
- Create: `webapp/public/match.js`
- Modify: `webapp/public/styles.css`
- Create: `tests/webapp-ui/match-details-page.test.js`

Behavior:
- read `id` from query;
- fetch `/api/webapp/match/:id`;
- render summary;
- link to external `source_url` with `target="_blank"`.

Steps: RED → GREEN → PASS → Commit.

---

## Phase 3 — Refresh and resilience

### Task 12: Автообновление рекомендаций + soft error handling
Objective: Реализовать таймер автообновления + не блокировать экран при ошибке.

Files:
- Modify: `webapp/public/app.js`
- Modify: `webapp/public/styles.css`
- Create: `tests/webapp-ui/recommendations-refresh.test.js`

Rules:
- poll every 3–5 minutes (config const);
- manual refresh remains available;
- per-block inline error with retry;
- no global fatal overlay.

Steps: RED → GREEN → PASS → Commit.

### Task 13: Добавить fallback-состояния в API и UI
Objective: Гарантировать предсказуемый UX при пустых данных.

Files:
- Modify: `webapp/services/recommendationService.js`
- Modify: `webapp/services/historyService.js`
- Modify: `webapp/public/app.js`
- Create: `tests/webapp/fallback-contract.test.js`

States to verify:
- recommendations empty → fallback top matches;
- history empty → text + CTA.

Steps: RED → GREEN → PASS → Commit.

---

## Phase 4 — Final verification and handoff

### Task 14: Интеграционная проверка и документация запуска
Objective: Зафиксировать команды запуска/тестов и smoke-checklist.

Files:
- Modify: `README.MD`
- Create: `docs/plans/webapp-mvp-smoke-checklist.md`

Verification commands:
```bash
npm test
node index.js
curl -s http://localhost:8084/webapp | head
curl -s http://localhost:8084/api/webapp/recommendations
```

Acceptance checklist:
- webapp opens on `/webapp`;
- 4 blocks present in correct order;
- recommendations show 3 cards sorted by time;
- favorites modal works end-to-end;
- history empty-state CTA works;
- match details page opens internally;
- external source button works.

Steps:
1) Run full test suite.
2) Run manual smoke-checklist.
3) Commit docs updates.

---

## Non-goals for this plan
- Авторизация (Telegram/email).
- Персонализация на уровне user accounts.
- Расширенные фильтры и риск-аналитика.

## Suggested branch discipline
- Keep working in `tiger_hermes`.
- One commit per task.
- Before completion claims, always run fresh tests and capture output.
