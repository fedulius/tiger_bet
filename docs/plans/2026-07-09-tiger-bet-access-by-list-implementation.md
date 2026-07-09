# Tiger Bet — Implementation Plan: Access by user list

> **For Hermes:** Use this plan for step-by-step implementation.

**Goal:** Allow access to the webapp only for users from an explicit allowlist, while preserving Telegram auth and localhost preview.

**Architecture:** Keep current Telegram identity flow, but replace the current `external.public_user` only lookup with a combined access-check query that uses `external.public_user + public.user_access + public.access_scope`. Preview route stays fully independent.

**Priority:** `admin` scope (id=1) always takes precedence over `webapp` scope (id=2). One record per user is enough.

---

## Live DB schema

| Table | Key columns |
|---|---|
| `external.public_user` | `system_user_id`, `user_id`, `system_id` |
| `public.user` | `user_id` |
| `public.access_scope` | `access_scope_id` (1=admin, 2=webapp, 3=vip_predictions) |
| `public.user_access` | `user_id`, `access_scope_id`, `is_allowed` |

---

## Task 1: Update auth DAL access check

**Files:**
- Modify: `webapp/routes/auth/DAL.js`

Replace `checkUser()` with `checkWebappAccess()`:

```sql
SELECT
  u.user_id,
  epu.system_user_id AS telegram_user_id,
  ua.is_allowed,
  asc.access_scope_name AS granted_scope
FROM external.public_user epu
JOIN public.user u ON u.user_id = epu.user_id
JOIN public.access_scope asc ON asc.access_scope_name IN ('admin', 'webapp')
JOIN public.user_access ua
  ON ua.user_id = u.user_id
 AND ua.access_scope_id = asc.access_scope_id
WHERE epu.system_id = 1
  AND epu.system_user_id = $1
  AND ua.is_allowed = true
ORDER BY asc.access_scope_id ASC
LIMIT 1;
```

Returns: `{ user_id, telegram_user_id, is_allowed, granted_scope }` or `null`.

---

## Task 2: Update auth route semantics

**Files:**
- Modify: `webapp/routes/auth/index.js`

Behavior:
- `dal.checkWebappAccess(telegramUserId)` returns `null` → `403`, reason `not_found`
- Returns row with `is_allowed = false` → `403`, reason `inactive_access`
- Returns row with `is_allowed = true` → `200` + JWT
- `granted_scope` added to `auth.login_success` meta
- `reason` added to `auth.login_forbidden` meta
- JWT shape unchanged: `{ userId, telegram_user_id, profile }`
- `/auth/preview` unchanged

---

## Task 3: Update tests

**Files:**
- Modify: `tests/webapp/auth-api.test.js`
- Modify: `tests/webapp/event-log-api.test.js`

Test cases:
1. allowed user with `webapp` scope → `200` + JWT
2. allowed user with `admin` scope → `200` + JWT
3. no access mapping → `403`
4. inactive access (`is_allowed = false`) → `403`
5. invalid init data → `401`
6. preview localhost → `200`

---

## Task 4: Frontend denied state

**Files:**
- Modify pages that call `auth()`: `HomePage`, `MatchPage`, `PredictionPage`, `RecommendationsPage`

Unified behavior:
- `error.status === 403` → "Доступ к приложению пока не открыт" / "Ваш Telegram-аккаунт не добавлен в список доступа"
- Other errors → generic auth error
- Preview localhost → unchanged

---

## Task 5: Verification

```bash
node --test tests/webapp/auth-api.test.js tests/webapp/event-log-api.test.js
curl -i http://127.0.0.1:8084/auth/preview
# protected route with token
```

SQL log check:
```sql
SELECT event_name, meta FROM logger.v_user_event_log_enriched
WHERE event_name IN ('auth.login_success','auth.login_forbidden')
ORDER BY user_event_log_id DESC LIMIT 20;
```

---

## Acceptance criteria

- [ ] `/auth` admin user → `200`, `granted_scope=admin`
- [ ] `/auth` webapp user → `200`, `granted_scope=webapp`
- [ ] `/auth` no access mapping → `403`
- [ ] `/auth` inactive access → `403`
- [ ] `/auth` invalid init data → `401`
- [ ] `/auth/preview` localhost → `200`
- [ ] JWT has `userId`, `telegram_user_id`, `profile`
- [ ] Frontend shows Russian denied screen for `403`
- [ ] Logger has `reason` for forbidden, `granted_scope` for success
