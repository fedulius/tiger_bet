import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { buildMatchBackLink, resolveMatchId } from '../lib/match.js';

export function MatchPage() {
  const { id: routeParamId } = useParams();
  const location = useLocation();

  const matchId = useMemo(
    () => resolveMatchId({ routeParamId, search: location.search }),
    [routeParamId, location.search],
  );

  const [state, setState] = useState({ loading: true, error: '', item: null });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!matchId) {
        setState({ loading: false, error: 'Не указан id матча', item: null });
        return;
      }

      setState({ loading: true, error: '', item: null });

      try {
        const item = await getMatchDetails(matchId);
        if (!cancelled) {
          setState({ loading: false, error: '', item });
        }
      } catch {
        if (!cancelled) {
          setState({ loading: false, error: 'Матч не найден', item: null });
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const item = state.item;

  return (
    <main className="layout">
      <section>
        <div className="section-head">
          <h2>Детали матча</h2>
          <Link to={buildMatchBackLink()}>← Назад</Link>
        </div>

        {state.loading ? <div id="match-details">Загрузка...</div> : null}
        {!state.loading && state.error ? <div id="match-details">{state.error}</div> : null}

        {!state.loading && !state.error && item ? (
          <div id="match-details">
            <article className="recommendation-card">
              <h3>{item.match || 'Матч'}</h3>
              <div className="recommendation-meta">{item.league || ''} · {formatMoscowDateTime(item.starts_at || '')}</div>
              <p>{item.main_thought || ''}</p>
              <div className="recommendation-confidence">Уверенность: {item.confidence ?? '—'}%</div>
              <p><strong>Основание:</strong> {item.basis || ''}</p>
            </article>
          </div>
        ) : null}

        <div id="match-external-link" className="match-external-link">
          {!state.loading && !state.error && item?.source_url ? (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer">Открыть источник</a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
