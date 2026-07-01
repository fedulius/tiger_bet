import React, { useEffect, useState } from 'react';
import { formatMoscowDateTime } from '../lib/format.js';

export function FeedBetModal({ item, onClose }) {
  const [closing, setClosing] = useState(false);

  function handleClose() {
    setClosing(true);
    setTimeout(onClose, 200);
  }

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    };
  }, []);
  const { primary_bet } = item;
  const meta = [item.sport, item.country, item.league].filter(Boolean).join(' · ');
  const forecastText = String(primary_bet?.forecast || '').trim();
  const rawDesc = String(primary_bet?.description || item.summary || '').trim();
  const descriptionText = rawDesc !== forecastText ? rawDesc : '';
  const compactDescription = descriptionText
    || [item.sport, item.league].filter(Boolean).join(' · ')
    || 'Описание появится после обновления данных.';

  return (
    <div className={`modal${closing ? ' modal--closing' : ''}`} aria-hidden="false" onClick={handleClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-bet-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3 id="feed-bet-modal-title">{item.match || 'Матч'}</h3>
            <p className="recommendation-subtitle">
              {meta || '—'} · {formatMoscowDateTime(item.starts_at || '') || '—'}
            </p>
          </div>
          <button className="modal-close-btn" type="button" aria-label="Закрыть" onClick={handleClose}>×</button>
        </div>

        {primary_bet ? (
          <div className="bet-detail">
            <div className="bet-detail-row">
              <span className="forecast-label">Прогноз</span>
              <strong>{primary_bet.forecast || '—'}</strong>
            </div>
            <div className="bet-detail-row">
              <span className="forecast-label">Коэффициент</span>
              <strong>× {primary_bet.coeff ?? '—'}</strong>
            </div>
            <div className="bet-compact-desc">
              <span className="bet-compact-label">Кратко</span>
              <p>{compactDescription}</p>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={handleClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
