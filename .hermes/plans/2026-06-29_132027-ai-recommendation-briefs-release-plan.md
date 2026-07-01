# AI Recommendation Briefs Release Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Довести live AI recommendation briefs в `tiger_bet` до спокойного production-релиза с наблюдаемостью, формализованным контрактом, автоматической проверкой и понятным operational path.

**Architecture:** Текущая бизнес-логика brief-generation уже живёт в backend/webapp services и обогащает `/recommendations`. До релиза нужно не переписывать архитектуру, а закрепить production trigger, зафиксировать контракт stale/skip/no-brief, добавить мониторинг и покрыть production-shaped path автопроверками. Для synthetic/slug-only матчей сохранить текущий deterministic fallback как явный контракт, а не скрытое поведение.

**Tech Stack:** Node.js, existing scheduler scripts, Postgres, webapp services, React/Vite frontend, Playwright MCP/manual smoke, node:test.

---

## Current shipped baseline

Уже работает:
- generation brief → DB
- DB current row → `/recommendations`
- UI render `ai_brief`
- slug-only live recommendations → deterministic fallback `match_id`
- targeted tests and live smoke

Это позволяет делать soft launch, но не полноценный production release без дополнительного hardening.

---

## P0 — must-have before release

### P0.1. Зафиксировать release contract для brief lifecycle

**Objective:** Убрать двусмысленность в поведении API/UI для `ready`, `stale`, `skip`, `failed`, `no-brief`.

**Files:**
- Create: `docs/ai-recommendation-briefs-release-contract.md`
- Optionally modify: `webapp/services/aiBriefStore.js`
- Optionally modify: `webapp-react/src/pages/RecommendationsPage.jsx`
- Test: `tests/webapp/ai-brief-store.test.js`
- Test: `tests/webapp/recommendations-api.test.js` or nearest equivalent recommendations API test file

**Deliverables:**
- Таблица состояний:
  - `ready`
  - `stale`
  - `skip`
  - `failed`
  - `unchanged`
  - `no current row`
- Для каждого состояния:
  - что хранится в current row
  - что возвращает API
  - что делает UI
  - когда stale brief допустимо показывать
- Явное решение по user-facing copy:
  - silently hide when no brief
  - or show stale badge
  - or show technical fallback only in logs

**Verification:**
- Документ существует и отражает текущее желаемое поведение
- Тесты на API/store подтверждают контракт
- UI не противоречит описанному состоянию

**Release gate:** не выпускать, пока команда не может одним документом ответить: «что увидит пользователь в каждом состоянии». 

---

### P0.2. Финализировать production trigger / scheduler wiring

**Objective:** Сделать pipeline регулярно запускаемым в проде, а не просто runnable вручную.

**Files:**
- Modify: `scheduler/AiRecommendationBriefs.js`
- Modify: `scripts/run_ai_recommendation_briefs.js`
- Modify: `package.json`
- Create or modify: scheduler registration point (exact path depends on project; likely wherever other scheduled jobs are registered)
- Create: `docs/runbooks/ai-recommendation-briefs-operations.md`

**Tasks:**
1. Определить canonical production trigger:
   - внутренний scheduler процесса
   - отдельный cron
   - внешний supervisor
2. Зафиксировать cadence:
   - пример: каждые 15–30 минут
3. Зафиксировать default `limit`
4. Зафиксировать `runType` semantics (`scheduled`, `manual`)
5. Убедиться, что logs summary печатаются на каждом запуске
6. Убедиться, что повторный запуск идемпотентен на уровне `unchanged/skip`

**Verification:**
- Один documented command / one production schedule path
- Есть пример реального запуска с summary JSON
- После запуска не происходит дублирования current brief rows

**Release gate:** не выпускать без ответа на вопрос: «что именно будит pipeline в проде и как это проверить за 2 минуты».

---

### P0.3. Добавить structured logging и базовые operational counters

**Objective:** Чтобы деградация не происходила тихо.

**Files:**
- Modify: `scripts/run_ai_recommendation_briefs.js`
- Modify: `scheduler/AiRecommendationBriefs.js`
- Optionally modify: logger utility files if project already has them
- Create: `docs/runbooks/ai-recommendation-briefs-operations.md`

**Required log fields per run:**
- timestamp
- run_type
- candidates
- processed
- ready
- failed
- skipped
- unchanged
- stale_transitions
- duration_ms
- top-level failure reason if run aborts

**Required log fields per failed item:**
- `match_id`
- `match_slug`
- `source_mode`
- `error`

**Verification:**
- Manual run produces structured summary
- Single-match failure is visible in logs
- Ops can answer:
  - “when was the last successful run?”
  - “how many ready briefs were produced today?”

**Release gate:** нет релиза без минимальной наблюдаемости.

---

### P0.4. Автотест на production-shaped enrichment path

**Objective:** Защитить end-to-end data flow от следующего рефакторинга.

**Files:**
- Modify or create: `tests/webapp/recommendations-api.test.js`
- Modify or create: `tests/webapp/recommendations-page.test.js` if frontend test harness exists
- Alternatively create: `tests/webapp/ai-recommendation-briefs-integration.test.js`

**Scenarios:**
1. numeric `match_id` + ready brief → API returns `ai_brief`
2. slug-only synthetic recommendation + ready current row → API returns `ai_brief`
3. stale current row behavior follows contract
4. no brief row → API omits `ai_brief`
5. skip/failed path does not produce incorrect user-visible brief

**Verification commands:**
- Run exact node test file(s)
- Expected: pass locally without manual DB intervention

**Release gate:** хотя бы один reliable integration-style test должен защищать enriched recommendations path.

---

### P0.5. Formalize synthetic/slug-only match identity strategy

**Objective:** Сделать fallback `match_id` из `match_slug` явным контрактом, а не скрытым хаком.

**Files:**
- Modify: `webapp/services/aiBriefBatchService.js`
- Create: `docs/ai-recommendation-briefs-identity.md`
- Test: `tests/webapp/ai-brief-batch-service.test.js`

**Document explicitly:**
- when real numeric match id is used unchanged
- when slug-derived deterministic `match_id` is used
- numeric range chosen for synthetic ids
- collision assumptions/risks
- why this is safe enough now
- whether future migration to `match_slug` as primary key is planned

**Verification:**
- Tests already prove deterministic mapping; document must match implementation
- New contributors can understand why `400xxxx...` ids appear

**Release gate:** identity rules are documented and test-covered.

---

## P1 — strongly recommended immediately after or alongside release

### P1.1. Add alert thresholds / health checks

**Objective:** Быстро замечать silent failure or no-op behavior.

**Files:**
- Modify: production scheduler/ops docs
- Optionally add: monitoring integration config/scripts

**Suggested alerts:**
- 3 scheduled runs in a row with `failed > 0`
- 6 scheduled runs in a row with `ready = 0` and `unchanged = 0`
- runner crash / no run heartbeat for expected interval × 2

**Verification:**
- There is a documented manual way to inspect last N runs
- Thresholds are written down even if automation is basic at first

---

### P1.2. Add a fast debug path for a single match

**Objective:** Ускорить разбор инцидентов.

**Files:**
- Modify: `scripts/run_ai_recommendation_briefs.js`
- Or create: `scripts/debug_ai_recommendation_brief.js`
- Create: `docs/runbooks/ai-recommendation-briefs-operations.md`

**Capabilities:**
- run for one explicit `match_slug`
- print source mode, source hash, selected bets, generation outcome
- show current row summary

**Verification:**
- One command can answer “why this match has no brief?”

---

### P1.3. Editorial QA pass on generated copy

**Objective:** Проверить пользовательское качество текста, а не только техническую доставку.

**Files:**
- Create: `docs/qa/ai-recommendation-briefs-editorial-checklist.md`

**Review checklist:**
- brief не противоречит ставкам
- нет чрезмерной уверенности
- нет шаблонного мусора
- risk note реально полезен
- stale brief не выглядит как fresh certainty

**Verification:**
- 10–20 реальных матчей отсмотрены вручную
- замечания либо исправлены, либо зафиксированы как follow-ups

---

## P2 — post-release hardening

### P2.1. Budget/rate guardrails

**Objective:** Предсказуемая стоимость и контроль всплесков.

**Files:**
- Modify: `scheduler/AiRecommendationBriefs.js`
- Modify: `scripts/run_ai_recommendation_briefs.js`
- Create/modify docs for env/config knobs

**Questions to answer:**
- max candidates per run?
- max LLM calls per hour?
- provider fallback policy?
- behavior when upstream source becomes noisy?

---

### P2.2. Clean up minor UI/runtime noise

**Objective:** Не оставлять мелкие ошибки, скрывающие реальные проблемы.

**Files:**
- Fix favicon path/auth behavior where appropriate
- Any other noisy console/runtime warnings discovered during QA

**Verification:**
- Browser console has no misleading recurring errors except accepted known issues

---

## Suggested implementation order

### Phase 1 — Release blockers (P0)
1. P0.1 release contract
2. P0.2 scheduler wiring
3. P0.3 structured logs/counters
4. P0.4 integration coverage
5. P0.5 identity strategy doc

### Phase 2 — Short stabilization pass (P1)
6. P1.1 alerts/health checks
7. P1.2 single-match debug path
8. P1.3 editorial QA

### Phase 3 — Hardening (P2)
9. P2.1 budget controls
10. P2.2 cleanup of console/runtime noise

---

## Concrete go/no-go release checklist

### Go only if all are true
- [ ] documented lifecycle contract exists
- [ ] production trigger is defined and tested
- [ ] run summary logging exists
- [ ] enriched recommendations integration test exists
- [ ] slug/synthetic identity strategy is documented
- [ ] at least one fresh live brief visible in `/recommendations`
- [ ] at least one fresh live brief visible in UI

### Safe to defer until after launch
- [ ] sophisticated alerting automation
- [ ] better debug CLI
- [ ] cost budget optimization
- [ ] UX polish / favicon cleanup

---

## Recommended release decision

### Beta / controlled release
Можно выпускать после закрытия всего P0.

### Full production release
Желательно закрыть весь P0 + минимум P1.1 и P1.2.

---

## Risks if released too early

- pipeline quietly stops producing fresh briefs
- stale content is shown without explicit decision
- future refactor breaks slug-only enrichment path
- ops cannot quickly explain why a match has no brief
- synthetic IDs confuse future maintainers and incident responders

---

## Minimal next action

Если идти самым коротким путём к релизу, следующий рабочий спринт должен закрыть ровно это:
1. release contract doc
2. scheduler wiring
3. structured run summary logs
4. integration test for `/recommendations` enrichment
5. identity doc for slug-derived synthetic ids

После этого можно принимать решение о выкате.
