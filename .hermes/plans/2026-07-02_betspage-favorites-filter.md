# Tiger Bet: BetsPage — фильтрация по избранным лигам

> **For Hermes:** implement task-by-task with TDD (RED → GREEN → REFACTOR).

**Goal:** Заменить моковые данные в «Ставки» на реальные матчи из stavka.tv, отфильтрованные по любимым видам спорта/лигам пользователя. Не показывать матчи из неизбранных лиг.

**Architecture:** Новый backend-роут `/bets` фетчит upcoming-матчи из stavka.tv, фильтрует по `user_sport` + favorite leagues, возвращает матчи с odds (1X2). React-компонент `BetsPage` рендерит карточки с коэффициентами.

**Tech Stack:** Node.js, Fastify, React/Vite, stavka.tv API, PostgreSQL (`user_sport` table), `node:test`.

---

## Context / assumptions

- BetsPage сейчас 100% mock: `MOCK_BETS_ACTIVE`, `MOCK_BETS_HISTORY`, захардкоженный баланс
- `/home` endpoint уже фильтрует по избранным лигам через `get_sstats_league_ids(userId)` — но отдаёт матчи сгруппированными по лигам (формат HomePage)
- `/feed` endpoint отдаёт все матчи с snapshot (Redis) — не привязан к user
- stavka.tv API (`fetchAllMatches()`) возвращает все upcoming-матчи с `odds.one_x_two`
- Favorites хранятся в `user_sport` таблице: `user_id`, `sport_id` + в `favorites.json` для настроек лиг
- `resolveSport(sportSlug)` → `{ sport_id, sport_name }` — маппинг sport slug → ID
- Мок BetsPage уже показывает структуру: match, pick, meta, coefficient, status

---

## Task 1: Создать backend-роут `GET /bets`

**Objective:** Новый endpoint, который отдаёт матчи из избранных лиг с коэффициентами.

**Files:**
- Create: `webapp/routes/bets/index.js`
- Create: `tests/webapp/bets-api.test.js`
- Modify: `server/app.js` (подключить route — через autoload этого не требует)

**API Contract:**
```
GET /bets
Authorization: Bearer ***

Response 200:
{
  "items": [
    {
      "id": "12345",
      "slug": "arsenal-chelsea",
      "match": "Arsenal — Chelsea",
      "sport_name": "Футбол",
      "league": "Premier League",
      "starts_at": "2026-07-02T19:30:00.000Z",
      "odds": { "w1": 1.82, "x": 3.40, "w2": 4.10 },
      "status": 1,
      "score": null
    }
  ],
  "filters": {
    "favorite_sports": ["Футбол", "Теннис"]
  }
}

Response 200 (empty):
{
  "items": [],
  "filters": { "favorite_sports": [] },
  "empty_state": {
    "message": "Добавьте виды спорта или лиги, чтобы видеть ставки",
    "cta": { "label": "Выбрать лиги", "target": "/leagues" }
  }
}
```

**Implementation:**
```js
// webapp/routes/bets/index.js
const { fetchAllMatches } = require('../../../lib/stavkaApi');
const { resolveSport } = require('../../../lib/stavkaApi');

fastify.get('/', {
  preHandler: [require('../../../middleware/auth').requireAuth],
}, async (request, reply) => {
  const userId = request.user.userId;
  const pg = request.server.pg; // or however pg is injected

  // 1. Get user's favorite sport_ids
  const favRows = await pg.query(
    'SELECT sport_id FROM public.user_sport WHERE user_id = $1',
    [userId]
  );
  const favSportIds = new Set(favRows.rows.map(r => r.sport_id));

  if (favSportIds.size === 0) {
    return { items: [], filters: { favorite_sports: [] }, empty_state: { ... } };
  }

  // 2. Fetch all upcoming matches
  const allMatches = await fetchAllMatches();

  // 3. Filter by favorites + upcoming
  const now = Date.now();
  const items = [];
  for (const m of allMatches) {
    if (!m.matchDate || !m.odds?.one_x_two) continue;
    const ts = new Date(m.matchDate).getTime();
    if (ts <= now) continue;

    const sport = resolveSport(m.sportSlug);
    if (!favSportIds.has(sport.sport_id)) continue;

    const odds = m.odds.one_x_two;
    const w1 = odds?.w1?.value;
    const x  = odds?.x?.value;
    const w2 = odds?.w2?.value;

    items.push({
      id: String(m.id),
      slug: m.slug,
      match: `${m.teams?.home?.name || '?'} — ${m.teams?.away?.name || '?'}`,
      sport_name: sport.sport_name,
      league: m.league?.name || '',
      starts_at: new Date(m.matchDate).toISOString(),
      odds: { w1, x, w2 },
      status: m.status || 1,
      score: m.score || null,
    });
  }

  // 4. Sort by starts_at
  items.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  // 5. Get sport names for filters
  const favSportNames = [...favSportIds].map(id => {
    const found = Object.entries(require('../../../lib/stavkaApi').SPORT_MAP)
      .find(([k, v]) => v.sport_id === id);
    return found ? found[1].sport_name : String(id);
  });

  return {
    items,
    filters: { favorite_sports: favSportNames },
  };
});
```

**Verification:**
```bash
cd /home/fedulov/tiger_bet && node --test tests/webapp/bets-api.test.js
```

**Commit:** `feat(bets): add GET /bets endpoint with favorites filter`

---

## Task 2: Добавить API-клиент `getBets()` в frontend

**Objective:** Клиентский метод для запроса `/bets`.

**Files:**
- Modify: `webapp-react/src/lib/api.js`

**Implementation:**
```js
export async function getBets() {
  return fetchJSON('/bets');
}
```

**Verification:** `cd /home/fedulov/tiger_bet/webapp-react && npm run build`

**Commit:** `feat(bets): add getBets API client method`

---

## Task 3: Переписать BetsPage на реальные данные

**Objective:** Заменить моки на fetch из `/bets`, рендерить карточки матчей с коэффициентами.

**Files:**
- Modify: `webapp-react/src/pages/BetsPage.jsx`
- Modify: `webapp-react/src/styles/app.css` (если нужны новые стили)

**UI Design:**
```
┌──────────────────────────────┐
│ 🎯 Ставки                    │
│                              │
│ ┌──────────────────────────┐ │
│ │ ⚽ Premier League         │ │
│ │                          │ │
│ │ Arsenal — Chelsea        │ │
│ │ 20:30 · Сегодня          │ │
│ │                          │ │
│ │ П1: 1.82  Х: 3.40  П2: 4.10│
│ └──────────────────────────┘ │
│                              │
│ ┌──────────────────────────┐ │
│ │ 🎾 ATP                    │ │
│ │                          │ │
│ │ Sinner — Alcaraz         │ │
│ │ 21:00 · Сегодня          │ │
│ │                          │ │
│ │ П1: 1.55  П2: 2.40       │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Implementation sketch:**
```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getBets } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';

function formatOdds(odds) {
  const parts = [];
  if (odds.w1) parts.push(`П1: ${odds.w1}`);
  if (odds.x)  parts.push(`Х: ${odds.x}`);
  if (odds.w2) parts.push(`П2: ${odds.w2}`);
  return parts.join('  ');
}

function OddsRow({ odds }) {
  return (
    <div className="bets-odds">
      {odds.w1 && <span className="odd"><span className="odd-label">П1</span><span className="odd-value">{odds.w1}</span></span>}
      {odds.x  && <span className="odd"><span className="odd-label">Х</span><span className="odd-value">{odds.x}</span></span>}
      {odds.w2 && <span className="odd"><span className="odd-label">П2</span><span className="odd-value">{odds.w2}</span></span>}
    </div>
  );
}

export function BetsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState('pending');
  const [emptyState, setEmptyState] = useState(null);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await auth();
      setAuthState('ok');
      const result = await getBets();
      setItems(result.items || []);
      setEmptyState(result.empty_state || null);
    } catch (err) {
      if (err.status === 401) setAuthState('unauthorized');
      else { setAuthState('ok'); setItems([]); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ... loading/unauthorized states (same pattern as HomePage)

  if (emptyState && items.length === 0) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>🎯</div>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>{emptyState.message}</div>
        <button onClick={() => navigate(emptyState.cta.target)}>{emptyState.cta.label}</button>
      </div>
    );
  }

  // Group by league
  const byLeague = {};
  for (const item of items) {
    const key = item.league || 'Другое';
    if (!byLeague[key]) byLeague[key] = { sport_name: item.sport_name, matches: [] };
    byLeague[key].matches.push(item);
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title"><span>🎯</span> Ставки</div>
      </div>
      {Object.entries(byLeague).map(([league, group]) => (
        <div className="league-group" key={league}>
          <div className="league-header">
            <span className="league-name">{group.sport_name} · {league}</span>
          </div>
          <div className="match-list">
            {group.matches.map(m => (
              <div className="bet-card" key={m.id} onClick={() => navigate(`/match/${m.id}`)}>
                <div className="bet-match-name">{m.match}</div>
                <div className="bet-meta">
                  <span>{formatMoscowDateTime(m.starts_at)}</span>
                </div>
                <OddsRow odds={m.odds} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
```

**Verification:** `cd /home/fedulov/tiger_bet/webapp-react && npm run build`

**Commit:** `feat(bets): rewrite BetsPage with real data from /bets`

---

## Task 4: Добавить CSS-стили для карточек ставок

**Objective:** Стили для `bet-card`, `bets-odds`, `odd`.

**Files:**
- Modify: `webapp-react/src/styles/app.css`

**Implementation sketch:**
```css
.bet-card {
  padding: 14px 16px;
  background: var(--card-bg);
  border-radius: 14px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.bet-card:active {
  background: var(--card-bg-active, rgba(0,0,0,0.05));
}

.bet-match-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.bet-meta {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 10px;
}

.bets-odds {
  display: flex;
  gap: 8px;
}

.odd {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  background: var(--chip-bg, rgba(0,0,0,0.04));
  border-radius: 8px;
}

.odd-label {
  font-size: 10px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.odd-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
}
```

**Verification:** `cd /home/fedulov/tiger_bet/webapp-react && npm run build`

**Commit:** `style(bets): add odds card styles`

---

## Task 5: Итоговая проверка и коммит

**Objective:** Убедиться, что всё работает: backend отвечает, frontend рендерит, пустое состояние корректно.

**Steps:**
1. `cd /home/fedulov/tiger_bet && node --test tests/webapp/bets-api.test.js`
2. `cd /home/fedulov/tiger_bet/webapp-react && npm run build`
3. `cd /home/fedulov/tiger_bet && node --test` (все тесты)
4. Если есть pm2: `pm2 restart 0`
5. Ручная проверка в Telegram WebApp

**Acceptance criteria:**
- [ ] BetsPage показывает только матчи из избранных лиг
- [ ] Если лига "Premier League" выбрана — показываются матчи Premier League
- [ ] Если нет избранных — пустое состояние с CTA "Выбрать лиги"
- [ ] Коэффициенты отображаются (П1, Х, П2)
- [ ] Tap по карточке открывает `/match/:id`

---

## Files changed (summary)

| File | Action |
|------|--------|
| `webapp/routes/bets/index.js` | Create |
| `tests/webapp/bets-api.test.js` | Create |
| `webapp-react/src/lib/api.js` | Modify (add `getBets`) |
| `webapp-react/src/pages/BetsPage.jsx` | Rewrite |
| `webapp-react/src/styles/app.css` | Modify (add odds styles) |
