import React from 'react';
import { formatMoscowDateTime } from '../lib/format.js';

export function FeedBetModal({ item, onClose }) {
  const { primary_bet } = item;
  const meta = [item.sport, item.country, item.league].filter(Boolean).join(' · ');

  return (
    <div className="modal" aria-hidden="false" onClick={onClose}>
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
          <button className="modal-close-btn" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
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
            {primary_bet.description ? (
              <p className="bet-detail-desc">{primary_bet.description}</p>
            ) : null}
          </div>
        ) : null}

        {item.summary ? (
          <p className="feed-modal-summary">{item.summary}</p>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
