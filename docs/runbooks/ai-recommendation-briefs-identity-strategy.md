# AI Recommendation Briefs Identity Strategy

## Purpose
This document defines how recommendation items are identified when attaching precomputed AI briefs in the request path.

It exists to prevent ambiguity between:
- normal live recommendation items with a real numeric `match_id`
- synthetic recommendation items whose UI-visible `id` is not a real upstream match identifier
- fallback cases where only `match_slug` can safely connect the item to a stored brief

---

## Short rule

Use this identity order:

1. **Numeric `match_id` is canonical** for current-brief lookup.
2. If the item does **not** have a real numeric `match_id`, treat it as **synthetic**.
3. Synthetic items may still be enriched by **`match_slug`** when a non-empty slug exists.
4. If neither a numeric `match_id` nor a usable `match_slug` exists, skip enrichment and leave the item unchanged.

---

## Why this exists

Recommendation items expose multiple identifiers for different concerns:

- `id` — general UI/item identity, not guaranteed to be a real upstream match key
- `match_id` — preferred data identity for DB joins and brief lookup
- `match_slug` — fallback identity when `match_id` is synthetic or unavailable

Without an explicit contract, code can accidentally:
- treat synthetic `id` values as real DB keys
- miss valid briefs for slug-only items
- overwrite the meaning of `id`
- attach the wrong brief when mixed numeric and synthetic items appear in one payload

---

## Definitions

### 1. Real live item
A recommendation item whose `match_id` is a finite numeric value.

Example:

```json
{
  "id": "stavka-501",
  "match_id": 501,
  "match_slug": "arsenal-chelsea-2026-06-29",
  "match": "Arsenal — Chelsea"
}
```

Meaning:
- use `match_id = 501` for current brief lookup
- `match_slug` is useful metadata, but not the primary key for enrichment

### 2. Synthetic item
A recommendation item whose `match_id` is missing, null, or non-numeric.

Example:

```json
{
  "id": "ts_1234567890",
  "match_id": "ts_1234567890",
  "match_slug": "real-upstream-slug",
  "match": "Team X — Team Y"
}
```

Meaning:
- do **not** use `match_id` for DB lookup
- treat the item as synthetic
- if `match_slug` exists, use it as the enrichment fallback key

### 3. Slug-less synthetic item
A synthetic item with no usable `match_slug`.

Example:

```json
{
  "id": "ts_no_slug_1",
  "match_id": "ts_no_slug_1",
  "match_slug": null
}
```

Meaning:
- there is no safe lookup key for the current brief store
- request-path enrichment must skip this item
- the API should return the base recommendation item unchanged

---

## Request-path enrichment contract

Current route behavior should follow this sequence:

1. Collect all recommendation items.
2. Split them into:
   - items with real numeric `match_id`
   - items with synthetic/non-numeric `match_id` but non-empty `match_slug`
3. Query current briefs in bulk:
   - `match_id IN (...)` for numeric items
   - `match_slug IN (...)` for synthetic slug-backed items
4. Attach `ai_brief` only when the current row status is:
   - `ready`, or
   - `stale`
5. Leave all other items unchanged.
6. Never call the LLM from the request path.

---

## Storage contract

For current-brief persistence:

- the current table may store both `match_id` and `match_slug`
- `match_id` remains the primary operational identity when available
- `match_slug` exists to support synthetic/slotted/fallback recommendation items that still map to a real match

This means `match_slug` is not just decorative metadata; it is a supported lookup path for enrichment.

---

## Non-goals

This strategy does **not** mean:
- `id` should become a DB join key
- every synthetic item must always receive a brief
- missing `match_slug` should be replaced with a fabricated value
- request-time code should invent placeholders when identity is incomplete

If identity is incomplete, the correct behavior is **no enrichment**, not fake recovery.

---

## Examples

### Example A — numeric item
Input item:

```json
{
  "id": "stavka-45",
  "match_id": 45,
  "match_slug": "roma-milan",
  "match": "Roma — Milan"
}
```

Lookup path:
- use `match_id = 45`

### Example B — synthetic item with slug
Input item:

```json
{
  "id": "ts_999",
  "match_id": "ts_999",
  "match_slug": "real-match-slug",
  "match": "Team A — Team B"
}
```

Lookup path:
- ignore synthetic `match_id`
- use `match_slug = real-match-slug`

### Example C — synthetic item without slug
Input item:

```json
{
  "id": "ts_1000",
  "match_id": "ts_1000",
  "match_slug": null,
  "match": "Unknown — Unknown"
}
```

Lookup path:
- none
- return item unchanged

---

## Testing expectations

Minimum integration coverage should prove:
- numeric items enrich through `match_id`
- synthetic items enrich through `match_slug`
- `stale` rows still attach `ai_brief`
- slug-less synthetic items do not trigger unsafe fallback behavior
- mixed numeric and synthetic items work in the same `/recommendations` response

Relevant tests:
- `tests/webapp/recommendations-api.test.js`
- `tests/webapp/ai-brief-store.test.js`

---

## Summary

Identity strategy in one sentence:

> Use numeric `match_id` whenever it is real, fall back to `match_slug` only for synthetic items, and if neither is usable, skip enrichment instead of guessing.