# AI Recommendation Briefs Operations Runbook

## Purpose
This runbook defines the production trigger path for AI recommendation briefs.

## Trigger model
The trigger is **external**.

Business logic lives in project code, but the job is started by an external scheduler/cron and **not** by the webapp runtime.

Explicit non-goal for this release stage:
- do not auto-start this job inside the long-lived node/web server process
- do not rely on in-process timers for the canonical production schedule

---

## Canonical production command

Run from project root:

```bash
npm run ai:recommendation-briefs:scheduled
```

Resolved command:

```bash
node scripts/run_ai_recommendation_briefs.js --run-type scheduled
```

Notes:
- the script loads `.env` from the project root
- it must be executed with working directory set to the repo root
- non-zero exit code means the run failed and should be visible to the scheduler/ops layer

---

## Scheduled run times

Required schedule:
- 08:00 `Europe/Moscow`
- 15:00 `Europe/Moscow`
- 21:00 `Europe/Moscow`

These are the only required production trigger times for now.

---

## Cron examples

### Option A: crontab with `CRON_TZ`

```cron
CRON_TZ=Europe/Moscow
0 8,15,21 * * * cd /absolute/path/to/tiger_bet && /usr/bin/npm run ai:recommendation-briefs:scheduled >> /var/log/tiger_bet-ai-briefs.log 2>&1
```

This is the simplest preferred form when the host cron supports `CRON_TZ`.

### Option B: crontab without `CRON_TZ`

If the host cron does not support `CRON_TZ`, schedule the equivalent times in the host timezone instead. In that case, ops must document the conversion explicitly alongside the deployed crontab.

---

## Working directory and environment requirements

The scheduler must run with:
- working directory = repo root
- readable `.env` at repo root
- access to Postgres and all existing app credentials used by the brief provider and Stavka loaders

Minimum assumption:

```bash
cd /absolute/path/to/tiger_bet
npm run ai:recommendation-briefs:scheduled
```

---

## Expected output

A successful run prints JSON summary to stdout.

Current example shape:

```json
{
  "candidates": 1,
  "full": 0,
  "light": 0,
  "skip": 1,
  "unchanged": 0,
  "ready": 0,
  "failed": 0,
  "skipped": 1,
  "stale_transitions": 0,
  "processed": 1,
  "results": []
}
```

A failed run exits non-zero and prints the error to stderr.

---

## Manual verification commands

### Dry operational smoke

```bash
cd /absolute/path/to/tiger_bet
npm run ai:recommendation-briefs:scheduled
```

### Manual limited run

```bash
cd /absolute/path/to/tiger_bet
npm run ai:recommendation-briefs -- --limit 1 --run-type manual
```

Use the limited manual run when verifying DB/API behavior without waiting for the scheduled window.

---

## Release contract for trigger ownership

For this release:
- **canonical trigger:** external cron/scheduler
- **canonical schedule:** 08:00 / 15:00 / 21:00 Europe/Moscow
- **canonical command:** `npm run ai:recommendation-briefs:scheduled`
- **not canonical:** in-process web runtime timers

If a future release adds another trigger path, this document must be updated first.
