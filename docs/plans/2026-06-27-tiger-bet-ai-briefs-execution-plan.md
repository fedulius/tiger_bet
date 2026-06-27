# Tiger Bet AI Briefs Execution Plan

> **For Hermes:** use this as the execution order. One narrow acceptance goal per step. Do not batch multiple risky changes into one pass.

**Goal:** implement precomputed AI recommendation briefs in tiger_bet with Postgres-backed current/history persistence, scheduler-driven refresh, API enrichment, and modal rendering.

**Architecture:** keep live recommendation selection as-is, add a separate persistence + batch generation pipeline, then enrich `/recommendations` with precomputed `ai_brief`. Request path must never call the LLM directly.

**Tech Stack:** Node.js, Fastify, PostgreSQL, existing `lib/stavkaApi.js`, React WebApp, `node --test`.

---

## Execution rules

- Each task should be implemented and verified before moving on.
- Prefer one focused commit per task.
- Do not enable scheduler in always-on mode until manual runner and API/UI are verified.
- Keep `recommendationService.js` responsible for recommendation selection, not DB persistence.
- Keep all AI generation outside request-serving path.

---

## Task 1: Add stable match identity to recommendation items

**Objective:** make recommendation items safe to join with AI brief rows in DB.

**Files:**
- Modify: `webapp/services/recommendationService.js`
- Modify: `tests/webapp/recommendation-service-api.test.js`
- Modify: `tests/webapp/recommendations-api.test.js`

**Implementation:**
1. In API-based recommendation item builders, add:
   - `match_id: m.id`
   - `match_slug: m.slug`
2. Keep existing `id` field for UI compatibility.
3. Make sure fallback items also expose compatible fields where possible:
   - `match_id: null` or stable fallback value
   - `match_slug` if available
4. Do not yet add `ai_brief` loading.

**Acceptance criteria:**
- every live recommendation item has explicit `match_id` and `match_slug`
- existing UI/tests still pass

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/recommendation-service-api.test.js tests/webapp/recommendations-api.test.js
```

**Commit message:**
```bash
git commit -m "feat: add match identity to recommendation items"
```

---

## Task 2: Add AI brief store read-path

**Objective:** create DAL for current brief reads without changing behavior yet.

**Files:**
- Create: `webapp/services/aiBriefStore.js`
- Create: `tests/webapp/ai-brief-store.test.js`

**Implementation:**
1. Implement read helpers:
   - `getCurrentBriefByMatchId(pg, { externalSource, matchId })`
   - `getCurrentBriefsByMatchIds(pg, { externalSource, matchIds })`
2. Normalize returned rows into JS objects.
3. Map current rows to lightweight API-friendly brief payload via helper:
   - `mapCurrentRowToApiBrief(row)`
4. Handle empty arrays without querying `IN ()`.

**Acceptance criteria:**
- bulk read works for many `match_id`s
- empty input returns empty map/array
- API mapping excludes internal-only DB fields

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-brief-store.test.js
```

**Commit message:**
```bash
git commit -m "feat: add ai brief store read helpers"
```

---

## Task 3: Enrich `/recommendations` with current briefs

**Objective:** return existing DB-backed `ai_brief` in API without building generation pipeline yet.

**Files:**
- Modify: `webapp/routes/recommendations/index.js`
- Optional create: `webapp/services/recommendationBriefEnricher.js`
- Modify: `tests/webapp/recommendations-api.test.js`
- Modify: `tests/webapp/testHelpers.js` if fake pg helpers need richer responses

**Implementation:**
1. After `getRecommendations(...)`, collect all numeric `match_id`s.
2. Use `aiBriefStore.getCurrentBriefsByMatchIds(...)`.
3. Attach `item.ai_brief` only when current row has:
   - `brief_status = 'ready'` or `brief_status = 'stale'`
4. If store read fails, log and return base recommendations unchanged.
5. Do not yet render in UI.

**Acceptance criteria:**
- API returns `ai_brief` when row exists
- API omits `ai_brief` when row missing
- route survives DB/store read error

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/recommendations-api.test.js
```

**Commit message:**
```bash
git commit -m "feat: enrich recommendations api with ai briefs"
```

---

## Task 4: Render `ai_brief` in BetModal

**Objective:** expose precomputed brief in UI with zero backend generation work.

**Files:**
- Modify: `webapp-react/src/components/BetModal.jsx`
- Optional modify: `webapp-react/src/styles/app.css`
- Optional modify: `webapp-react/src/pages/RecommendationsPage.jsx` only if prop plumbing is needed

**Implementation:**
1. Add modal block below selected bet details:
   - headline
   - brief
   - risk note
2. If `item.ai_brief.stale === true`, render a subtle marker like `Обзор обновляется`.
3. Keep layout stable when no brief exists.
4. Do not show AI brief in recommendation cards yet.

**Acceptance criteria:**
- modal renders AI block only when `ai_brief` exists
- no layout break for long-ish text
- recommendations list remains compact

**Verify:**
```bash
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

**Commit message:**
```bash
git commit -m "feat: render ai briefs in recommendation modal"
```

---

## Task 5: Implement AI brief store write-path and status transitions

**Objective:** support history inserts and current row updates according to agreed stale semantics.

**Files:**
- Modify: `webapp/services/aiBriefStore.js`
- Modify: `tests/webapp/ai-brief-store.test.js`

**Implementation:**
1. Add write helpers:
   - `insertGeneration(...)`
   - `upsertCurrentBriefFromReadyGeneration(...)`
   - `markCurrentBriefStaleAfterFailure(...)`
   - `markCurrentBriefStaleAfterSkip(...)`
   - `upsertMissingCurrentBrief(...)`
2. Encode rules:
   - `ready` replaces visible text
   - `failed/skipped` keep old text if it exists
   - first `failed/skipped` creates `missing` current row
3. Set/update:
   - `brief_status`
   - `last_generation_status`
   - `stale_since`
   - `last_error`
   - `last_skip_reason`
   - `current_generation_id`

**Acceptance criteria:**
- all status transition scenarios pass tests
- no path accidentally deletes old visible brief on fail/skip

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-brief-store.test.js
```

**Commit message:**
```bash
git commit -m "feat: add ai brief persistence transitions"
```

---

## Task 6: Build normalized source payload service

**Objective:** construct deterministic source payloads and `source_hash` from stavka data.

**Files:**
- Create: `webapp/services/aiBriefSourceService.js`
- Create: `tests/webapp/ai-brief-source-service.test.js`
- Optional modify: `lib/stavkaApi.js`

**Implementation:**
1. Build function:
   - `buildAiBriefSourcePayload({ match, popularBetsLoader, matchDetailLoader, riskBetsSelector })`
2. Load and normalize:
   - top bets
   - primary signal
   - summary text/snippet
   - source URL
3. Return explicit `source_mode`:
   - `full`
   - `light`
   - `skip`
4. Build canonical hash input with deterministic ordering.
5. Compute `source_hash`.

**Acceptance criteria:**
- identical input yields identical hash
- missing summary with usable bets gives `light`
- insufficient data gives `skip`

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-brief-source-service.test.js
```

**Commit message:**
```bash
git commit -m "feat: add ai brief source payload builder"
```

---

## Task 7: Add AI generator adapter with strict result schema

**Objective:** encapsulate single-match generation and normalize outcomes to `ready/skipped/failed`.

**Files:**
- Create: `webapp/services/aiBriefGenerator.js`
- Create: `tests/webapp/ai-brief-generator.test.js`

**Implementation:**
1. Implement a thin adapter API:
   - `generateAiBrief({ sourcePayload, modelName, promptVersion, provider })`
2. Add validation helpers:
   - `validateAiBriefOutput(...)`
   - `normalizeAiBriefOutput(...)`
3. Return structured results:
   - success => `ready`
   - source insufficient => `skipped`
   - invalid JSON/provider failure/timeout => `failed`
4. Make provider swappable; do not hardwire this deep into routes.

**Acceptance criteria:**
- malformed output is rejected
- output length caps enforced
- generator returns deterministic normalized object shape

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-brief-generator.test.js
```

**Commit message:**
```bash
git commit -m "feat: add ai brief generator adapter"
```

---

## Task 8: Implement batch orchestration service

**Objective:** connect source building, refresh decision, generation, and persistence for one batch.

**Files:**
- Create: `webapp/services/aiBriefBatchService.js`
- Create: `tests/webapp/ai-brief-batch-service.test.js`

**Implementation:**
1. Implement:
   - `selectCandidateMatches(...)`
   - `refreshMatchBrief(...)`
   - `runAiBriefBatch(...)`
2. Refresh flow per match:
   - build source payload
   - read current row
   - compare `source_hash`, `refresh_after`, `expires_at`
   - skip unchanged if refresh not needed
   - otherwise generate and persist
3. Collect summary counters:
   - candidates
   - full/light/skip
   - unchanged
   - ready
   - failed
   - skipped
   - stale_transitions

**Acceptance criteria:**
- one failed match does not crash whole batch
- unchanged rows are skipped cleanly
- stale semantics are preserved in mixed batches

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-brief-batch-service.test.js
```

**Commit message:**
```bash
git commit -m "feat: add ai brief batch orchestration"
```

---

## Task 9: Add manual runner entrypoint

**Objective:** make the batch runnable on demand before enabling scheduling.

**Files:**
- Create: `scheduler/AiRecommendationBriefs.js`
- Modify: `scheduler/index.js`
- Optional create: `scripts/run-ai-briefs.js`
- Create: `tests/webapp/ai-recommendation-briefs-runner.test.js`

**Implementation:**
1. Create scheduler module/class that wires:
   - pg
   - stavka loaders
   - store
   - source service
   - generator
   - batch service
2. Return/log batch summary.
3. Add manual entrypoint runnable from shell.
4. Do not yet auto-enable from `index.js` by default.

**Acceptance criteria:**
- batch can run once manually
- process exits with useful logs/status

**Verify:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/ai-recommendation-briefs-runner.test.js
```

**Commit message:**
```bash
git commit -m "feat: add manual ai briefs runner"
```

---

## Task 10: Manual smoke with real tables

**Objective:** verify end-to-end persistence before scheduler enablement.

**Files:**
- No code required unless issues found
- Optional notes update in second-brain

**Implementation:**
1. Run manual runner against a small shortlist.
2. Inspect DB rows in both current/history tables.
3. Verify expected scenarios:
   - ready rows created
   - history rows inserted
   - current rows linked to generation
4. Hit `/recommendations` and confirm `ai_brief` appears.
5. Open UI and verify modal rendering.

**Acceptance criteria:**
- one real match produces visible brief in modal
- no request-path generation occurs
- DB state matches expected transitions

**Verify:**
Suggested sequence:
```bash
cd /home/fedulov/tiger_bet && node scripts/run-ai-briefs.js
cd /home/fedulov/tiger_bet && node --test tests/webapp/recommendations-api.test.js
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

**Commit message:**
```bash
git commit -m "test: verify ai briefs e2e smoke path"
```

---

## Task 11: Enable scheduler behind env flag

**Objective:** allow controlled background refresh in runtime.

**Files:**
- Modify: `index.js`
- Optional modify: env/runtime docs if present

**Implementation:**
1. Add a new toggle, e.g. `RUN_AI_BRIEFS=1`.
2. Keep legacy scheduler disabled.
3. Ensure startup path does not block HTTP if job is long-running.
4. Prefer periodic external scheduling or isolated process over coupling to web server boot.

**Acceptance criteria:**
- feature can be turned on/off without code changes
- HTTP and bot runtime remain stable

**Verify:**
- run app with toggle off and on in safe environment
- verify no startup crash

**Commit message:**
```bash
git commit -m "feat: gate ai briefs scheduler with runtime flag"
```

---

## Task 12: Add operational logging and failure visibility

**Objective:** make the pipeline debuggable in production.

**Files:**
- Modify: `webapp/services/aiBriefBatchService.js`
- Modify: `scheduler/AiRecommendationBriefs.js`
- Optional modify: `webapp/services/aiBriefGenerator.js`

**Implementation:**
1. Log per run summary.
2. Log per-match failures at warning/error level with match id/slug.
3. Include counts for:
   - candidates
   - full/light/skip
   - unchanged
   - ready/skipped/failed
   - duration
   - token usage if available
4. Avoid logging huge full payload blobs.

**Acceptance criteria:**
- operator can diagnose source shortage vs provider error vs stale churn

**Verify:**
- run manual batch and inspect logs

**Commit message:**
```bash
git commit -m "chore: add ai briefs batch observability"
```

---

## Task 13: Final regression pass

**Objective:** verify the feature as a whole before calling it done.

**Files:**
- No new files necessarily

**Run this verification set:**
```bash
cd /home/fedulov/tiger_bet && node --test \
  tests/webapp/ai-brief-store.test.js \
  tests/webapp/ai-brief-source-service.test.js \
  tests/webapp/ai-brief-generator.test.js \
  tests/webapp/ai-brief-batch-service.test.js \
  tests/webapp/ai-recommendation-briefs-runner.test.js \
  tests/webapp/recommendation-service-api.test.js \
  tests/webapp/recommendations-api.test.js

cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

**If frontend/webapp behavior changed in live workspace, also run:**
```bash
pm2 restart 0
```

**Acceptance criteria:**
- backend tests green
- frontend build green
- modal still works
- recommendations route still works with and without briefs

**Commit message:**
```bash
git commit -m "test: run final ai briefs regression pass"
```

---

## Recommended execution order for Claude Code / Hermes

If delegating to Claude Code or another coding agent, use this exact sequence:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10
11. Task 11
12. Task 12
13. Task 13

### Why this order

- It exposes value early: API/UI can consume existing DB data before generator/scheduler are complete.
- It de-risks persistence first.
- It delays background automation until manual end-to-end proof exists.
- It avoids mixing visible UI work with unfinished backend state transitions.

---

## Suggested narrow prompts for Claude Code

### Prompt A — identity contract
> Add explicit `match_id` and `match_slug` to recommendation items in `webapp/services/recommendationService.js`, update only the directly affected tests, and verify with targeted `node --test` runs.

### Prompt B — read-only brief enrichment
> Implement a read-only `aiBriefStore` with bulk current-brief lookup by `(external_source, match_id)`, wire `/recommendations` to attach `ai_brief` when present, keep route resilient on store failure, and verify with targeted API tests.

### Prompt C — modal rendering
> Render `item.ai_brief` inside `webapp-react/src/components/BetModal.jsx` without changing recommendation card density, keep empty-state behavior unchanged, and verify with `npm run build`.

### Prompt D — persistence transitions
> Extend `aiBriefStore` with history insert and current-row status transition helpers for `ready`, `failed`, and `skipped`, preserving stale brief semantics, and add focused unit tests for all transition cases.

### Prompt E — source builder
> Create `aiBriefSourceService.js` that builds deterministic normalized source payloads with `source_mode` and `source_hash` from listing + popular-bets + match-detail data, with focused unit tests for `full`, `light`, and `skip`.

### Prompt F — batch runner
> Implement `aiBriefBatchService.js` and a manual runner entrypoint that orchestrate source payload build, refresh decision, generation, and persistence for a shortlist of matches, with summary logging and targeted tests.

---

## Exit condition

The feature is ready to move from implementation to controlled rollout only when all of these are true:

- current/history persistence logic is tested
- `/recommendations` returns `ai_brief` from DB
- `BetModal` renders brief correctly
- manual batch run creates real rows in existing tables
- no realtime generation happens in request path
- scheduler remains behind explicit enablement
