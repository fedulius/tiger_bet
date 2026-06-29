# AI Recommendation Briefs Release Contract

## Status
Approved product contract for release preparation.

## Scope
This document defines user-visible and API-visible behavior for AI recommendation briefs in the Tiger Bet recommendations flow.

It covers:
- current brief lifecycle states
- what `/recommendations` should return
- what the React recommendations UI should render
- what should stay invisible to the user

It does **not** define scheduler cadence, logging, or monitoring.

---

## Product decisions confirmed

Chosen decisions:
- `stale` brief: **show as ordinary brief with no stale marker**
- no brief at all: **show nothing**
- `source_mode = skip`: **invisible to user; just no brief**
- AI-generated label: **do not show for now**

These choices intentionally favor a quiet UI over technical transparency.

---

## Lifecycle states

### 1. `ready`
Meaning:
- a current usable brief exists for the match
- headline / brief / risk_note are available

API contract:
- `/recommendations` may include `ai_brief`
- `ai_brief` contains:
  - `headline`
  - `brief`
  - `risk_note`
  - `stale` boolean

UI contract:
- render brief block on the recommendation card
- do not show any AI badge
- do not show any status label

---

### 2. `stale`
Meaning:
- the last successful brief is still retained
- the system failed to refresh it, skipped refresh, or the row is otherwise stale

API contract:
- `/recommendations` may still include `ai_brief`
- `ai_brief.stale` may be `true`

UI contract:
- render the stale brief exactly like a normal brief
- do **not** show `stale`, `outdated`, `not updated`, or similar marker
- do **not** suppress the brief just because it is stale

Product rationale:
- stale content is considered better than empty space
- technical freshness should not add UI noise at this stage

---

### 3. `skip`
Meaning:
- source data was insufficient or unsuitable for generation
- no new user-visible brief should be created from this run

API contract:
- `/recommendations` should not expose `skip` as a user-facing state
- if there is no retained current brief, omit `ai_brief`
- if a previous current brief still exists and is eligible to serve, normal current-row rules apply

UI contract:
- no user-visible placeholder
- no `insufficient data` label
- no empty-state text inside the card

Product rationale:
- `skip` is an operational state, not a user-facing message

---

### 4. `failed`
Meaning:
- generation attempt failed

API contract:
- `/recommendations` should not expose `failed` directly to the user
- if a retained current brief exists, serve it according to normal current-row rules
- otherwise omit `ai_brief`

UI contract:
- no user-visible failure state
- no technical placeholder
- no special badge

Product rationale:
- generation failures are operational concerns handled by logs/monitoring, not by user-facing copy

---

### 5. `unchanged`
Meaning:
- source hash and freshness logic determined that regeneration was unnecessary

API contract:
- current brief remains available as usual
- `/recommendations` behavior should be indistinguishable from normal brief serving

UI contract:
- render brief normally if present
- no status marker

---

### 6. No current brief row / no available brief
Meaning:
- there is no user-visible brief to serve for the match

API contract:
- omit `ai_brief` from the recommendation item, or return it as null-equivalent depending on existing implementation conventions
- do not emit a synthetic placeholder payload

UI contract:
- show no brief block
- keep the rest of the recommendation card intact
- do not show placeholder text like `brief soon`, `AI analysis unavailable`, or `insufficient data`

---

## API surface expectations

For a recommendation item with a brief, the expected shape is:

```json
{
  "ai_brief": {
    "headline": "Фокус на низовой сценарий",
    "brief": "По текущей линии и структуре популярных ставок рынок осторожно поддерживает более закрытый матч без большого тотала.",
    "risk_note": "Риск — быстрый ранний гол может сломать низовой сценарий.",
    "stale": false
  }
}
```

Notes:
- `stale` may be `true`, but UI currently ignores that distinction visually
- API may preserve the `stale` field for future use, debugging, and tests
- user-visible behavior must remain the same for `ready` and `stale`

---

## UI rendering contract

Recommendations card behavior:
- if `ai_brief` exists:
  - render `headline`
  - render `brief`
  - render `risk_note`
- if `ai_brief` does not exist:
  - render nothing in the brief area
- do not show:
  - `AI`
  - `stale`
  - `updated`
  - `insufficient data`
  - `brief coming soon`

This means the user only sees a brief when one is available; otherwise the card stays visually clean.

---

## Testing implications

Minimum tests that should match this contract:
- `ready` brief is returned and rendered
- `stale` brief is returned and rendered with no special UI marker
- `skip` with no retained brief results in no `ai_brief`
- `failed` with no retained brief results in no `ai_brief`
- missing brief results in no brief block in UI
- slug-only/synthetic recommendation items can still receive `ai_brief`

Suggested target files:
- `tests/webapp/recommendations-api.test.js`
- `tests/webapp/ai-brief-store.test.js`
- future frontend/UI recommendation rendering test if a harness is added

---

## Non-goals for this release contract

Not decided here:
- scheduler cadence
- alert thresholds
- prompt wording strategy
- cost controls
- whether a future release should visually mark stale data

Those belong to later release-readiness work.

---

## Summary

Release contract in one sentence:

> Show a brief when one is available, including stale retained briefs, and otherwise show nothing — with no user-facing technical status, no placeholder, and no AI label.
