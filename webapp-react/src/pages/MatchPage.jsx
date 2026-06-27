import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { auth, getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { buildMatchBackLink, resolveMatchId } from '../lib/match.js';
import { BetModal, RISK_LEVELS } from '../components/BetModal.jsx';

export function MatchPage() {
  const { id: routeParamId } = useParams();
  const location = useLocation();

  const matchId = useMemo(
    () => resolveMatchId({ routeParamId, search: location.search }),
    [routeParamId, location.search],
  );

  const [state, setState] = useState({ loading: true, error: '', item: null, unauthorized: false });
  const [betModal, setBetModal] = useState({ isOpen: false, betIndex: 0 });

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

  const bets = Array.isArray(item?.bets) ? item.bets.slice(0, 3) : [];

  return (
    <main className="layout">
      <section>
        <div className="section-head">
          <div>
            <h2>Матч</h2>
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
              </div>
              <p className="card-time">{formatMoscowDateTime(item.starts_at || '') || '—'}</p>
              {bets.length > 0 ? (
                <div className="risk-buttons">
                  {RISK_LEVELS.map((risk, i) => (
                    bets[i] ? (
                      <button
                        key={risk.key}
                        className={`risk-btn risk-btn-${risk.key}`}
                        type="button"
                        onClick={() => setBetModal({ isOpen: true, betIndex: i })}
                      >
                        {risk.label}
                        <span className="risk-btn-coeff">× {bets[i].coeff ?? '—'}</span>
                      </button>
                    ) : null
                  ))}
                </div>
              ) : null}
            </article>

            {item.basis ? (
              <div className="basis-box">
                <span className="forecast-label">Основание</span>
                <p>{item.basis}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {betModal.isOpen && item ? (
        <BetModal
          item={item}
          betIndex={betModal.betIndex}
          onClose={() => setBetModal((prev) => ({ ...prev, isOpen: false }))}
          hideMatchLink
        />
      ) : null}
    </main>
  );
}
