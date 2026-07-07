# Tiger Bet — Leagues Global Search Design

**Date:** 2026-07-07  
**Project:** tiger_bet  
**Status:** draft  
**Scope:** WebApp / вкладка `Лиги`

## 1. Goal

Добавить во вкладку `Лиги` глобальный поиск, который помогает быстро находить нужную лигу без ручного прохода по иерархии `вид спорта → страна → лига`.

Фича должна приблизить релиз за счёт улучшения одного из ключевых пользовательских сценариев:
- пользователь знает, какую лигу хочет найти;
- пользователь не хочет проваливаться по нескольким экранам;
- пользователь должен иметь возможность сразу добавить лигу в избранное.

## 2. Approved UX decisions

Зафиксированные решения:

1. Выбран **глобальный поиск с первого экрана** вкладки `Лиги`.
2. Поиск работает **live по мере ввода**.
3. Также сохраняется **явный запуск через Enter / кнопку `Найти`**.
4. Под строкой поиска показываются **live-подсказки трёх типов**:
   - лиги;
   - страны;
   - виды спорта.
5. Полный экран результатов показывает **только лиги**.
6. Тап по найденной лиге открывает **отдельный экран результатов поиска лиг**.
7. Тап по стране открывает существующий сценарий перехода к списку стран/турниров.
8. Тап по виду спорта открывает существующий сценарий перехода к странам выбранного спорта.
9. В результатах поиска пользователь может **сразу добавить/убрать лигу из избранного**.
10. Возврат назад должен сохранять текущий query, чтобы пользователь не терял контекст.

## 3. User flow

### 3.1 Default state

Во вкладке `Лиги`, пока строка поиска пустая, экран работает как сейчас:
- блок `Избранные лиги`;
- блок `Все виды спорта`.

### 3.2 Typing state

Когда пользователь начинает вводить текст:
- сверху остаётся строка поиска;
- под ней появляются live-подсказки;
- основной контент первого экрана не должен мешать сценарию поиска.

Рекомендуемое поведение:
- если `query.length < 2`, live-подсказки можно не запрашивать;
- если `query.length >= 2`, запускается debounce-запрос на suggestions.

### 3.3 Live suggestions

Подсказки отображаются тремя секциями:
- `Лиги`
- `Страны`
- `Виды спорта`

Каждая секция скрывается, если в ней нет результатов.

#### Tap behavior

- **Лига** → открыть отдельный экран результатов поиска лиг по текущему query.
- **Страна** → перейти в текущий flow конкретного спорта/страны, если из результата достаточно данных для такого перехода.
- **Вид спорта** → открыть экран стран этого вида спорта.

### 3.4 Full search results screen

Это отдельный view внутри вкладки `Лиги`.

Он показывает:
- список найденных лиг;
- название лиги;
- подпись формата `вид спорта · страна`;
- иконку/лого турнира;
- звезду избранного.

Экран результатов:
- открывается по Enter / кнопке `Найти`;
- открывается по тапу на suggestion-лигу;
- после открытия **обновляется live** по мере дальнейшего изменения query.

### 3.5 Back navigation

При нажатии Back:
- если открыт экран результатов поиска, пользователь возвращается на первый экран вкладки `Лиги`;
- строка поиска и введённый query сохраняются;
- live-подсказки могут быть восстановлены по текущему query.

## 4. UX rules

### 4.1 Search input

Плейсхолдер:

`Найти лигу, страну или спорт...`

Поведение поля:
- поддерживает live-input;
- Enter запускает явный переход на results view;
- рядом допустима кнопка `Найти`;
- при очистке поля UI возвращается в default state.

### 4.2 Empty states

Нужны состояния:
- `Начните вводить запрос` — если открыт search flow без достаточной длины query;
- `Ничего не найдено` — если search/suggest вернул пустой результат;
- `Ошибка поиска` — если запрос завершился неуспешно.

### 4.3 Favorites behavior

Во всех league-строках поиска:
- звезда должна работать без перехода на другой экран;
- optimistic toggle допустим, если уже используется в текущем `LeaguesPage`;
- при ошибке состояние звезды откатывается.

## 5. Technical approach

Выбран вариант **B / C-гибрид**:
- backend даёт глобальный поиск;
- frontend показывает live suggestions;
- full results screen использует отдельный backend search endpoint.

Это лучший баланс между скоростью реализации и качеством релизного UX.

## 6. Backend design

## 6.1 New endpoints

### `GET /leagues/search/suggest?q=...`

Назначение: быстрые live-подсказки с ограниченным количеством результатов.

**Response shape:**

```json
{
  "leagues": [
    {
      "tournament_id": 1,
      "tournament_name": "Premier League",
      "country_id": 10,
      "country_name": "Англия",
      "sport_id": 1,
      "sport_name": "Футбол",
      "tournament_image_path": "/..."
    }
  ],
  "countries": [
    {
      "country_id": 10,
      "country_name": "Англия",
      "sport_id": 1,
      "sport_name": "Футбол",
      "country_code": "gb"
    }
  ],
  "sports": [
    {
      "sport_id": 1,
      "sport_name": "Футбол",
      "sport_url": "football"
    }
  ]
}
```

### `GET /leagues/search?q=...`

Назначение: полный список найденных лиг для results view.

**Response shape:**

```json
{
  "leagues": [
    {
      "tournament_id": 1,
      "tournament_name": "Premier League",
      "tournament_name_en": "Premier League",
      "tournament_image_path": "/...",
      "country_id": 10,
      "country_name": "Англия",
      "sport_id": 1,
      "sport_name": "Футбол"
    }
  ]
}
```

## 6.2 Search fields

Поиск должен работать по полям:
- `tournament.tournament_name`
- `tournament.tournament_name_en`
- `country.country_name`
- `country.country_name_en`
- `sport.sport_name`

## 6.3 Matching strategy

Для MVP достаточно:
- `ILIKE '%query%'`
- trimming пробелов
- case-insensitive matching

Без сложной релевантности на первом этапе.

Рекомендуемый приоритет сортировки для лиг:
1. точное совпадение по названию лиги;
2. prefix-match;
3. substring-match;
4. затем алфавитно.

Если такой ranking окажется избыточным по времени реализации, допустимо начать с простого:
- `ORDER BY tournament_name`.

## 6.4 Limits

Для suggestions:
- leagues: 5–8
- countries: 3–5
- sports: 3–5

Для full search:
- лимит не нужен жёсткий, но стоит предусмотреть верхний cap, например 50–100 строк.

## 6.5 Auth and favorites

Search endpoints не обязаны быть защищёнными, если сама вкладка уже живёт в авторизованном webapp-контексте.

Но для удобства frontend лучше продолжить использовать текущую модель favorites:
- избранное загружается отдельно существующим `/leagues/favorites`;
- `is_favorite` можно не вычислять на backend, если фронт уже строит map `favs[tournament_id]`.

Это минимизирует изменения API.

## 7. Frontend design

## 7.1 State additions in `LeaguesPage`

Новые состояния:
- `searchQuery`
- `debouncedQuery`
- `suggestions`
- `searchResults`
- `searchLoading`
- `suggestLoading`
- `searchViewOpen`
- `searchError`

Дополнительно желательно хранить request token / sequence id, чтобы защищаться от гонок запросов.

## 7.2 View structure

Даже если стартовая реализация останется в одном файле, логически UI делится на 3 части:
- `LeaguesSearchBar`
- `LeaguesSearchSuggestions`
- `LeaguesSearchResultsView`

На первом этапе можно сделать это как локальные render-функции внутри `LeaguesPage.jsx`, чтобы не раздувать diff. Если код начнёт быстро расти — вынести в отдельные компоненты.

## 7.3 Results screen model

Не нужно создавать новую страницу маршрутизации. Достаточно нового view-state внутри существующей вкладки `Лиги`.

Причины:
- фича уже живёт внутри текущего flow;
- текущая архитектура `LeaguesPage` уже использует уровни (`level=1/2/3`);
- можно добавить отдельный `searchViewOpen` или `level=4`, не ломая существующую модель.

Предпочтительно:
- не смешивать search-results с `level=3` страны;
- сделать явно отдельное состояние results-view.

## 7.4 Input behavior

- debounce 250–350 мс;
- запрос suggestions только от 2 символов;
- Enter / кнопка `Найти` открывают results view;
- если results view уже открыт, изменение query обновляет results live.

## 7.5 Interaction behavior

### Tap on league in suggestions
- устанавливает `searchViewOpen = true`;
- грузит full results;
- сохраняет query.

### Tap on league in full results
Есть два допустимых варианта, но для MVP рекомендован следующий:
- тап по строке лиги = toggle favorite **не делать**;
- toggle favorite оставлять только на звезде;
- тап по основной части строки пока не делает дополнительной навигации.

Это уменьшает неоднозначность UX.

Если позже появится отдельная страница лиги, поведение можно расширить.

## 8. Error handling

Нужно обработать:
- слишком короткий query;
- пустые результаты;
- сетевую ошибку;
- гонки запросов, когда старый ответ приходит позже нового;
- optimistic favorite rollback.

Минимальное правило для гонок:
- применять только результат последнего активного запроса.

## 9. Testing

### Backend
Проверить:
- поиск по `tournament_name`
- поиск по `country_name`
- поиск по `sport_name`
- пустой результат
- invalid/empty query
- лимиты suggestions

### Frontend
Проверить:
- default state при пустом query;
- появление suggestions после debounce;
- Enter открывает results view;
- results view live-обновляется при изменении query;
- back сохраняет query;
- favorite toggle работает в results;
- empty/error states отображаются корректно.

### Manual verification
Пройти сценарий руками:
1. открыть `Лиги`;
2. ввести часть названия популярной лиги;
3. увидеть suggestions;
4. открыть full results;
5. добавить/убрать лигу из избранного;
6. вернуться назад;
7. убедиться, что query сохранился.

## 10. Out of scope for MVP

Не включаем в эту итерацию:
- recent searches;
- search history;
- server-side fuzzy ranking;
- typo tolerance;
- популярные запросы;
- отдельную страницу лиги;
- сложную аналитическую телеметрию поиска.

## 11. Recommended implementation order

1. Backend endpoint `GET /leagues/search/suggest`
2. Backend endpoint `GET /leagues/search`
3. Search input в `LeaguesPage`
4. Live suggestions UI
5. Results view UI
6. Favorites integration in results
7. Empty/error/loading polish
8. Manual verification in WebApp

## 12. Final recommendation

Для релизного шага берём минимально-достаточную реализацию:
- 2 backend endpoints;
- live suggestions (лиги + страны + виды спорта);
- отдельный results view только для лиг;
- live update результатов;
- favorites прямо в поисковых результатах.

Это существенно улучшает сценарий выбора лиги, не ломая текущую 3-уровневую навигацию и не раздувая scope сверх необходимого.