import React, { useEffect, useState } from 'react';
import { getRecommendations } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';

export function RecommendationsPage() {
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    let cancelled = false;

    getRecommendations()
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, items: Array.isArray(data.items) ? data.items : [], error: '' });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, items: [], error: err?.message || 'Ошибка загрузки' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="layout">
      <h1>Tiger Bet</h1>
      <p className="hint">React shell запущен. Дальше переносим UI блоками.</p>

      {state.loading ? <p>Загрузка...</p> : null}
      {state.error ? <p className="error">{state.error}</p> : null}

      <ul className="list">
        {state.items.slice(0, 3).map((item) => (
          <li key={item.id || item.match}>
            <strong>{item.match}</strong>
            <div>{item.league || '—'}</div>
            <div>{formatMoscowDateTime(item.starts_at)}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
