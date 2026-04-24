# Tiger Bet WebApp migration plan: Vanilla JS -> React

Goal
- Migrate the current Telegram WebApp frontend from vanilla JS to React without breaking bot integration, API contracts, or production routing (`https://bet.twfed.com/webapp`).

Current context
- Existing frontend:
  - `webapp/public/index.html`
  - `webapp/public/match.html`
  - `webapp/public/app.js`
  - `webapp/public/match.js`
  - `webapp/public/styles.css`
- Existing API layer remains valid and should be reused:
  - `webapp/api/recommendations.js`
  - `webapp/api/history.js`
  - `webapp/api/favorites.js`
  - `webapp/api/matchDetails.js`
- Telegram integration already depends on initData propagation via `x-telegram-init-data` and backend parsing.
- Runtime URL/HTTPS behavior already centralized in:
  - `server/runtimeConfig.js`

Architecture choice
- React + Vite + React Router.
- Keep Node/Fastify backend and API unchanged.
- Build React to static assets and serve under `/webapp` from current server.
- Use phased rollout with feature flag and fallback to old frontend during migration.

Tech stack
- React 18+
- Vite
- React Router
- Optional: lightweight state store (Zustand) only if needed after Phase 2
- Tests: Vitest + React Testing Library (unit), Playwright (smoke e2e), existing Node tests preserved

---

## Phase 0. Migration safety rails

1) Create branch and baseline checkpoints
- Branch: `tiger_hermes` (required workflow).
- Capture baseline:
  - `npm test`
  - existing webapp UI tests
- Save screenshots of current key screens:
  - recommendations list
  - history empty state
  - favorites modal
  - match details page

2) Introduce frontend mode flag
- Add env/config flag, e.g. `WEBAPP_FRONTEND_MODE=legacy|react`.
- Default to `legacy` first.
- Route `/webapp` can switch between legacy static and React build by flag.

Likely files:
- `server/app.js`
- `server/runtimeConfig.js`
- `.env.example` (if present)

Validation:
- With `legacy`, behavior unchanged.
- Fast toggle to `react` without bot changes.

---

## Phase 1. Bootstrap React app shell

1) Create new frontend workspace
- Suggested path: `webapp-react/`
- Initialize Vite React app.

2) Build structure
- `src/main.jsx`
- `src/App.jsx`
- `src/pages/RecommendationsPage.jsx`
- `src/pages/MatchPage.jsx`
- `src/components/...`
- `src/styles/...`
- `src/lib/telegram.js` (Telegram SDK + initData)
- `src/lib/api.js` (fetch wrapper + headers)

3) Add Telegram runtime adapters (critical)
- Read `Telegram.WebApp.initData` safely.
- Add fallback parsing from `tgWebAppData` in query/hash.
- Prepare shared helper to inject `x-telegram-init-data` to every API call.

Validation:
- React app opens standalone.
- No crash when Telegram SDK absent (local dev).
- Header helper covered by tests.

---

## Phase 2. API client and contract parity

1) Build typed API wrappers (even in JS via JSDoc)
- `getRecommendations()`
- `getHistory()`
- `getFavorites()`
- `setFavorites()`
- `getMatchDetails(id)`

2) Preserve current response handling and error semantics
- Keep soft errors for refresh/retry flows.
- Preserve formatting requirements:
  - Moscow time
  - `YYYY-MM-DD HH:mm`

Likely source mapping from legacy:
- `webapp/public/app.js` -> `webapp-react/src/pages/RecommendationsPage.jsx`
- `webapp/public/match.js` -> `webapp-react/src/pages/MatchPage.jsx`

Validation:
- Network requests exactly to current endpoints.
- `x-telegram-init-data` present on all webapp API calls.

---

## Phase 3. UI migration by feature slices

1) Recommendations screen
- Render recommendation cards.
- Keep same sorting/filtering and empty/loading states.

2) Favorites modal
- Migrate modal behavior and persistence semantics from existing endpoints.

3) History block and CTA
- Maintain current empty-state UX.

4) Match details page
- Full parity for `match.html?id=...` route.

5) Shared formatting/utilities
- Time formatter Moscow TZ
- status badges/helpers

Validation:
- Visual parity check against baseline screenshots.
- Existing acceptance test scenarios pass on React mode.

---

## Phase 4. Routing and server integration

1) Build React static bundle
- Output `dist/` assets.

2) Serve React under `/webapp`
- Configure server to serve static bundle when `WEBAPP_FRONTEND_MODE=react`.
- Ensure deep links work:
  - `/webapp`
  - `/webapp/match/:id` or query-compatible equivalent.

3) Keep bot untouched except URL if required
- Bot should still open `https://bet.twfed.com/webapp`.
- No change required in `bot/...` unless route shape changes.

Likely files:
- `server/app.js`
- possibly `index.js` startup wiring
- deploy scripts / Docker compose if present

Validation:
- Telegram button opens React app in production URL.
- Reverse proxy (Caddy) behavior unchanged.

---

## Phase 5. Testing strategy

1) Unit tests (React)
- Utilities: telegram initData extraction, header injection, date formatting.
- Components: recommendations render, favorites interactions, empty states.

2) Integration tests
- API client tests with mocked fetch.
- Route tests for page transitions and match open.

3) E2E smoke tests
- Open `/webapp`
- Load recommendations
- Open favorites modal
- Open match details
- Validate no blocking console errors

4) Regression bridge
- Temporarily run both legacy and React test suites until cutover complete.

Commands (target)
- `npm test`
- `npm run test:webapp-ui`
- `npm run test:react`
- `npm run test:e2e` (if added)

---

## Phase 6. Rollout and cutover

1) Internal rollout
- Deploy with `WEBAPP_FRONTEND_MODE=legacy` + React assets present.
- Smoke test React behind temporary mode switch.

2) Canary switch
- Enable `react` for a small traffic slice or controlled window.
- Monitor API errors, WebApp open failures, JS runtime errors.

3) Full switch
- Set `WEBAPP_FRONTEND_MODE=react`.
- Keep legacy files for one rollback window.

4) Cleanup
- Remove legacy frontend code after stabilization period.

---

## Risks and mitigations

1) Telegram SDK/initData boundary regressions
- Mitigation: central `telegram.js` utility + tests for SDK present/absent/fallback mode.

2) Route mismatch between old query style and new router paths
- Mitigation: support query-based `?id=` compatibility during transition.

3) Timezone formatting drift
- Mitigation: single formatting helper with tests against fixed fixtures.

4) Caddy/proxy surprises after static path change
- Mitigation: keep `/webapp` entrypoint stable; only internal serving logic changes.

---

## Definition of done

- React WebApp fully replaces legacy UI at `/webapp`.
- Bot integration unchanged from user perspective.
- All current user scenarios work:
  - recommendations
  - favorites modal
  - history
  - match details
- initData header propagation preserved.
- Time format preserved (`YYYY-MM-DD HH:mm`, Moscow time).
- Test suite green and rollback plan documented.

---

## Suggested first execution batch (practical)

Batch A (1-2 days)
- Phase 0 + Phase 1 + API wrappers from Phase 2.

Batch B (2-3 days)
- Recommendations + Favorites + History.

Batch C (1-2 days)
- Match details + routing integration + smoke tests.

Batch D (0.5-1 day)
- Canary + cutover + cleanup checklist.
