# Tiger Bet Analytics-First Daily Picks MVP — план на утверждение

> План подготовлен с помощью `gpt-5.6-terra` (`openai-codex`). Реализация не выполнялась.

## 1. Цель

Перевести daily picks из схемы:

```text
Stavka.tv popular-bets / risk_bets
  → LLM выбирает/оформляет ставки
  → normalizer чистит ошибки
```

в схему:

```text
SStats / форма / xG / H2H / Glicko / травмы
  → Tiger Bet Analytics Score
  → Stavka.tv markets + коэффициенты
  → Market Fit выбирает ставки
  → LLM только объясняет выбранное
  → Quality Gate проверяет финальный результат
```

Главный принцип:

> **Stavka.tv остаётся источником рынков и коэффициентов, но не источником истины прогноза.**

Источник истины прогноза должен стать:

```text
Tiger Bet Analytics Score
```

---

## 2. Что НЕ делаем в MVP

- Не строим ML-модель.
- Не обучаем вероятности на истории.
- Не переписываем массово существующие immutable `match_analysis`.
- Не меняем favorite-league scope.
- Не реализуем Strategy Layer сейчас.
- Не используем `popular-bets.count` как спортивный аргумент прогноза.
- Система должна стараться отдавать 3 ставки (`low`, `medium`, `high`); меньше — только в крайних случаях, когда безопасного source-backed набора нет.
- Не проектируем SQL-миграции в этом плане: DB/schema layer остаётся за пользователем.

---

## 3. Новая архитектура

| Слой | Ответственность |
|---|---|
| **SStats** | Форма, xG/xGA, голы, удары, составы, статистика, later H2H/Glicko/injuries |
| **Analytics Engine** | Считает силу команд, голевой профиль, confidence и качество данных |
| **Stavka.tv** | Даёт доступные рынки и реальные коэффициенты |
| **Market Fit** | Выбирает рынки, которые подтверждаются аналитикой |
| **LLM** | Пишет объяснение, но не выбирает и не меняет ставку |
| **Quality Gate** | Запрещает конфликты, выдуманные рынки, exact score bias, technical labels |

---

## 4. Изменение pipeline

### Сейчас

```text
Stavka match list
  → favorite-league filtering
  → ranking
  → popular-bets / risk_bets / top_bets
  → SStats enrichment
  → LLM выбирает recommended_bets
  → normalizer исправляет ошибки LLM
  → match_analysis
```

### Должно стать

```text
Stavka match list
  → favorite-league filtering
  → ranking кандидатов
  → resolve SStats fixture
  → SStats snapshot
  → analytics feature extraction
  → deterministic match scoring
  → Stavka market catalog / odds snapshot
  → deterministic market fit
  → selected_bets
  → LLM объясняет selected_bets
  → assemble final recommended_bets
  → quality gate
  → match_source + match_analysis
```

---

## 5. Новые application services

### 5.1 `matchAnalyticsFeatureService`

**Файл:**

```text
webapp/services/matchAnalyticsFeatureService.js
```

**Задача:** нормализовать `sstats_data` в стабильный feature set.

Пример output:

```json
{
  "version": "analytics-features-v1",
  "sport": "soccer",
  "coverage": {
    "home_team_stats": true,
    "away_team_stats": true,
    "home_recent_form": true,
    "away_recent_form": true,
    "lineups_known": false,
    "h2h_available": false,
    "glicko_available": false,
    "injuries_available": false
  },
  "home": {
    "games_count": 25,
    "form_points_per_game": 2.2,
    "avg_scored": 1.84,
    "avg_conceded": 0.91,
    "xg_for": 1.73,
    "xg_against": 0.86,
    "shots_for": 14.2,
    "shots_against": 8.9
  },
  "away": {}
}
```

---

### 5.2 `matchAnalyticsScoringService`

**Файл:**

```text
webapp/services/matchAnalyticsScoringService.js
```

**Задача:** посчитать deterministic scores.

Пример output:

```json
{
  "version": "match-analytics-v1",
  "model_version": "deterministic-v1",
  "eligibility": {
    "status": "eligible",
    "reasons": []
  },
  "scores": {
    "home_strength": 64,
    "away_strength": 44,
    "strength_edge": 20,
    "home_win": 57,
    "draw": 24,
    "away_win": 19,
    "goal_expectation": 2.74,
    "over_2_5": 58,
    "under_2_5": 42,
    "btts_yes": 55,
    "btts_no": 45
  },
  "confidence": {
    "score": 73,
    "tier": "medium",
    "data_completeness": 0.8,
    "signal_agreement": 0.75,
    "lineup_certainty": 0.5
  }
}
```

---

### 5.3 `marketFitService`

**Файл:**

```text
webapp/services/marketFitService.js
```

**Задача:** сопоставить analytics scores с доступными Stavka markets.

Пример output:

```json
{
  "version": "market-fit-v1",
  "selected_bets": [
    {
      "market_key": "one_x_two:w1",
      "type": "one_x_two",
      "outcome": "w1",
      "label": "Победа хозяев",
      "rate": 1.82,
      "market_category": "winner",
      "signal_key": "home_win",
      "signal_score": 57,
      "market_fit_score": 76,
      "confidence": 73,
      "risk_label": "medium",
      "selection_reason_code": "home_strength_edge"
    }
  ],
  "rejected": [
    {
      "market_key": "correct_score:2:1",
      "reason_code": "exact_score_insufficient_analytics_basis"
    }
  ]
}
```

---

### 5.4 `aiBriefAssembler`

**Файл:**

```text
webapp/services/aiBriefAssembler.js
```

**Задача:** соединить deterministic selected bets с LLM explanations.

LLM не имеет права менять:

- `type`
- `outcome`
- `label`
- `rate`
- `risk_label`
- количество ставок

Он может только вернуть объяснение по `market_key`.

---

### 5.5 `recommendedBetQualityGate`

**Файл:**

```text
webapp/services/recommendedBetQualityGate.js
```

**Задача:** вынести и усилить текущие проверки из `aiBriefGenerator.js`.

Проверки:

- ставка есть в source market catalog;
- коэффициент совпадает с source;
- label читаемый русский, не technical code;
- максимум 3 ставки;
- разные semantic categories;
- не более одной winner-category;
- `correct_score` допускается только при достаточных основаниях: сильный аналитический сигнал, реальный market в Stavka catalog, валидный коэффициент и отсутствие шаблонного exact-score bias;
- LLM не подменил deterministic selection.

---

## 6. Scoring model v1

### 6.1 Recent form

```text
W = 3
D = 1
L = 0
form_points_per_game = points / matches_count
```

Если матчей формы меньше 3:

- не выдумывать значение;
- снижать `data_completeness`;
- не обязательно skip, если есть нормальные `team_stats`.

---

### 6.2 Attack score

```text
attack_score =
  45% xG_for
+ 35% avg_scored
+ 20% avg_shots
```

---

### 6.3 Defence score

```text
defence_score =
  55% inverse(xGA)
+ 30% inverse(avg_conceded)
+ 15% inverse(avg_shots_against)
```

---

### 6.4 Team strength

```text
team_strength =
  35% form_score
+ 30% attack_score
+ 25% defence_score
+ 10% long_term_record_score
```

Потом:

```text
strength_edge = home_strength - away_strength + home_advantage
```

Для MVP `home_advantage` — маленькая константа в коде, например `+3`, если не определено нейтральное поле.

---

### 6.5 Goal expectation

```text
home_goal_signal = mean(home.xG_for, away.xGA)
away_goal_signal = mean(away.xG_for, home.xGA)
goal_expectation = home_goal_signal + away_goal_signal
```

На базе этого считаем:

- `over_2_5`
- `under_2_5`
- `btts_yes`
- `btts_no`

---

### 6.6 Confidence

```text
confidence =
  50% data_completeness
+ 30% signal_agreement
+ 20% lineup_certainty
```

Важно:

> `confidence` — это уверенность в качестве данных и согласованности сигнала, а не обещание прохода ставки.

---

## 7. H2H / Glicko / injuries

Продуктово они нужны, но в текущем `buildMatchPayload()` они не входят как нормальный contract.

Для MVP:

| Фактор | Решение в MVP |
|---|---|
| H2H | extension point, не имитировать |
| Glicko | extension point, не имитировать |
| Injuries | extension point, не выдумывать |
| Lineups | использовать только как modifier confidence |

В payload заложить поля:

```json
{
  "h2h": null,
  "ratings": null,
  "availability": {
    "confirmed_absences": []
  }
}
```

---

## 8. Market Fit v1

### Поддерживаемые рынки

| Analytics signal | Stavka market | Условие |
|---|---|---|
| `home_win` высокий | `one_x_two:w1` | есть уверенный перевес хозяев |
| `away_win` высокий | `one_x_two:w2` | есть уверенный перевес гостей |
| умеренный перевес | `double_chance` | если доступен и winner ещё не выбран |
| `over_2_5` высокий | `total_over` | есть доступный рынок с нужной линией |
| `under_2_5` высокий | `total_under` | есть доступный рынок с нужной линией |
| `btts_yes` высокий | `both_to_score:yes` | обе атаки достаточно сильны |
| `btts_no` высокий | `both_to_score:no` | одна атака слабая или защиты сильные |
| большой перевес | `handicap1/handicap2` | только после conservative mapping |

---

### Формула market fit

```text
market_fit_score =
  60% signal_score
+ 25% analytics_confidence
+ 15% market_suitability
```

Коэффициент участвует только в:

- risk classification;
- ограничении экстремальных коэффициентов;
- будущей Strategy Layer.

Коэффициент **не создаёт прогноз сам по себе**.

---

### Ограничения

1. Целевой набор — 3 ставки (`low`, `medium`, `high`); меньше допускается только как fail-closed fallback, если нет безопасного source-backed market fit.
2. Не более одной winner-category.
3. Не более одной ставки из одной semantic category.
4. `correct_score` допускается только при достаточных основаниях: сильный аналитический сигнал, реальный рынок в catalog, валидный коэффициент и прохождение exact-score quality gate.
5. Не публиковать ставку, если:
   - confidence ниже порога;
   - market fit ниже порога;
   - нет такого рынка в Stavka catalog;
   - odds невалиден;
   - label отсутствует или technical;
   - есть category conflict.

---

## 9. Новый LLM contract

### Сейчас

LLM возвращает:

```json
{
  "headline": "...",
  "brief": "...",
  "risk_note": "...",
  "recommended_bets": []
}
```

### Должно стать

LLM возвращает:

```json
{
  "headline": "...",
  "brief": "...",
  "risk_note": "...",
  "bet_explanations": [
    {
      "market_key": "one_x_two:w1",
      "reason": "Преимущество хозяев поддержано формой и xG."
    }
  ]
}
```

Финальный `recommended_bets` собирает application layer:

```text
selected_bets + bet_explanations by market_key
```

Если LLM вернул explanation для неизвестного `market_key` — игнорировать.

Если LLM не объяснил выбранную ставку — использовать deterministic fallback reason или fail по согласованной policy.

---

## 10. Изменяемые prompt-pack файлы

```text
docs/ai-briefs/prompt-pack/system-prompt.md
docs/ai-briefs/prompt-pack/user-prompt-template.md
docs/ai-briefs/prompt-pack/output-schema.json
docs/ai-briefs/prompt-pack/few-shots.json
```

Новый prompt должен явно сказать:

```text
Не выбирай ставки.
Ставки уже выбраны analytics/market-fit слоем.
Твоя задача — объяснить выбранные ставки на основе allowed_facts.
```

---

## 11. Persistence contract

Без SQL-проектирования, только application boundary.

### `match_source.source_payload`

Добавить:

```json
{
  "analytics_features": {},
  "match_analytics": {},
  "market_catalog": {},
  "market_fit": {}
}
```

`source_hash` должен учитывать:

- feature version;
- scoring model version;
- market-fit version;
- выбранные markets;
- коэффициенты snapshot.

### `match_analysis.recommended_bets`

Оставить текущий UI-compatible формат:

```json
[{
  "type": "one_x_two",
  "outcome": "w1",
  "label": "Победа хозяев",
  "rate": 1.82,
  "reason": "...",
  "risk_label": "medium"
}]
```

Расширенные поля вроде `market_fit_score` пока можно хранить только в `source_payload.market_fit`, чтобы не ломать UI/API contract.

---

## 12. Тесты

### Новые тесты

| Файл | Что проверяет |
|---|---|
| `tests/webapp/match-analytics-feature-service.test.js` | нормализация SStats fields, missing data, coverage |
| `tests/webapp/match-analytics-scoring-service.test.js` | form/attack/defence/goal/confidence scores |
| `tests/webapp/market-fit-service.test.js` | mapping score → markets, conflicts, risk labels |
| `tests/webapp/recommended-bet-quality-gate.test.js` | source-backed, odds match, labels, conflicts, exact score ban |
| `tests/webapp/ai-brief-assembler.test.js` | merge selected_bets + explanations by market_key |
| `tests/webapp/daily-picks-analytics-pipeline.test.js` | сквозной pipeline на fixtures |

---

### Обновляемые тесты

| Файл | Изменение |
|---|---|
| `tests/webapp/ai-brief-generator.test.js` | новый output contract `bet_explanations` |
| `tests/webapp/stavka-api.test.js` | market catalog отдельно от social-proof selector |
| `tests/webapp/daily-pick-persistence-service.test.js` | hash учитывает analytics/model versions |
| `tests/webapp/daily-pick-analysis-service.test.js` | deterministic pre-LLM stage / skip reasons |

---

## 13. Обязательные сценарии проверки

1. **Фаворит подтверждён формой/xG**
   - выбирается `П1` / `П2`;
   - LLM не меняет рынок.

2. **Высокий goal expectation**
   - выбирается `ТБ 2.5`, только если рынок есть в catalog.

3. **Есть `П1` и `1X`**
   - остаётся максимум один winner-market.

4. **В Stavka есть `correct_score:2:1`**
   - selector v1 выбирает его только при достаточных основаниях: сильный аналитический сигнал на конкретный сценарий матча, реальный рынок в catalog, валидный коэффициент и прохождение exact-score quality gate; иначе отклоняет с `exact_score_insufficient_analytics_basis`.

5. **LLM вернул другой odds или новый market**
   - финальный `recommended_bets` не меняется.

6. **Нет xG, но есть форма**
   - confidence снижается;
   - нет `NaN`;
   - решение deterministic.

7. **Нет SStats fixture**
   - LLM не вызывается;
   - skip reason: `analytics_sstats_fixture_unresolved`.

8. **Одинаковые fixtures**
   - score и selected markets воспроизводимы.

9. **Изменились коэффициенты, но SStats тот же**
   - analytics score не меняется;
   - market fit может измениться.

---

## 14. Verification commands после реализации

```bash
cd /home/fedulov/tiger_bet

node --test \
  tests/webapp/match-analytics-feature-service.test.js \
  tests/webapp/match-analytics-scoring-service.test.js \
  tests/webapp/market-fit-service.test.js \
  tests/webapp/recommended-bet-quality-gate.test.js \
  tests/webapp/ai-brief-assembler.test.js \
  tests/webapp/ai-brief-generator.test.js \
  tests/webapp/daily-picks-analytics-pipeline.test.js
```

Регрессия:

```bash
cd /home/fedulov/tiger_bet

node --test \
  tests/webapp/stavka-api.test.js \
  tests/webapp/daily-pick-candidate-service.test.js \
  tests/webapp/daily-pick-persistence-service.test.js \
  tests/webapp/daily-pick-analysis-service.test.js \
  tests/webapp/ai-brief-generator.test.js \
  tests/webapp/daily-picks-api.test.js \
  tests/webapp/recommendations-api.test.js
```

Module smoke:

```bash
cd /home/fedulov/tiger_bet

node -e "require('./scheduler/DailyPicks'); require('./webapp/services/matchAnalyticsFeatureService'); require('./webapp/services/matchAnalyticsScoringService'); require('./webapp/services/marketFitService'); console.log('modules ok')"
```

---

## 15. Этапы реализации

### Этап 0. Утвердить contract и rollout policy

**Файлы:**

```text
.hermes/plans/2026-07-13_165513-analytics-first-daily-picks-mvp.md
docs/ai-briefs/analytics-contract-v1.md
```

**Результат:**

- утверждён JSON contract;
- утверждены thresholds v1;
- выбран источник Stavka market catalog;
- определена policy повторной генерации.

---

### Этап 1. SStats resolution + feature extraction

**Файлы:**

```text
lib/sstatsApi.js
scheduler/DailyPicks.js
webapp/services/matchAnalyticsFeatureService.js
tests/webapp/match-analytics-feature-service.test.js
tests/webapp/daily-pick-persistence-service.test.js
```

**Цель:** получать стабильный `analytics_features_v1`.

---

### Этап 2. Deterministic scoring

**Файлы:**

```text
webapp/services/matchAnalyticsScoringService.js
tests/webapp/match-analytics-scoring-service.test.js
scheduler/DailyPicks.js
```

**Цель:** считать `match_analytics_v1` до LLM.

---

### Этап 3. Stavka market catalog + market fit

**Файлы:**

```text
lib/stavkaApi.js
webapp/services/marketFitService.js
tests/webapp/market-fit-service.test.js
tests/webapp/stavka-api.test.js
scheduler/DailyPicks.js
```

**Цель:** выбрать `selected_bets` детерминированно, без LLM.

---

### Этап 4. LLM writer-only contract

**Файлы:**

```text
webapp/services/aiBriefGenerator.js
webapp/services/aiBriefAssembler.js
webapp/services/recommendedBetQualityGate.js
docs/ai-briefs/prompt-pack/system-prompt.md
docs/ai-briefs/prompt-pack/user-prompt-template.md
docs/ai-briefs/prompt-pack/output-schema.json
docs/ai-briefs/prompt-pack/few-shots.json
tests/webapp/ai-brief-generator.test.js
tests/webapp/ai-brief-assembler.test.js
tests/webapp/recommended-bet-quality-gate.test.js
```

**Цель:** LLM объясняет, но не выбирает.

---

### Этап 5. Pipeline integration + controlled rollout

**Файлы:**

```text
scheduler/DailyPicks.js
webapp/services/dailyPickPersistenceService.js
tests/webapp/daily-pick-persistence-service.test.js
tests/webapp/daily-picks-analytics-pipeline.test.js
scripts/run_daily_picks.js // если потребуется только wiring/flags
```

**Цель:** новая запись содержит reproducible analytics snapshot, а финальные bets совпадают с deterministic market fit.

**Обязательное immutability-правило:** если на матч уже есть `ready` analysis за текущий daily-picks слот/день, cron не должен пересобирать `recommended_bets`, `brief`, `market_fit` или source snapshot автоматически. Повторная генерация допустима только через отдельный targeted reanalysis flow по явному запросу.

---

## 16. Утверждённые продуктовые решения перед реализацией

1. **Количество ставок:** система должна всегда стараться дать 3 ставки: `low`, `medium`, `high`. Меньше 3 допустимо только в крайних случаях, когда нет безопасного source-backed market fit без конфликтов или данных явно недостаточно.
2. **`correct_score`:** точный счёт не запрещён полностью. Он может быть выбран, но только если есть достаточные основания: сильный аналитический сигнал, реальный рынок в Stavka catalog, валидный коэффициент, и quality gate подтверждает, что это не шаблонный `2:1 / 1:2` без основания.
3. **Stavka market catalog:** для MVP используем partial catalog: `popular-bets.data` + 1X2 из listing/match odds. В payload явно фиксируем `catalog_coverage: "partial"`. Позже нужно отдельной задачей найти/подключить полный endpoint линии Stavka.
4. **LLM недоступен:** честно считаем, что прогноза нет. Не публикуем deterministic picks с шаблонным fallback brief как полноценный прогноз.
5. **Rollout и immutability:** новая модель применяется только к новым матчам. Уже опубликованный daily pick в течение дня автоматически не пересобирается и не заменяется, даже если пришли новые коэффициенты/SStats/lineups. Для уже существующих будущих матчей допускается только отдельный targeted reanalysis по явному запросу.
6. **Минимальный confidence:** стартовый порог публикации `>= 65/100`. Дальше порог будем тестировать и корректировать по фактическому качеству.
7. **H2H/Glicko/injuries:** в MVP оставляем extension points без имитации. Не пишем в тексте и не используем в scoring то, что реально не загружено стабильным provider contract.

---

## 17. Рекомендованный порядок

Сначала делать **этапы 0–3**:

```text
features → scoring → market fit
```

И только когда deterministic selection стабильно работает на fixtures, переходить к:

```text
LLM writer-only contract → pipeline integration
```

Так мы сначала докажем, что Tiger Bet сам выбирает ставки аналитически, и только потом будем менять prompt/UI-facing explanation.
