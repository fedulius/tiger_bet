# Tiger Bet Daily Picks — Short Plan Without DB Design

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Реализовать персональные daily picks для `tiger_bet`: у каждого пользователя есть 2 слота (`today`, `tomorrow`), матч выбирается только из его лиг, приоритет выбора — сначала популярность, при равенстве — перспективность для ставки.

**What is intentionally out of scope here:** проектирование таблиц, индексов, миграций и SQL-схемы. БД пользователь делает сам; код должен опираться на store-layer контракт.

---

## Продуктовый контракт

### Что видит пользователь
- слот **Сегодня**
- слот **Завтра**

### Главное правило
- прогноз на `tomorrow`, рассчитанный вчера, на следующий день становится `today`
- он **не пересчитывается** и **не меняется**

### Из чего выбирается матч
- только из лиг, выбранных конкретным пользователем

### Как выбирается матч
1. сначала берём **самый популярный матч**
2. если таких несколько — берём **самый перспективный для ставки**

### Как считается AI
- AI считается **на уникальный матч**, а не на пользователя
- если один и тот же матч подходит многим пользователям, используется один общий snapshot анализа

### Что ещё показываем
После завершения матча:
- зашла ставка / не зашла ставка
- фактический счёт
- итог по выбранному прогнозу

---

## Архитектура

Нужны 6 прикладных слоёв:

1. `dailyPickStore`
2. `dailyPickCandidateService`
3. `dailyPickRankingService`
4. `dailyPickSelectionService`
5. `dailyPickAnalysisService`
6. `dailyPickBatchService`
7. `dailyPickSettlementService`
8. route `GET /daily-picks`
9. frontend block/page for today/tomorrow picks

---

## Контракт store-layer

Этот слой подстроим под ту БД, которую ты сделаешь.

Нужные методы:

```js
getUserLeagueScope(userId)
getActiveUsersWithFavorites()
getUserDailyPicks({ userId, todayDate, tomorrowDate })
getExistingMatchSnapshots({ matchIds })
upsertMatchSnapshot(snapshot)
upsertUserSlot(slot)
getUnsettledPredictions()
upsertMatchResult(result)
```

Бизнес-логика не должна знать ничего о конкретных таблицах.

---

## Порядок реализации

### Этап 1. Store-layer контракт
**Что делаем:**
- создаём `webapp/services/dailyPickStore.js`
- описываем и реализуем минимальный контракт чтения/записи
- временно можно сделать заглушечный in-memory/fake слой для unit-тестов, пока БД-слой не готов

**Файлы:**
- `webapp/services/dailyPickStore.js`
- `tests/webapp/daily-pick-store.test.js`

**Что проверить:**
- читаются today/tomorrow слоты
- сохраняется snapshot по матчу
- сохраняется slot по пользователю
- сохраняется result

---

### Этап 2. Candidate loader
**Что делаем:**
- получаем для пользователя список матчей на `today` и `tomorrow`
- фильтруем только по его лигам
- нормализуем матч в единый внутренний формат

**Файлы:**
- `webapp/services/dailyPickCandidateService.js`
- `tests/webapp/daily-pick-candidate-service.test.js`

**Источники, которые проверить перед кодом:**
- `lib/stavkaApi.js`
- `webapp/routes/home/index.js`

**Что проверить:**
- без лиг → пусто
- с лигами → только релевантные матчи
- today/tomorrow фильтруются по Москве корректно

---

### Этап 3. Ranking service
**Что делаем:**
- считаем `popularity_score`
- считаем `betting_score`
- сортируем по правилу:
  1. popularity desc
  2. betting desc
  3. starts_at asc
  4. stable tie-break

**Файлы:**
- `webapp/services/dailyPickRankingService.js`
- `tests/webapp/daily-pick-ranking-service.test.js`

**Что проверить:**
- более популярный матч всегда выше
- при равной популярности побеждает более сильный betting score
- сортировка стабильна

---

### Этап 4. User selection service
**Что делаем:**
- выбираем лучший матч для `today`
- выбираем лучший матч для `tomorrow`
- собираем user slots
- делаем дедуп уникальных `match_id` для AI

**Файлы:**
- `webapp/services/dailyPickSelectionService.js`
- `tests/webapp/daily-pick-selection-service.test.js`

**Что проверить:**
- два пользователя могут получить один и тот же матч
- пользователи с разными лигами получают разные матчи
- `today` и `tomorrow` выбираются независимо

---

### Этап 5. Match analysis snapshot service
**Что делаем:**
- для каждого уникального матча получаем/строим AI snapshot
- переиспользуем существующие куски AI briefs, где это удобно
- snapshot делаем immutable

**Файлы:**
- `webapp/services/dailyPickAnalysisService.js`
- `tests/webapp/daily-pick-analysis-service.test.js`

**Посмотреть перед реализацией:**
- `webapp/services/aiBriefSourceService.js`
- `webapp/services/aiBriefLlmProvider.js`
- `scheduler/AiRecommendationBriefs.js`

**Что проверить:**
- один матч не анализируется повторно в одном run
- ошибка одного матча не валит весь batch
- snapshot подходит для reuse многим users

---

### Этап 6. Daily batch orchestration
**Что делаем:**
- nightly run получает пользователей
- для каждого пользователя строит кандидатов
- выбирает слоты today/tomorrow
- дедупит матчи
- строит недостающие snapshots
- сохраняет user slots

**Файлы:**
- `webapp/services/dailyPickBatchService.js`
- `scheduler/UserDailyPicks.js`
- `tests/webapp/daily-pick-batch-service.test.js`

**Важное правило:**
- `today` нельзя случайно перезаписать повторным запуском
- вчерашний `tomorrow` должен спокойно переехать в `today`

**Что проверить:**
- bootstrap создаёт оба слота
- обычный run не ломает уже зафиксированный today
- batch summary показывает counts по users/matches/snapshots

---

### Этап 7. Settlement service
**Что делаем:**
- после завершения матча получаем факт
- определяем outcome
- считаем `won/lost/void/pending`
- сохраняем результат

**Файлы:**
- `webapp/services/dailyPickSettlementService.js`
- `tests/webapp/daily-pick-settlement-service.test.js`
- optionally `scheduler/ResolveDailyPicks.js`

**Что проверить:**
- win case
- loss case
- unknown/void case
- повторный запуск идемпотентен

---

### Этап 8. API route
**Что делаем:**
- добавляем `GET /daily-picks`
- отдаём пользователю его `today` и `tomorrow`
- в payload включаем prediction + result

**Файлы:**
- `webapp/routes/daily-picks/index.js`
- `tests/webapp/daily-picks-api.test.js`

**Что проверить:**
- без auth → 401
- без лиг/без слотов → empty state
- при наличии слотов → оба блока приходят корректно

---

### Этап 9. Frontend
**Что делаем:**
- показываем две карточки: Сегодня / Завтра
- выводим матч, лигу, время, прогноз, коэффициент, тезис, статус результата

**Файлы:**
- `webapp-react/src/lib/api.js`
- `webapp-react/src/pages/HomePage.jsx` или отдельная страница
- `webapp-react/src/styles/app.css`

**Что проверить:**
- карточки рендерятся без моков
- empty state выглядит нормально
- today/tomorrow визуально не путаются
- build проходит

---

## Команды проверки

### Backend
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

### Frontend
```bash
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

---

## Ключевые риски

### 1. Mapping лиг пользователя к матчам
Самый важный технический риск. Надо сначала проверить, чем лучше матчить:
- через `stavkaApi.fetchAllMatches()`
- или через SStats-поток как в `/home`

### 2. Популярность
Если в источнике нет готовой популярности, делаем cheap deterministic heuristic. Это нормально для MVP.

### 3. Неперезапись today
Это надо закрыть отдельным тестом, иначе легко сломать доверие к продукту.

### 4. Не смешивать с `/recommendations`
Daily picks лучше держать отдельным endpoint и отдельным UI-блоком.

---

## Рекомендуемый порядок внедрения

1. store-layer контракт
2. candidate loader
3. ranking
4. selection
5. analysis snapshot
6. batch orchestrator
7. API route
8. frontend
9. settlement

---

## MVP definition

Первый релиз считается успешным, если:
- у пользователя есть 2 слота: today/tomorrow
- матч для каждого слота берётся только из его лиг
- матч выбирается по правилу popularity first, betting second
- один матч анализируется AI один раз
- `today` не пересчитывается после наступления дня
- после матча можно показать результат
