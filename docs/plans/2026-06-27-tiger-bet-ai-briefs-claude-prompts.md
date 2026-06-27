# Claude Code prompts — Tiger Bet AI briefs

Ниже — готовые узкие промпты для последовательного запуска через Claude Code. Каждый промпт рассчитан на один acceptance goal. После каждого шага нужен независимый verify Hermes-ом, а не доверие только сводке Claude.

---

## Prompt 1 — match identity contract

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 1 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Add explicit match identity fields to recommendation items so they can be joined with AI brief DB rows.

Scope:
- Modify only:
  - webapp/services/recommendationService.js
  - tests/webapp/recommendation-service-api.test.js
  - tests/webapp/recommendations-api.test.js
- Do not touch UI files.
- Do not add ai_brief loading yet.
- Do not edit unrelated files even if they are dirty.

Requirements:
1. In API-based recommendation item builders, add:
   - match_id: m.id
   - match_slug: m.slug
2. Keep existing id field for UI compatibility.
3. Make fallback items expose compatible fields where possible:
   - match_id: null or stable fallback value
   - match_slug if available
4. Update only the directly affected tests.
5. Run exactly this verification before finishing:
   node --test tests/webapp/recommendation-service-api.test.js tests/webapp/recommendations-api.test.js

Report back with:
- exact files changed
- exact verification command run
- whether it passed or failed
- no commit
```

---

## Prompt 2 — read-only aiBriefStore

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 2 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Create a read-only aiBriefStore DAL for current brief reads.

Scope:
- Create/modify only:
  - webapp/services/aiBriefStore.js
  - tests/webapp/ai-brief-store.test.js
- Do not wire routes yet.
- Do not implement write-path yet.
- Do not edit unrelated dirty files.

Requirements:
1. Implement read helpers:
   - getCurrentBriefByMatchId(pg, { externalSource, matchId })
   - getCurrentBriefsByMatchIds(pg, { externalSource, matchIds })
2. Normalize DB rows into JS objects.
3. Add helper:
   - mapCurrentRowToApiBrief(row)
4. Handle empty arrays without querying IN ().
5. Keep API mapping lightweight and exclude internal-only fields.
6. Run exactly this verification before finishing:
   node --test tests/webapp/ai-brief-store.test.js

Report back with exact files changed and the verification result. No commit.
```

---

## Prompt 3 — enrich recommendations API

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 3 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Attach DB-backed ai_brief to /recommendations response without adding generation pipeline.

Scope:
- Modify/create only:
  - webapp/routes/recommendations/index.js
  - webapp/services/recommendationBriefEnricher.js (optional, only if useful)
  - tests/webapp/recommendations-api.test.js
  - tests/webapp/testHelpers.js (only if fake pg helpers truly need it)
- Do not modify UI files.
- Do not change recommendation selection logic except what is needed to enrich the response.

Requirements:
1. After getRecommendations(...), collect numeric match_ids.
2. Use aiBriefStore.getCurrentBriefsByMatchIds(...).
3. Attach item.ai_brief only when brief_status is ready or stale.
4. If brief loading fails, log and return base recommendations unchanged.
5. Keep response backward-compatible.
6. Run exactly this verification before finishing:
   node --test tests/webapp/recommendations-api.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 4 — render ai_brief in BetModal

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 4 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Render precomputed ai_brief in the recommendation BetModal only.

Scope:
- Modify only:
  - webapp-react/src/components/BetModal.jsx
  - webapp-react/src/styles/app.css (optional, if needed)
  - webapp-react/src/pages/RecommendationsPage.jsx (only if prop plumbing is truly needed)
- Do not modify recommendation cards.
- Do not redesign the modal.
- Keep change minimal and scoped.

Requirements:
1. Render headline, brief, and risk_note below selected bet details.
2. If item.ai_brief.stale === true, show a subtle stale marker like "Обзор обновляется".
3. No UI break when ai_brief is absent.
4. Do not show ai_brief in list cards.
5. Run exactly this verification before finishing:
   cd webapp-react && npm run build

Report exact files changed and verification result. No commit.
```

---

## Prompt 5 — aiBriefStore write-path and transitions

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 5 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Add write-path helpers and agreed stale semantics to aiBriefStore.

Scope:
- Modify only:
  - webapp/services/aiBriefStore.js
  - tests/webapp/ai-brief-store.test.js
- Do not wire scheduler yet.
- Do not touch routes/UI.

Requirements:
1. Add helpers:
   - insertGeneration(...)
   - upsertCurrentBriefFromReadyGeneration(...)
   - markCurrentBriefStaleAfterFailure(...)
   - markCurrentBriefStaleAfterSkip(...)
   - upsertMissingCurrentBrief(...)
2. Rules:
   - ready replaces visible text
   - failed/skipped keep old text if it exists
   - first failed/skipped creates missing current row
3. Update and test:
   - brief_status
   - last_generation_status
   - stale_since
   - last_error
   - last_skip_reason
   - current_generation_id
4. Run exactly this verification before finishing:
   node --test tests/webapp/ai-brief-store.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 6 — source payload builder

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 6 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Create deterministic source payload builder with source_mode and source_hash.

Scope:
- Create/modify only:
  - webapp/services/aiBriefSourceService.js
  - tests/webapp/ai-brief-source-service.test.js
  - lib/stavkaApi.js (only if a small helper is necessary)
- Do not implement scheduler/batch yet.

Requirements:
1. Build function:
   - buildAiBriefSourcePayload({ match, popularBetsLoader, matchDetailLoader, riskBetsSelector })
2. Normalize:
   - top bets
   - primary signal
   - summary text/snippet
   - source URL
3. Return source_mode: full | light | skip
4. Build canonical deterministic source_hash input.
5. Run exactly this verification before finishing:
   node --test tests/webapp/ai-brief-source-service.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 7 — generator adapter

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 7 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Create a swappable aiBriefGenerator adapter with strict normalized result schema.

Scope:
- Create/modify only:
  - webapp/services/aiBriefGenerator.js
  - tests/webapp/ai-brief-generator.test.js
- Do not wire it into routes.
- Do not enable realtime generation in request path.

Requirements:
1. Implement:
   - generateAiBrief({ sourcePayload, modelName, promptVersion, provider })
   - validateAiBriefOutput(...)
   - normalizeAiBriefOutput(...)
2. Structured result statuses:
   - ready
   - skipped
   - failed
3. Reject malformed output and enforce text length constraints.
4. Run exactly this verification before finishing:
   node --test tests/webapp/ai-brief-generator.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 8 — batch orchestration service

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 8 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Build aiBriefBatchService that connects source building, refresh decision, generation, and persistence.

Scope:
- Create/modify only:
  - webapp/services/aiBriefBatchService.js
  - tests/webapp/ai-brief-batch-service.test.js
- Do not enable scheduler yet.

Requirements:
1. Implement:
   - selectCandidateMatches(...)
   - refreshMatchBrief(...)
   - runAiBriefBatch(...)
2. Per match:
   - build source payload
   - read current row
   - compare source_hash / refresh_after / expires_at
   - skip unchanged if refresh not needed
   - otherwise generate and persist
3. Collect summary counters.
4. One failed match must not abort the whole batch.
5. Run exactly this verification before finishing:
   node --test tests/webapp/ai-brief-batch-service.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 9 — manual runner

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 9 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Add a manual runner entrypoint for AI brief batch refresh.

Scope:
- Create/modify only:
  - scheduler/AiRecommendationBriefs.js
  - scheduler/index.js
  - scripts/run-ai-briefs.js (optional if useful)
  - tests/webapp/ai-recommendation-briefs-runner.test.js
- Do not auto-enable from index.js yet.

Requirements:
1. Wire pg, loaders, store, source service, generator, batch service.
2. Return/log batch summary.
3. Provide a manual runnable entrypoint.
4. Run exactly this verification before finishing:
   node --test tests/webapp/ai-recommendation-briefs-runner.test.js

Report exact files changed and verification result. No commit.
```

---

## Prompt 10 — manual smoke fixes if needed

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 10 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md, but only if code changes are needed after a real manual smoke.

Goal:
Fix only concrete issues found during manual end-to-end smoke for AI briefs.

Scope:
- Touch only files directly required by the observed failure.
- No opportunistic refactors.

Requirements:
1. Assume a manual runner was executed and produced a specific failure.
2. Fix only the proven issue.
3. Re-run the smallest relevant verification plus any direct smoke command involved.
4. Report exact files changed and exact command results.
5. No commit.
```

---

## Prompt 11 — scheduler flag

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 11 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Gate AI briefs scheduler behind an explicit runtime flag.

Scope:
- Modify only:
  - index.js
  - optional runtime docs only if absolutely needed
- Do not broaden scheduler behavior.

Requirements:
1. Add a toggle like RUN_AI_BRIEFS=1.
2. Keep legacy scheduler disabled.
3. Ensure startup does not block HTTP on long work.
4. Prefer isolated/controlled scheduling behavior.
5. If there is a lightweight direct verification command in repo, run it; otherwise report what you validated structurally.

Report exact files changed and exact verification performed. No commit.
```

---

## Prompt 12 — observability

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 12 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Add operational logging and failure visibility to the AI briefs pipeline.

Scope:
- Modify only:
  - webapp/services/aiBriefBatchService.js
  - scheduler/AiRecommendationBriefs.js
  - webapp/services/aiBriefGenerator.js (optional if needed)
- No unrelated logging churn.

Requirements:
1. Log run summary.
2. Log per-match failures with match id/slug.
3. Include counts for candidates, full/light/skip, unchanged, ready/skipped/failed, duration, and token usage if available.
4. Avoid dumping huge payload blobs.
5. Run the smallest relevant verification for touched code.

Report exact files changed and verification result. No commit.
```

---

## Prompt 13 — final regression pass

```text
Work only in /home/fedulov/tiger_bet.

Implement only Task 13 from docs/plans/2026-06-27-tiger-bet-ai-briefs-execution-plan.md.

Goal:
Run the final regression verification set for the AI briefs feature and fix only directly blocking issues if they are clearly in scope.

Scope:
- Prefer verification-only.
- If a fix is needed, keep it minimal and limited to the failing scope.

Verification commands:
1. node --test tests/webapp/ai-brief-store.test.js tests/webapp/ai-brief-source-service.test.js tests/webapp/ai-brief-generator.test.js tests/webapp/ai-brief-batch-service.test.js tests/webapp/ai-recommendation-briefs-runner.test.js tests/webapp/recommendation-service-api.test.js tests/webapp/recommendations-api.test.js
2. cd webapp-react && npm run build

Report:
- exact commands run
- pass/fail for each
- exact files changed if any
- no commit
```
