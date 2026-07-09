# Tiger Bet — ТЗ на доступ в приложение по списку пользователей

> Для Hermes: выполнять поэтапно, начиная с backend auth-layer. БД-проектирование пользователь делает сам; со стороны приложения использовать DB как контракт.

**Цель:** ограничить доступ к webapp только пользователям, явно включённым в список доступа, сохранив текущий Telegram initData auth и localhost preview-режим.

**Архитектура:** решение строится вокруг одного backend gate в `/auth`: Telegram-пользователь проходит криптографическую проверку initData, затем app-layer делает lookup в БД по telegram user id и пускает только разрешённых пользователей. Preview-режим `/auth/preview` остаётся отдельным контуром для локальной разработки и не должен случайно открывать production-доступ.

**Tech Stack:** Fastify, JWT, Telegram WebApp initData, Postgres через существующий DAL (`webapp/routes/auth/DAL.js`), React webapp (`webapp-react`), node:test.

---

## 1. Что уже есть сейчас

### Реализовано
- `/auth` валидирует Telegram initData и выдаёт JWT.
- После валидации `/auth` уже делает lookup через `DAL.checkUser(telegramUserId)`.
- Если пользователь не найден, сервер возвращает `403 Access denied`.
- `/auth/preview` для localhost выдаёт preview JWT без Telegram initData.
- Route-level логирование auth-событий уже подключено:
  - `auth.login_success`
  - `auth.login_forbidden`
  - `auth.preview_login`

### Фактический текущий контракт БД со стороны app-layer
Сейчас backend ожидает, что lookup по Telegram user id вернёт строку минимум с:
- `user_id`
- `system_user_id`
- `system_id`

Текущий запрос идёт в:
- `external.public_user`
- условие: `system_user_id = telegramUserId AND system_id = 1`

---

## 2. Бизнес-требование

Нужно сделать явную модель **доступа по списку пользователей**:
- в приложение пускаются только пользователи, которые есть в разрешённом списке;
- все остальные получают понятный отказ доступа;
- локальный preview для разработки продолжает работать отдельно;
- app-layer не должен размазывать правила доступа по разным роутам — решение должно жить в auth-layer;
- результат должен быть пригоден для дальнейшего расширения (например, disabled/manual revoke/VIP/role-based access), но без лишней платформы прямо сейчас.

---

## 3. Требования к поведению

### 3.1 `/auth` production-flow
1. Клиент присылает `x-telegram-init-data`.
2. Backend валидирует hash и freshness как сейчас.
3. Backend извлекает `telegram_user_id`.
4. Backend делает DB lookup разрешения пользователя.
5. Если пользователь **разрешён**:
   - возвращает `200`
   - выдаёт JWT
   - пишет `auth.login_success`
6. Если пользователь **не разрешён**:
   - возвращает `403`
   - не выдаёт JWT
   - пишет `auth.login_forbidden`
7. Если Telegram initData битый:
   - возвращает `401`
   - это не считается whitelist-отказом

### 3.2 `/auth/preview` localhost-flow
- должен остаться доступным только с loopback IP;
- должен продолжать выдавать preview JWT для локальной разработки;
- не должен зависеть от production allowlist;
- должен оставаться отдельным логическим режимом (`access_mode=preview`).

### 3.3 Frontend UX
При `403 Access denied` frontend должен уметь показать понятное сообщение, а не просто падать generic error-экраном.

Минимальный UX-контракт:
- если `/auth` вернул `403`, пользователь видит понятный текст вроде:
  - `Доступ к приложению пока не открыт`
  - `Ваш Telegram аккаунт не добавлен в список доступа`
- текст должен быть на русском;
- preview localhost flow не должен ломаться.

---

## 4. Контракт с БД (без навязывания схемы)

Так как DB-слой проектируешь ты, для app-layer достаточно зафиксировать **контракт**, а не конкретную схему.

Backend нужен один метод вида:
- `checkUserAccessByTelegramId(telegramUserId)`

Ожидаемое поведение метода:
- на вход: `telegramUserId bigint`
- на выход:
  - либо `null/[]`, если доступа нет;
  - либо объект разрешённого пользователя, содержащий как минимум:
    - `user_id`
    - `telegram_user_id` или эквивалентный source id
    - признак, что доступ активен

### Минимальные инварианты DB-контракта
- lookup должен быть однозначным;
- disabled/blocked пользователь должен считаться **неразрешённым**;
- app-layer не должен сам гадать по нескольким строкам;
- если в БД есть user mapping, но доступ выключен, `/auth` должен вернуть `403`.

### Что НЕ нужно в первом этапе
- роли
- тарифы
- ACL по фичам
- expiry windows
- админка управления
- self-service invite flow

Это можно добавить потом.

---

## 5. Что надо поменять в коде

### 5.1 Backend auth DAL
**Файл:** `webapp/routes/auth/DAL.js`

Нужно:
- выделить lookup доступа в явно названный метод;
- убрать двусмысленность текущего `checkUser`, чтобы было понятно, что это именно проверка allowlist/access;
- если потребуется, изменить SQL под новый DB-контракт.

Ожидаемый результат:
- DAL отвечает только за получение access-decision данных из БД;
- бизнес-решение `пускать/не пускать` остаётся в route handler.

### 5.2 Backend auth route
**Файл:** `webapp/routes/auth/index.js`

Нужно:
- использовать новый более явный DAL method;
- аккуратно разделить причины отказа:
  - `401` — невалидный Telegram auth
  - `403` — валидный Telegram user, но нет доступа по списку
- сохранить current JWT shape:
  - `userId`
  - `telegram_user_id`
  - `profile`
- сохранить event logging.

Желательно дополнительно в `auth.login_forbidden` meta логировать reason, например:
- `reason: 'allowlist_miss'`
- `reason: 'inactive_access'`

Это поможет аналитике.

### 5.3 Frontend auth error handling
**Файл:** `webapp-react/src/lib/api.js`

Нужно:
- не терять payload у `403`;
- пробрасывать код и тело ошибки дальше в UI слой.

Сейчас уже есть `error.status` и `error.payload` в `getJson()`, это хорошо. Нужно убедиться, что UI действительно умеет это различать.

### 5.4 Frontend экран/состояние отказа
**Файлы:** определить по текущей точке входа webapp-react auth bootstrap

Нужно:
- отрисовать понятный state для `403`;
- отдельно оставить generic state для `401/500`;
- не ломать localhost preview.

---

## 6. Логирование и наблюдаемость

Нужно сохранить и уточнить текущие события:

### `auth.login_success`
Meta минимум:
- `auth_provider: 'telegram'`
- `access_mode: 'allowed'`
- `is_preview: false`

### `auth.login_forbidden`
Meta минимум:
- `auth_provider: 'telegram'`
- `access_mode: 'denied'`
- `is_preview: false`
- `reason: 'allowlist_miss' | 'inactive_access'`

### `auth.preview_login`
Без изменений:
- `auth_provider: 'preview'`
- `access_mode: 'preview'`
- `is_preview: true`

---

## 7. Acceptance criteria

Фича считается готовой, когда выполняется всё ниже:

### API
- [ ] `GET /auth` с валидным Telegram initData и разрешённым user → `200` + JWT
- [ ] `GET /auth` с валидным Telegram initData и неразрешённым user → `403`
- [ ] `GET /auth` с битым initData → `401`
- [ ] `GET /auth/preview` с localhost → `200`
- [ ] `GET /auth/preview` не с localhost → `403`

### JWT
- [ ] для разрешённого пользователя JWT содержит корректные `userId`, `telegram_user_id`, `profile`
- [ ] для запрещённого пользователя JWT не выдаётся

### Frontend UX
- [ ] при `403` пользователь видит понятное сообщение про отсутствие доступа
- [ ] localhost preview продолжает работать

### Logging
- [ ] `auth.login_success` пишется при разрешённом входе
- [ ] `auth.login_forbidden` пишется при отказе по allowlist
- [ ] `auth.preview_login` остаётся рабочим

---

## 8. Тесты, которые надо иметь

### Backend tests
**Файл:** `tests/webapp/auth-api.test.js`

Добавить/обновить кейсы:
1. valid initData + allowed user → `200`
2. valid initData + missing user → `403`
3. valid initData + inactive/disabled user → `403`
4. invalid hash → `401`
5. localhost preview allowed → `200`
6. non-local preview denied → `403`

### Logging tests
**Файл:** `tests/webapp/event-log-api.test.js`

Добавить/уточнить кейсы:
1. forbidden auth пишет `auth.login_forbidden`
2. meta содержит ожидаемый `reason`

### Frontend tests
Если есть текущий тестовый слой для auth bootstrap/UI состояния — добавить кейс на `403` и пользовательский текст отказа.
Если слоя нет — минимум покрыть это на уровне небольшой isolated логики/компонента.

---

## 9. Предлагаемый порядок реализации

### Этап 1 — backend contract
- уточнить DB-контракт allowlist lookup
- обновить `DAL.js`
- не менять ещё UI

### Этап 2 — auth route semantics
- развести `401` vs `403`
- добавить/уточнить deny reasons
- прогнать backend tests

### Этап 3 — frontend denied state
- показать понятный экран отказа
- не сломать preview flow

### Этап 4 — verification
Проверить реально:
- локальный preview flow
- allowed user flow
- denied user flow
- логи событий

---

## 10. Команды проверки

### Backend tests
```bash
node --test tests/webapp/auth-api.test.js tests/webapp/event-log-api.test.js
```

### Локальная живая проверка preview
```bash
curl -i http://127.0.0.1:8084/auth/preview
```

### Проверка защищённого маршрута после auth
1. получить token через `/auth` или `/auth/preview`
2. сходить в защищённый route, например:
```bash
curl -i -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:8084/history?sample=1
```

### Проверка логов
SQL-проверка последних auth-событий:
```sql
SELECT user_event_log_id, event_ts, telegram_user_id, webapp_user_id, path, status_code, meta
FROM logger.v_user_event_log_enriched
WHERE event_name IN ('auth.login_success', 'auth.login_forbidden', 'auth.preview_login')
ORDER BY user_event_log_id DESC
LIMIT 20;
```

---

## 11. Что НЕ входит в это ТЗ
- админский UI управления списком доступа
- Telegram-команды для выдачи доступа
- роли/подписки/VIP-уровни
- feature flags по пользователям
- audit history изменений allowlist

---

## 12. Коротко по сути

Нужно сделать один надёжный gate в `/auth`, который:
- доверяет только валидному Telegram initData;
- потом пускает только пользователя из разрешённого списка;
- возвращает `403`, если доступа нет;
- не ломает localhost preview;
- пишет понятные auth-события в logger.
