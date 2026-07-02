# Tiger Bet User Daily Picks Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Реализовать для каждого пользователя 2 фиксированных персональных слота прогнозов (`today`, `tomorrow`), где матч выбирается только из лиг пользователя, приоритет выбора — сначала популярность, затем перспективность для ставки; один и тот же матч анализируется AI один раз и переиспользуется многими пользователями.

**Architecture:** Вводим отдельный daily-picks pipeline, не смешивая его с текущими `/recommendations` и `/feed`. Pipeline состоит из: (1) выборки user→candidate matches по любимым лигам на даты `today/tomorrow`, (2) детерминированного ранжирования матчей без LLM, (3) построения пользовательских слотов, (4) дедупа выбранных `match_id`, (5) single-run AI snapshot per unique match, (6) сохранения immutable user-slot snapshot + settlement статуса после завершения матча.

**Tech Stack:** Node.js, Fastify, PostgreSQL, existing `lib/stavkaApi.js`, existing auth (`request.user.userId`), existing favorites mapping via `public.get_sstats_league_ids($1)`, existing AI provider pieces in `webapp/services/aiBrief*`, `node --test`.

---

## Current context / assumptions

- Уже есть персональная привязка пользователя к лигам через `public.get_sstats_league_ids($1)` в `webapp/routes/home/index.js`.
- Уже есть live-pool матчей из `stavka.tv` через `lib/stavkaApi.fetchAllMatches()`.
- Уже есть AI-пайплайн для precomputed briefs (`scheduler/AiRecommendationBriefs.js` + `webapp/services/aiBrief*`), который можно переиспользовать частично, но не смешивать таблицы/контракты без необходимости.
- Пользовательский продуктовый контракт:
  - у каждого пользователя есть 2 слота: `today`, `tomorrow`;
  - слот `today` не пересчитывается днём — это вчерашний заранее выбранный `tomorrow`;
  - слот `tomorrow` считается заранее на следующий день;
  - матч берётся только из лиг конкретного пользователя;
  - если один и тот же матч подходит многим пользователям, AI анализ матча один общий;
  - выбор кандидата: сначала самый популярный матч, при равенстве — самый перспективный для ставки;
  - после завершения матча нужно показывать `зашло / не зашло` и детали факта.
- В этой итерации не делаем real-time refresh каждые 15 минут.
- В этой итерации не делаем новый cron в Hermes. Достаточно серверного nightly trigger / scheduler command внутри проекта, запускаемого 1 раз в день внешним способом или существующей средой.

---

## Proposed data model

Минимально и без оверинжиниринга — 3 сущности.

### 1) `daily_pick_match_snapshot`
Один immutable AI snapshot на уникальный матч.

Suggested fields:
- `snapshot_id` PK
- `match_id` varchar not null
- `match_slug` varchar null
- `sport_slug` varchar null
- `match_date` date not null
- `home_name` text not null
- `away_name` text not null
- `league_name` text null
- `country_name` text null
- `starts_at` timestamptz not null
- `popularity_score` numeric not null
- `betting_score` numeric not null
- `selected_bet_json` jsonb not null
- `analysis_json` jsonb not null  -- headline / brief / risk / coeff / confidence / source_url
- `analysis_status` text not null default 'ready'
- `created_at` timestamptz not null default now()
- unique (`match_id`)

Назначение: один матч = один AI snapshot для всех пользователей.

### 2) `user_daily_pick_slot`
Пользовательские слоты today/tomorrow, ссылаются на snapshot.

Suggested fields:
- `user_id` bigint not null
- `slot_date` date not null        -- дата самого матча/слота
- `slot_kind` text not null        -- 'today' or 'tomorrow' only for API convenience
- `snapshot_id` bigint not null references `daily_pick_match_snapshot`
- `match_id` varchar not null      -- денормализуем для быстрых joins/debug
- `selection_reason_json` jsonb null  -- почему выбран матч: popularity rank, tiebreak details
- `created_at` timestamptz not null default now()
- `locked_at` timestamptz not null default now()
- primary key (`user_id`, `slot_date`)

Ключевой момент: фактическая истинная ось — `slot_date`, а не today/tomorrow. API на лету маппит:
- today = row where slot_date == current_moscow_date
- tomorrow = row where slot_date == current_moscow_date + 1

`slot_kind` можно не хранить вообще; если хочется минимум сущностей — удалить его и вычислять в API.

### 3) `daily_pick_result`
Settlement результата по матчу. Можно отдельно, чтобы не мутировать snapshot сверх минимального.

Suggested fields:
- `match_id` varchar primary key
- `settlement_status` text not null  -- 'pending' | 'won' | 'lost' | 'void' | 'unknown'
- `actual_home_score` integer null
- `actual_away_score` integer null
- `actual_outcome` text null
- `resolved_at` timestamptz null
- `result_json` jsonb null
- `updated_at` timestamptz not null default now()

Если хочется ещё проще, settlement можно хранить прямо в `daily_pick_match_snapshot`. Но отдельная таблица чище: snapshot остаётся про прогноз, result — про факт.

---

## API contract to build

### `GET /daily-picks`
Авторизованный endpoint для WebApp.

Response shape:

```json
{
  "today": {
    "slot_date": "2026-07-03",
    "match_id": "12345",
    "match": "Arsenal — Chelsea",
    "league": "England: Premier League",
    "starts_at": "2026-07-03T18:30:00.000Z",
    "prediction": {
      "forecast": "П1",
      "coeff": 1.82,
      "headline": "Арсенал выглядит стабильнее",
      "brief": "...",
      "risk_note": "...",
      "confidence": "средняя"
    },
    "result": {
      "status": "pending",
      "label": "Ожидает расчёта",
      "home_score": null,
      "away_score": null
    }
  },
  "tomorrow": {
    "slot_date": "2026-07-04",
    "match_id": "98765",
    "match": "Inter — Milan",
    "league": "Italy: Serie A",
    "starts_at": "2026-07-04T19:45:00.000Z",
    "prediction": { "...": "..." },
    "result": {
      "status": "pending",
      "label": "Ожидает матча"
    }
  }
}
```

Если слота нет:

```json
{
  "today": null,
  "tomorrow": null,
  "empty_state": {
    "message": "Добавьте лиги, чтобы получать персональные прогнозы",
    "cta": { "label": "Выбрать лиги", "target": "/leagues" }
  }
}
```

---

## Ranking rules to implement

### Popularity first
Для всех матчей внутри user-league pool считаем `popularity_score`.

Минимальный MVP score:
- базовый вес лиги (`league_priority_weight`) — таблица/константа
- наличие big teams / editorial interest если это уже можно дёшево извлечь
- наличие полной линии `one_x_two`
- близость к prime-time (вечерние окна можно слегка бустить)

Suggested simple formula:
- `league_weight * 100`
- `+ 20`, если есть полноценные odds
- `+ 10`, если матч в окне 17:00–23:00 МСК
- `+ 5`, если teams/league попадают в known-popular map

### Betting tie-breaker second
Для матчей с одинаковым/близким popularity:
- полнота odds
- есть ли candidate main outcome
- line sanity (без мусора / экстремально странных коэффициентов)
- data completeness

Suggested simple formula:
- `+ 30`, если есть валидный 1X2 market
- `+ 20`, если можно выбрать явного фаворита
- `+ 10`, если коэффициент фаворита в допустимом диапазоне
- `+ 10`, если есть достаточный набор данных в match payload

### Sort order
- primary: `popularity_score DESC`
- secondary: `betting_score DESC`
- tertiary: `starts_at ASC`
- final stable tie-break: `match_id ASC`

Важно: не использовать LLM для ranking. Только deterministic cheap scoring.

---

## Execution plan

### Task 1: Document the product contract in repo

**Objective:** Зафиксировать неизменяемые правила слотов, чтобы реализация не поплыла.

**Files:**
- Create: `docs/plans/2026-07-02-daily-user-picks-contract.md`

**Steps:**
1. Описать слоты `today`/`tomorrow` через `slot_date`, а не через «пересчитываемые» поля.
2. Явно записать правило: вчерашний `tomorrow` становится сегодняшним `today` без пересчёта.
3. Явно записать правило ranking: popularity first, betting second.
4. Явно записать правило dedup: один `match_id` = один AI snapshot.
5. Явно записать rule for result settlement.

**Verification:**
- Документ понятен без разговора в Telegram.
- Нигде не остаётся двусмысленности «общая витрина vs персональная».

---

### Task 2: Add DB schema for snapshots, slots, results

**Objective:** Ввести минимальные таблицы хранения.

**Files:**
- Create: `db/sql/daily_user_picks.sql` (или существующее место для SQL в проекте)
- Optionally reference: existing DB folder / migration pattern in repo

**Steps:**
1. Проверить текущий способ хранения SQL в проекте.
2. Добавить DDL для `daily_pick_match_snapshot`.
3. Добавить DDL для `user_daily_pick_slot`.
4. Добавить DDL для `daily_pick_result`.
5. Добавить нужные индексы:
   - unique on `match_id`
   - index on `slot_date`
   - index on `(user_id, slot_date)`
6. Если нужно — добавить enum-like CHECK constraints на statuses.

**Verification:**
- DDL читается и покрывает все поля контракта.
- Нет лишних таблиц/абстракций.

**Risk note:** если в проекте уже есть стандарт функций/PLpgSQL для inserts, следовать ему. Если нет — для этой итерации допустимы прямые SQL queries из Node DAL.

---

### Task 3: Build DAL for daily picks storage

**Objective:** Изолировать чтение/запись слотов и snapshot’ов от route/business logic.

**Files:**
- Create: `webapp/services/dailyPickStore.js`
- Create: `tests/webapp/daily-pick-store.test.js`

**Methods to implement:**
- `getUserDailyPicks(pg, { userId, todayDate, tomorrowDate })`
- `upsertMatchSnapshot(pg, snapshot)`
- `upsertUserSlot(pg, slot)`
- `getExistingMatchSnapshots(pg, { matchIds })`
- `upsertMatchResult(pg, result)`

**Steps:**
1. Написать failing tests для read-path `getUserDailyPicks`.
2. Реализовать read-path.
3. Написать failing tests для `upsertMatchSnapshot`.
4. Реализовать snapshot upsert по `match_id`.
5. Написать failing tests для `upsertUserSlot`.
6. Реализовать slot upsert по `(user_id, slot_date)`.
7. Написать failing tests для `upsertMatchResult`.
8. Реализовать result upsert.

**Verification:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/daily-pick-store.test.js
```

---

### Task 4: Extract candidate-pool service from current sources

**Objective:** Получить reusable список матчей на конкретную дату + user leagues без завязки на route `/home`.

**Files:**
- Create: `webapp/services/dailyPickCandidateService.js`
- Create: `tests/webapp/daily-pick-candidate-service.test.js`
- Reference: `webapp/routes/home/index.js`
- Reference: `lib/stavkaApi.js`

**Implementation direction:**
- Не копировать весь `/home` route.
- Переиспользовать уже существующие идеи:
  - `public.get_sstats_league_ids($1)` для user league scope
  - live pool из `stavkaApi.fetchAllMatches()` для upcoming matches
- Для MVP лучше брать матчи из `stavkaApi.fetchAllMatches()` и фильтровать их по mapped league IDs / league slug mappings, а не городить второй SStats-only pipeline.

**Open integration choice:**
Перед кодом проверить, есть ли в `fetchAllMatches()` стабильный league ID/slug, который можно сопоставить с избранным league scope. Если сопоставление неудобное, тогда fallback путь — отдельный SStats-based candidate loader как в `/home`.

**Methods:**
- `getUserLeagueScope(pg, userId)`
- `getCandidateMatchesForDate({ allMatches, userLeagueScope, targetDateMsk })`
- `normalizeCandidate(match)`

**Verification:**
- Пользователь без лиг → пустой пул.
- Пользователь с лигами → только матчи из его лиг.
- Матчи на today/tomorrow фильтруются по Москве корректно.

---

### Task 5: Build deterministic ranking service

**Objective:** Отдельно считать popularity/betting scores и выбирать лучший матч.

**Files:**
- Create: `webapp/services/dailyPickRankingService.js`
- Create: `tests/webapp/daily-pick-ranking-service.test.js`

**Functions:**
- `computePopularityScore(match)`
- `computeBettingScore(match)`
- `rankCandidateMatches(matches)`
- `pickBestMatch(matches)`

**Implementation rules:**
- Не использовать LLM.
- Не смешивать ranking и persistence.
- Возвращать debug-friendly score breakdown:

```js
{
  popularity_score: 135,
  betting_score: 62,
  score_breakdown: {
    league_weight: 100,
    has_odds: 20,
    prime_time: 10,
    known_popular_teams: 5,
    betting_has_1x2: 30,
    betting_clear_favorite: 20,
    betting_line_sane: 12,
  }
}
```

**Verification:**
- Более популярный матч всегда выше менее популярного даже при немного худшем betting score.
- При одинаковой popularity выигрывает лучший betting score.
- При полном равенстве используется стабильный tie-break.

---

### Task 6: Build user slot selection service

**Objective:** Для каждого пользователя выбрать лучший матч на today и tomorrow без AI.

**Files:**
- Create: `webapp/services/dailyPickSelectionService.js`
- Create: `tests/webapp/daily-pick-selection-service.test.js`

**Functions:**
- `selectUserSlotForDate({ userId, matches, targetDate })`
- `buildUserSelections({ users, allMatches, todayDate, tomorrowDate })`

**Implementation rules:**
- На входе уже нормализованные candidate matches.
- На выходе:
  - список user slots
  - список unique selected match IDs for AI generation
- Если для user/date нет матчей, слот не создаётся.

**Verification:**
- Два пользователя с одним лучшим матчем → один unique `match_id`, два slot rows.
- Пользователь с разными лига-скоупами получает другой матч.
- today/tomorrow выбираются независимо.

---

### Task 7: Build match analysis snapshot generator

**Objective:** По unique selected matches получать и сохранять единый AI snapshot.

**Files:**
- Create: `webapp/services/dailyPickAnalysisService.js`
- Create: `tests/webapp/daily-pick-analysis-service.test.js`
- Reference: `webapp/services/aiBriefSourceService.js`
- Reference: `webapp/services/aiBriefLlmProvider.js`
- Reference: `lib/stavkaApi.js`

**Implementation direction:**
- Не изобретать новый AI adapter с нуля.
- Переиспользовать существующие source-loader и llm-provider patterns, но хранить output в `daily_pick_match_snapshot`.
- Snapshot payload должен быть immutable и self-contained.

**Output shape:**
```js
{
  match_id,
  match_slug,
  selected_bet_json: {
    forecast,
    coeff,
    market_type,
  },
  analysis_json: {
    headline,
    brief,
    risk_note,
    confidence,
    source_url,
  },
}
```

**Verification:**
- Один match_id не генерится повторно в одном run.
- Ошибка на одном матче не валит весь batch.
- Snapshot можно переиспользовать для нескольких user slots.

---

### Task 8: Build daily batch orchestrator

**Objective:** Собрать end-to-end nightly run: выбрать слоты, дедупнуть матчи, сгенерить snapshot’ы, сохранить всё в БД.

**Files:**
- Create: `webapp/services/dailyPickBatchService.js`
- Create: `scheduler/UserDailyPicks.js`
- Create: `tests/webapp/daily-pick-batch-service.test.js`

**Run flow:**
1. Определить `todayDateMsk` и `tomorrowDateMsk`.
2. Получить active users who have favorite leagues.
3. Для каждого user получить candidate matches for today/tomorrow.
4. Выбрать лучший матч per user/date.
5. Дедупнуть selected matches.
6. Для матчей без snapshot — построить AI analysis.
7. Upsert snapshot rows.
8. Upsert user slot rows.
9. Вернуть summary counts.

**Important operational rule:**
- После первого bootstrap дня batch может создавать оба слота (`today` + `tomorrow`).
- В обычном daily run можно либо:
  - пересчитывать оба slot_date детерминированно, но не менять уже locked `today`,
  - либо считать только новый `tomorrow` и полагаться на date-based mapping.

**Recommended MVP behavior:**
Считать оба target dates (`today`, `tomorrow`) на каждом run, но:
- если row for `slot_date=today` already exists, не перезаписывать его;
- если row for `slot_date=tomorrow` exists and match unchanged, leave as-is;
- если tomorrow отсутствует — создать.

Так меньше риска сломать перенос слотов.

**Verification:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/daily-pick-batch-service.test.js
```

---

### Task 9: Add settlement updater for finished matches

**Objective:** После завершения матча проставлять `won/lost/void` и фактический счёт.

**Files:**
- Create: `webapp/services/dailyPickSettlementService.js`
- Create: `tests/webapp/daily-pick-settlement-service.test.js`
- Optionally create: `scheduler/ResolveDailyPicks.js`

**Implementation direction:**
- По незакрытым snapshots/result rows fetch match detail/result.
- Определить actual outcome.
- Сопоставить с `selected_bet_json.forecast`.
- Записать settlement.

**MVP scope:**
Поддержать только те market types, которые реально используются в selected bet MVP. Не пытаться сразу покрыть все exotic markets.

**Verification:**
- Win case
- Loss case
- Void/unknown case
- Idempotent rerun

---

### Task 10: Add authenticated route `GET /daily-picks`

**Objective:** Отдать WebApp персональные слоты в одном коротком endpoint.

**Files:**
- Create: `webapp/routes/daily-picks/index.js`
- Create: `tests/webapp/daily-picks-api.test.js`

**Route behavior:**
- `request.user.userId` обязателен
- Вычислить Moscow `today/tomorrow`
- Прочитать через `dailyPickStore`
- Приклеить result rows
- Отдать payload

**Verification:**
- without auth → 401
- no favorites/no slots → empty_state
- has today only → tomorrow null
- has both → both present
- result status included

---

### Task 11: Add frontend page/block for today/tomorrow picks

**Objective:** Показать 2 карточки прогнозов в WebApp без смешивания с текущим recommendations/feed UX.

**Files:**
- Modify: `webapp-react/src/lib/api.js`
- Create or modify: `webapp-react/src/pages/HomePage.jsx` or dedicated `DailyPicksPage.jsx`
- Modify: `webapp-react/src/styles/app.css`
- Add tests if frontend utilities are extracted

**Implementation direction:**
- Самый дешёвый MVP: встроить блок в `HomePage.jsx`.
- Две карточки:
  - Сегодня
  - Завтра
- На карточке:
  - матч
  - лига
  - время
  - прогноз
  - коэффициент
  - краткий тезис
  - статус результата для today/finished match

**Verification:**
```bash
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

---

### Task 12: Wire batch command into project entrypoints

**Objective:** Сделать batch запускаемым одной командой без ручного ковыряния кода.

**Files:**
- Modify: `package.json`
- Optionally modify: `index.js` only if project already owns scheduler wiring there
- Optionally add: `scripts/run_user_daily_picks.js`

**Suggested commands:**
- `npm run picks:bootstrap`
- `npm run picks:daily`
- `npm run picks:settle`

**Important:**
Не запускать каждые 15 минут. Достаточно:
- `picks:daily` — 1 раз ночью/рано утром
- `picks:settle` — по расписанию для finished матчей, либо 1-2 раза в день

**Verification:**
- Команда запускается локально
- summary counts печатаются в stdout

---

## File map likely to change

### New backend files
- `webapp/services/dailyPickStore.js`
- `webapp/services/dailyPickCandidateService.js`
- `webapp/services/dailyPickRankingService.js`
- `webapp/services/dailyPickSelectionService.js`
- `webapp/services/dailyPickAnalysisService.js`
- `webapp/services/dailyPickBatchService.js`
- `webapp/services/dailyPickSettlementService.js`
- `webapp/routes/daily-picks/index.js`
- `scheduler/UserDailyPicks.js`
- `scheduler/ResolveDailyPicks.js` (optional)
- `scripts/run_user_daily_picks.js`
- `scripts/run_daily_pick_settlement.js` (optional)
- `db/sql/daily_user_picks.sql`

### Existing backend files likely to touch
- `package.json`
- `index.js` (only if current scheduler pattern requires it)
- maybe `server/app.js` only if route autoloading needs verification (likely not)

### Frontend files likely to touch
- `webapp-react/src/lib/api.js`
- `webapp-react/src/pages/HomePage.jsx` or new `DailyPicksPage.jsx`
- `webapp-react/src/styles/app.css`

### Tests likely to add
- `tests/webapp/daily-pick-store.test.js`
- `tests/webapp/daily-pick-candidate-service.test.js`
- `tests/webapp/daily-pick-ranking-service.test.js`
- `tests/webapp/daily-pick-selection-service.test.js`
- `tests/webapp/daily-pick-analysis-service.test.js`
- `tests/webapp/daily-pick-batch-service.test.js`
- `tests/webapp/daily-pick-settlement-service.test.js`
- `tests/webapp/daily-picks-api.test.js`

---

## Validation plan

### Backend targeted tests
```bash
cd /home/fedulov/tiger_bet && node --test \
  tests/webapp/daily-pick-store.test.js \
  tests/webapp/daily-pick-candidate-service.test.js \
  tests/webapp/daily-pick-ranking-service.test.js \
  tests/webapp/daily-pick-selection-service.test.js \
  tests/webapp/daily-pick-analysis-service.test.js \
  tests/webapp/daily-pick-batch-service.test.js \
  tests/webapp/daily-pick-settlement-service.test.js \
  tests/webapp/daily-picks-api.test.js
```

### Frontend build
```bash
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

### Manual smoke after implementation
1. Создать тестового пользователя с любимыми лигами.
2. Запустить `npm run picks:bootstrap`.
3. Проверить SQL/route, что появились `today` и `tomorrow`.
4. Открыть WebApp и убедиться, что видны 2 карточки.
5. Проверить повторный daily run — `today` не подменяется.
6. Проверить settlement run на finished матче.

---

## Risks / tradeoffs

### 1. Mapping favorites → match leagues
Самый рискованный момент — стабильное сопоставление матчей из `stavka.tv` к любимым лигам пользователя. Это нужно проверить до кодинга. Если `fetchAllMatches()` не даёт нормального league key, лучше честно уйти в SStats candidate source для этой фичи.

### 2. “Популярность” без готового сигнала
Если нет явной метрики popularity из API, нужен cheap heuristic. На MVP это нормально, но важно не называть его “истинной популярностью”, а держать как deterministic ranking policy.

### 3. Immutable today slot
Нельзя случайно перезаписывать `slot_date=today` при повторном run. Это должен прикрывать отдельный тест.

### 4. Overlap with existing recommendations
Новая витрина не должна ломать `/recommendations`. Лучше держать её отдельным endpoint и отдельным UI block.

### 5. Settlement complexity
Не надо сразу поддерживать все типы ставок. Для MVP — только тот selected market, который реально отдаёт analysis service.

---

## Recommended delivery order

Если делать минимальной кровью, то порядок такой:
1. контракт + схема БД
2. store
3. candidate loader
4. ranking
5. selection
6. analysis snapshot
7. batch orchestrator
8. API route
9. frontend
10. settlement

Если нужно ужаться ещё сильнее, settlement можно сдвинуть во вторую итерацию, но storage под него заложить сразу.

---

## Final recommendation

Для первого рабочего релиза не пытаться:
- смешивать эту механику с `/recommendations`
- строить live-refresh
- делать 10 разных сегментов
- анализировать много матчей на пользователя

Нужен узкий MVP:
- 2 слота на пользователя
- user leagues only
- popularity first, betting second
- immutable snapshot per match
- one nightly selection/build run
- simple settlement pass
