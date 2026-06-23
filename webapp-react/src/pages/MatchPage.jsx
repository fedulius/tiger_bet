import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { auth, getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { buildMatchBackLink, resolveMatchId } from '../lib/match.js';

function MatchForecastBlock({ item }) {
  const bets = Array.isArray(item.bets) ? item.bets.slice(0, 3) : [];

  return (
    <div className="forecast-block">
      <div className="forecast-summary">
        <div className="forecast-summary-item">
          <span className="forecast-label">Матч</span>
          <strong>{item.match || '—'}</strong>
        </div>
        <div className="forecast-summary-item">
          <span className="forecast-label">Лига</span>
          <strong>{item.league || '—'}</strong>
        </div>
        <div className="forecast-summary-item">
          <span className="forecast-label">Время начала</span>
          <strong>{formatMoscowDateTime(item.starts_at || '') || '—'}</strong>
        </div>
      </div>

      {bets.map((bet, index) => (
        <div className="bet-card" key={`${item.id || item.match}-bet-${index}`}>
          <div className="bet-card-head">
            <span className="bet-index">Прогноз #{index + 1}</span>
            <span className="bet-coeff">Кэф: {bet.coeff ?? '—'}</span>
          </div>
          <p><span className="forecast-label">Прогноз</span>{bet.forecast || '—'}</p>
          <p><span className="forecast-label">Вероятность / уверенность</span>{bet.probability ?? '—'}% / {bet.confidence || '—'}</p>
          <p><span className="forecast-label">Краткое описание</span>{bet.description || '—'}</p>
        </div>
      ))}
    </div>
  );
}

export function MatchPage() {
  const { id: routeParamId } = useParams();
  const location = useLocation();

  const matchId = useMemo(
    () => resolveMatchId({ routeParamId, search: location.search }),
    [routeParamId, location.search],
  );

  const [state, setState] = useState({ loading: true, error: '', item: null, unauthorized: false });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!matchId) {
        setState({ loading: false, error: 'Не указан id матча', item: null, unauthorized: false });
        return;
      }

      setState({ loading: true, error: '', item: null, unauthorized: false });

      try {
        await auth();
        const item = await getMatchDetails(matchId);
        if (!cancelled) {
          setState({ loading: false, error: '', item, unauthorized: false });
        }
      } catch (error) {
        if (!cancelled) {
          if (String(error?.message || '') === 'HTTP 401') {
            setState({ loading: false, error: '', item: null, unauthorized: true });
          } else {
            setState({ loading: false, error: 'Матч не найден', item: null, unauthorized: false });
          }
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const item = state.item;

  if (state.unauthorized) {
    return (
      <main className="layout centered-layout">
        <section className="card auth-card">
          <h2>Доступ ограничен</h2>
          <p>Откройте приложение через кнопку в Telegram-боте и повторите попытку.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="layout">
      <section>
        <div className="section-head">
          <div>
            <h2>Детали матча</h2>
            <p className="section-description">Расширенная карточка с прогнозами и временем старта матча.</p>
          </div>
          <Link className="button-link" to={buildMatchBackLink()}>← Назад</Link>
        </div>

        {state.loading ? <div id="match-details" className="recommendations-empty">Загрузка...</div> : null}
        {!state.loading && state.error ? <div id="match-details" className="recommendations-empty">{state.error}</div> : null}

        {!state.loading && !state.error && item ? (
          <div id="match-details">
            <article className="recommendation-card recommendation-card-detailed">
              <div className="recommendation-head">
                <div>
                  <h3>{item.match || 'Матч'}</h3>
                  <p className="recommendation-subtitle">{item.league || 'Лига не указана'}</p>
                </div>
                <span className="recommendation-badge">Матч</span>
              </div>
              <MatchForecastBlock item={item} />
              <div className="basis-box">
                <span className="forecast-label">Основание</span>
                <p>{item.basis || 'Нет дополнительного описания'}</p>
              </div>
            </article>
          </div>
        ) : null}


      </section>
    </main>
  );
}
