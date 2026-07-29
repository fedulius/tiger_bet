# Global Pick Structured Contract Implementation Plan

> **For Hermes:** Implement with test-driven development in small verified steps.

**Goal:** Prevent the global recommended-pick LLM pipeline from producing technically invalid selector fields or invented analyst evidence paths.

**Architecture:** Keep the analyst, selector, and writer roles unchanged. Tighten provider JSON Schema for selector quality/warning coupling and replace analyst free-form evidence `path`/`value` with runtime-owned evidence IDs; the backend resolves selected IDs back to canonical facts.

**Tech Stack:** Node.js, node:test, OpenAI-compatible `response_format: json_schema`.

---

### Task 1: Constrain selector cross-field output

**Files:**
- Modify: `webapp/services/recommendedPickValueSelectorService.js`
- Test: `tests/webapp/recommended-pick-value-selector-service.test.js`

1. Add a failing schema-level test asserting `anyOf` branches: `strong → warning:null`, `fallback → warning:string,minLength:1`.
2. Run focused test and confirm it fails because current schema has independent fields.
3. Implement the two schema branches while retaining the runtime validator as defence in depth.
4. Run focused selector tests.

### Task 2: Replace analyst evidence paths with evidence IDs

**Files:**
- Modify: `webapp/services/recommendedPickAnalystService.js`
- Test: `tests/webapp/recommended-pick-analyst-service.test.js`

1. Add a failing test for an output carrying `evidence_ids` and assert generated schema uses allowed ID enums.
2. Build a deterministic scalar evidence catalog from the analyst payload.
3. Pass only evidence IDs to the model; resolve selected IDs server-side into canonical `{path,value,interpretation}` records.
4. Reject unknown or duplicate IDs, preserve the existing no-odds analyst boundary.
5. Run focused analyst tests.

### Task 3: Pipeline regression and real dry run

**Files:**
- Modify tests only if pipeline integration requires fixtures: `tests/webapp/global-recommended-pick-service.test.js`

1. Prove selector schema is supplied to the provider and analyst snapshots contain runtime-resolved evidence.
2. Run analyst, selector, writer and global-pipeline test files.
3. Run `node scripts/run_global_recommended_pick.js --dry-run`; inspect terminal reason/traces.
4. Commit scoped files, push `tiger_hermes`, restart PM2 `tiger_bet`, and verify `/home/recommended-pick` using preview auth.
