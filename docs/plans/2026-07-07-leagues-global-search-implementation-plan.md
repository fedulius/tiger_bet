# Leagues Global Search Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Добавить во вкладку `Лиги` глобальный поиск с live-подсказками и отдельным экраном результатов, чтобы пользователь мог быстро найти и добавить лигу в избранное без ручного прохода по иерархии экранов.

**Architecture:** Делаем 2 backend endpoint в текущем `webapp/routes/leagues/index.js`: один для `suggest`, второй для полного `search`. На фронте расширяем `webapp-react/src/pages/LeaguesPage.jsx`: добавляем строку поиска, debounce, блок live-подсказок и отдельный results view внутри текущего page-state, не вводя новый маршрут.

**Tech Stack:** Fastify, PostgreSQL через `fastify.pg.connection`, React, существующий `fetchJSON()` из `webapp-react/src/lib/api.js`, node:test для backend API tests.

---

## Pre-flight context

Перед любыми правками перечитать:
- spec: `docs/superpowers/specs/2026-07-07-leagues-global-search-design.md`
- backend route: `webapp/routes/leagues/index.js`
- frontend page: `webapp-react/src/pages/LeaguesPage.jsx`
- API helper: `webapp-react/src/lib/api.js`
- test style: `tests/webapp/favorites-api.test.js`

Не проектировать БД заново. Пользователь сам владеет SQL/DB-слоем. Здесь считаем, что нам нужны только SQL-запросы уровня route-handler без отдельной миграционной работы.

---

## Task 1: Add backend tests for search suggestions endpoint

**Objective:** Зафиксировать контракт `GET /leagues/search/suggest?q=...` до реализации.

**Files:**
- Modify: `tests/webapp/favorites-api.test.js`

**Step 1: Write failing tests**

Добавить 2 теста в `tests/webapp/favorites-api.test.js`:

1. `GET /leagues/search/suggest returns leagues countries and sports groups`
2. `GET /leagues/search/suggest returns empty groups for short query`

Ориентир по структуре теста:

```js
test('GET /leagues/search/suggest returns leagues countries and sports groups', async () => {
  const fakePg = createFakePg({
    handler(query, params) {
      if (/FROM public\.tournament/i.test(query)) {
        return [
          {
            tournament_id: 10,
            tournament_name: 'Premier League',
            country_id: 20,
            country_name: 'Англия',
            sport_id: 1,
            sport_name: 'Футбол',
            tournament_image_path: '/premier.png',
          },
        ];
      }
      if (/FROM public\.country/i.test(query)) {
        return [
          {
            country_id: 20,
            country_name: 'Англия',
            sport_id: 1,
            sport_name: 'Футбол',
            country_code: 'gb',
          },
        ];
      }
      if (/FROM public\.sport/i.test(query)) {
        return [{ sport_id: 1, sport_name: 'Футбол', sport_url: 'soccer' }];
      }
      return [];
    },
  });

  const app = buildTestApp(buildApp, { pg: fakePg });
  await app.ready();
  try {
    const response = await app.inject({ method: 'GET', url: '/leagues/search/suggest?q=prem' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      leagues: [/* ... */],
      countries: [/* ... */],
      sports: [/* ... */],
    });
  } finally {
    await app.close();
  }
});
```

Для short-query теста проверять:
- статус `200`
- JSON = `{ leagues: [], countries: [], sports: [] }`
- `fakePg.calls.length === 0`

**Step 2: Run test to verify failure**

Run:
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/favorites-api.test.js
```

Expected: FAIL — route `/leagues/search/suggest` отсутствует или возвращает не тот payload.

**Step 3: Write minimal implementation**

Ничего в route пока не доводить до идеала; только минимально подготовить backend для прохождения этого теста в следующей задаче.

**Step 4: Commit**

```bash
git add tests/webapp/favorites-api.test.js
git commit -m "test: add leagues search suggest api coverage"
```

---

## Task 2: Implement backend suggestions endpoint

**Objective:** Реализовать `GET /leagues/search/suggest` с 3 группами результатов.

**Files:**
- Modify: `webapp/routes/leagues/index.js`
- Verify: `tests/webapp/favorites-api.test.js`

**Step 1: Add route handler**

В `webapp/routes/leagues/index.js` добавить новый handler перед favorites endpoints:

```js
fastify.get('/search/suggest', async (request, reply) => {
  const query = String(request.query?.q || '').trim();
  if (query.length < 2) {
    return { leagues: [], countries: [], sports: [] };
  }

  const like = `%${query}%`;

  const leagues = await fastify.pg.connection(`
    SELECT t.tournament_id, t.tournament_name, t.tournament_name_en,
           t.tournament_image_path,
           c.country_id, c.country_name,
           s.sport_id, s.sport_name
    FROM public.tournament t
    JOIN public.country c ON c.country_id = t.country_id
    JOIN public.sport s ON s.sport_id = t.sport_id
    WHERE t.tournament_name ILIKE $1
       OR COALESCE(t.tournament_name_en, '') ILIKE $1
       OR c.country_name ILIKE $1
       OR COALESCE(c.country_name_en, '') ILIKE $1
       OR s.sport_name ILIKE $1
    ORDER BY t.tournament_name
    LIMIT 8
  `, [like]);

  const countries = await fastify.pg.connection(`
    SELECT DISTINCT c.country_id, c.country_name, c.country_code,
           s.sport_id, s.sport_name
    FROM public.country c
    JOIN public.tournament t ON t.country_id = c.country_id
    JOIN public.sport s ON s.sport_id = t.sport_id
    WHERE c.country_name ILIKE $1
       OR COALESCE(c.country_name_en, '') ILIKE $1
       OR s.sport_name ILIKE $1
    ORDER BY c.country_name
    LIMIT 5
  `, [like]);

  const sports = await fastify.pg.connection(`
    SELECT s.sport_id, s.sport_name, s.sport_url
    FROM public.sport s
    WHERE s.sport_name ILIKE $1
    ORDER BY s.sport_name
    LIMIT 5
  `, [like]);

  return { leagues, countries, sports };
});
```

**Step 2: Run targeted tests**

Run:
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/favorites-api.test.js
```

Expected: новые tests для `suggest` PASS.

**Step 3: Sanity-check no accidental breakage**

Проверить, что existing favorites tests всё ещё зелёные в том же файле.

**Step 4: Commit**

```bash
git add webapp/routes/leagues/index.js tests/webapp/favorites-api.test.js
git commit -m "feat: add leagues search suggestions endpoint"
```

---

## Task 3: Add backend tests for full leagues search endpoint

**Objective:** Зафиксировать контракт `GET /leagues/search?q=...` для полного results view.

**Files:**
- Modify: `tests/webapp/favorites-api.test.js`

**Step 1: Write failing tests**

Добавить 2 теста:

1. `GET /leagues/search returns full leagues list`
2. `GET /leagues/search returns empty list for short query`

Структура ответа:

```js
assert.deepEqual(response.json(), {
  leagues: [
    {
      tournament_id: 10,
      tournament_name: 'Premier League',
      tournament_name_en: 'Premier League',
      tournament_image_path: '/premier.png',
      country_id: 20,
      country_name: 'Англия',
      sport_id: 1,
      sport_name: 'Футбол',
    },
  ],
});
```

Short query:
```js
assert.deepEqual(response.json(), { leagues: [] });
assert.equal(fakePg.calls.length, 0);
```

**Step 2: Run test to verify failure**

Run:
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/favorites-api.test.js
```

Expected: FAIL — route `/leagues/search` отсутствует или payload не совпадает.

**Step 3: Commit**

```bash
git add tests/webapp/favorites-api.test.js
git commit -m "test: add leagues full search api coverage"
```

---

## Task 4: Implement backend full search endpoint

**Objective:** Реализовать `GET /leagues/search` для отдельного экрана результатов.

**Files:**
- Modify: `webapp/routes/leagues/index.js`
- Verify: `tests/webapp/favorites-api.test.js`

**Step 1: Add route handler**

Добавить в `webapp/routes/leagues/index.js`:

```js
fastify.get('/search', async (request, reply) => {
  const query = String(request.query?.q || '').trim();
  if (query.length < 2) {
    return { leagues: [] };
  }

  const like = `%${query}%`;
  const rows = await fastify.pg.connection(`
    SELECT t.tournament_id, t.tournament_name, t.tournament_name_en,
           t.tournament_image_path,
           c.country_id, c.country_name,
           s.sport_id, s.sport_name
    FROM public.tournament t
    JOIN public.country c ON c.country_id = t.country_id
    JOIN public.sport s ON s.sport_id = t.sport_id
    WHERE t.tournament_name ILIKE $1
       OR COALESCE(t.tournament_name_en, '') ILIKE $1
       OR c.country_name ILIKE $1
       OR COALESCE(c.country_name_en, '') ILIKE $1
       OR s.sport_name ILIKE $1
    ORDER BY t.tournament_name
    LIMIT 100
  `, [like]);

  return { leagues: rows };
});
```

**Step 2: Run targeted backend tests**

Run:
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/favorites-api.test.js
```

Expected: PASS for both `search` and `suggest` coverage.

**Step 3: Commit**

```bash
git add webapp/routes/leagues/index.js tests/webapp/favorites-api.test.js
git commit -m "feat: add leagues full search endpoint"
```

---

## Task 5: Add frontend API helpers for search

**Objective:** Подготовить тонкие обёртки над `fetchJSON()` для suggest/search вызовов.

**Files:**
- Modify: `webapp-react/src/lib/api.js`

**Step 1: Add helpers**

В конец `webapp-react/src/lib/api.js` добавить:

```js
export function getLeagueSearchSuggestions(query) {
  return fetchJSON(`/leagues/search/suggest?q=${encodeURIComponent(query)}`);
}

export function searchLeagues(query) {
  return fetchJSON(`/leagues/search?q=${encodeURIComponent(query)}`);
}
```

**Step 2: Quick sanity check**

Проверить глазами, что новые функции используют существующий `fetchJSON()` и не дублируют auth/header logic.

**Step 3: Commit**

```bash
git add webapp-react/src/lib/api.js
git commit -m "refactor: add leagues search api helpers"
```

---

## Task 6: Add search state to LeaguesPage

**Objective:** Ввести новые состояния и безопасный debounce-механизм без рендера UI результатов.

**Files:**
- Modify: `webapp-react/src/pages/LeaguesPage.jsx`

**Step 1: Expand imports**

Заменить import API helpers на:

```js
import {
  fetchJSON,
  auth,
  getLeagueSearchSuggestions,
  searchLeagues,
} from '../lib/api.js';
```

**Step 2: Add state**

В `LeaguesPage` добавить:

```js
const [searchQuery, setSearchQuery] = useState('');
const [debouncedQuery, setDebouncedQuery] = useState('');
const [suggestions, setSuggestions] = useState({ leagues: [], countries: [], sports: [] });
const [searchResults, setSearchResults] = useState([]);
const [suggestLoading, setSuggestLoading] = useState(false);
const [searchLoading, setSearchLoading] = useState(false);
const [searchError, setSearchError] = useState('');
const [searchViewOpen, setSearchViewOpen] = useState(false);
const latestSuggestRef = useRef(0);
const latestSearchRef = useRef(0);
```

**Step 3: Add debounce effect**

```js
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedQuery(searchQuery.trim());
  }, 300);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

**Step 4: Add suggest/search effects skeleton**

Пока без финального UI, но с живой логикой:
- если `debouncedQuery.length < 2`:
  - reset suggestions/results/errors;
  - если query пустой — `searchViewOpen=false`.
- иначе:
  - грузить suggestions;
  - если `searchViewOpen === true`, грузить full search.

**Step 5: Race protection**

Каждый запрос должен увеличивать ref-id:

```js
const requestId = ++latestSuggestRef.current;
const payload = await getLeagueSearchSuggestions(debouncedQuery);
if (requestId !== latestSuggestRef.current) return;
```

Аналогично для full search.

**Step 6: No-UI verification**

Проверить, что файл не сломан синтаксически сборкой в следующей задаче.

**Step 7: Commit**

```bash
git add webapp-react/src/pages/LeaguesPage.jsx
git commit -m "refactor: add leagues search state machine"
```

---

## Task 7: Add search bar UI on Leagues root screen

**Objective:** Показать строку поиска на первом уровне экрана `Лиги`.

**Files:**
- Modify: `webapp-react/src/pages/LeaguesPage.jsx`

**Step 1: Add search bar renderer**

Над level-specific rendering добавить helper-функцию внутри компонента:

```jsx
const renderSearchBar = () => (
  <div className="card-group" style={{ marginBottom: 12 }}>
    <div className="league-row" style={{ gap: 10 }}>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
            setSearchViewOpen(true);
          }
        }}
        placeholder="Найти лигу, страну или спорт..."
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text-1)',
          fontSize: 16,
        }}
      />
      <button
        type="button"
        className="chip"
        onClick={() => {
          if (searchQuery.trim().length >= 2) setSearchViewOpen(true);
        }}
      >
        Найти
      </button>
    </div>
  </div>
);
```

Если `chip` в проекте не существует как стиль — не изобретать дизайн-систему; использовать простой button с inline style в духе текущей страницы.

**Step 2: Render search bar in level 1**

Сразу после page header в level 1 вставить:

```jsx
{renderSearchBar()}
```

**Step 3: Keep empty-query behavior**

Если `searchQuery.trim()` пустой — экран должен продолжать показывать `Избранные лиги` и `Все виды спорта` как сейчас.

**Step 4: Commit**

```bash
git add webapp-react/src/pages/LeaguesPage.jsx
git commit -m "feat: add leagues search bar"
```

---

## Task 8: Add live suggestions UI

**Objective:** Показать под строкой поиска 3 группы live-подсказок на первом экране.

**Files:**
- Modify: `webapp-react/src/pages/LeaguesPage.jsx`

**Step 1: Add renderer for suggestions**

Создать helper `renderSuggestions()` с такими правилами:
- не рендерить, если `debouncedQuery.length < 2`
- если `suggestLoading` — показать 3-4 skeleton row
- если все группы пустые и нет ошибки — показать `Ничего не найдено`
- если есть `searchError` — показать `Ошибка поиска`

**Step 2: Render leagues section**

Каждая строка лиги:
- логотип
- `tournament_name`
- подпись `sport_name · country_name`
- звезда избранного

Поведение:
- тап по строке → `setSearchViewOpen(true)`
- тап по звезде → `toggleFav()` и `event.stopPropagation()`

**Step 3: Render countries section**

Каждая строка страны:
- флаг/код
- `country_name`
- подпись `sport_name`
- chevron

Поведение:
- тап → вызвать `openSport({ sport_id, sport_name })`, потом загрузить страны/сделать переход к корректному screen-flow.

Для MVP, если прямой переход в страну требует лишней связки, допустимый упрощённый вариант:
- тап по стране открывает `selectedSport`, `level=2`, грузит список стран для спорта,
- найденная страна уже видна в списке.

**Step 4: Render sports section**

Каждая строка спорта:
- иконка
- `sport_name`
- chevron

Поведение:
- тап → `openSport(sport)`.

**Step 5: Insert suggestions into level 1 UI**

Схема:
- `header`
- `search bar`
- если query >= 2 → `suggestions`
- иначе обычный контент

Так default screen не смешивается с поиском.

**Step 6: Commit**

```bash
git add webapp-react/src/pages/LeaguesPage.jsx
git commit -m "feat: add leagues live search suggestions"
```

---

## Task 9: Add full results view for leagues search

**Objective:** Реализовать отдельный экран результатов поиска лиг внутри вкладки `Лиги`.

**Files:**
- Modify: `webapp-react/src/pages/LeaguesPage.jsx`

**Step 1: Add results-view renderer**

Сделать новый отдельный block rendering до `level === 1/2/3`:

```jsx
if (searchViewOpen) {
  return (
    <div key={levelKey} className="level-enter" style={slideStyle}>
      {/* back header */}
      {/* search bar */}
      {/* loading / empty / error / results */}
    </div>
  );
}
```

**Step 2: Back behavior**

Back button должен:
- `setSearchViewOpen(false)`
- не очищать `searchQuery`
- не очищать `suggestions`

**Step 3: Render result rows**

Каждая строка:
- логотип лиги
- `tournament_name`
- подпись `sport_name · country_name`
- звезда избранного

Поведение:
- звезда toggles favorite
- основная часть строки пока без дополнительного перехода (не перегружать UX)

**Step 4: Results live updates**

Если `searchViewOpen === true` и меняется `debouncedQuery`, экран результатов обновляется автоматически через `searchLeagues()`.

**Step 5: Empty and error states**

- loading → skeleton
- empty → `Ничего не найдено`
- error → `Не удалось выполнить поиск`

**Step 6: Commit**

```bash
git add webapp-react/src/pages/LeaguesPage.jsx
git commit -m "feat: add leagues search results view"
```

---

## Task 10: Polish interaction details and guard edge cases

**Objective:** Довести UX до релизного минимума без расширения scope.

**Files:**
- Modify: `webapp-react/src/pages/LeaguesPage.jsx`

**Step 1: Add query reset behavior**

При очистке поля:
- `searchQuery=''`
- `debouncedQuery=''`
- `suggestions` reset
- `searchResults` reset
- `searchError=''`
- `searchViewOpen=false`

**Step 2: Preserve existing root behavior**

Убедиться, что:
- `loadFavs()` по-прежнему работает;
- `toggleFav()` работает и в root, и в suggestions/results;
- переходы `openSport/openCountry/goBack` не ломаются из-за search state.

**Step 3: Prevent accidental row-click conflicts**

На звезде в suggestions/results/root обязательно:

```jsx
onClick={(e) => {
  e.stopPropagation();
  toggleFav(l.tournament_id);
}}
```

**Step 4: Commit**

```bash
git add webapp-react/src/pages/LeaguesPage.jsx
git commit -m "fix: polish leagues search interactions"
```

---

## Task 11: Verify backend and frontend build

**Objective:** Подтвердить, что фича не ломает текущую сборку и API-tests.

**Files:**
- Verify only

**Step 1: Run backend tests**

Run:
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/favorites-api.test.js
```

Expected: PASS

**Step 2: Run frontend build**

Run:
```bash
cd /home/fedulov/tiger_bet/webapp-react && npm run build
```

Expected: PASS, production bundle created

**Step 3: If build fails, fix only relevant issues**

Не делать побочный рефакторинг. Только точечные правки по search feature.

**Step 4: Commit if fixes were needed**

```bash
git add webapp/routes/leagues/index.js tests/webapp/favorites-api.test.js webapp-react/src/lib/api.js webapp-react/src/pages/LeaguesPage.jsx
git commit -m "fix: address leagues search verification issues"
```

---

## Task 12: Manual verification in app runtime

**Objective:** Проверить пользовательский сценарий в живом webapp/runtime.

**Files:**
- Verify only

**Step 1: Ensure app is running**

Если нужен локальный runtime — использовать уже принятый проектный способ запуска.

**Step 2: Verify the scenario manually**

Проверить в браузере/WebApp:
1. Открыть вкладку `Лиги`
2. Увидеть search input на первом экране
3. Ввести `prem`
4. Увидеть suggestions: league/country/sport groups
5. Нажать Enter или `Найти`
6. Увидеть full results screen
7. Добавить/убрать лигу в избранное
8. Нажать Back
9. Убедиться, что query сохранился
10. Очистить поле
11. Убедиться, что вернулся обычный root-screen

**Step 3: Capture verification evidence**

Сохранить краткий результат в final report:
- какие команды запускались;
- что реально проверено;
- были ли ограничения.

---

## Notes for implementer

- Не выносить сразу всё в новые компоненты без необходимости. Для первого прохода достаточно одного `LeaguesPage.jsx`, но с аккуратными helper renderer-функциями.
- Не добавлять новый маршрут под search results. Это внутренний view-state текущей вкладки.
- Не добавлять recent searches, fuzzy matching, analytics, extra ranking logic. Это вне scope.
- Не перестраивать DB-layer. Только текущие route-level запросы и UI behavior.

---

## Final execution handoff

Plan complete. The next implementation pass should execute task-by-task in order, verifying after each step and keeping commits small and scoped.