import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoscowDateTime } from '../lib/format.js';

export const RISK_LEVELS = [
  { key: 'low', label: 'Низкий' },
  { key: 'mid', label: 'Средний' },
  { key: 'high', label: 'Высокий' },
];

export function BetModal({ item, betIndex, onClose, hideMatchLink = false }) {
  const [activeIndex, setActiveIndex] = useState(betIndex);
  const bets = Array.isArray(item.bets) ? item.bets.slice(0, 3) : [];
  const activeBet = bets[activeIndex] || null;
  const detailsHref = `/match/${encodeURIComponent(item.id || '')}`;

  return (
    <div className="modal" aria-hidden="false">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bet-modal-title">
        <div className="modal-head">
          <div>
            <h3 id="bet-modal-title">{item.match || 'Матч'}</h3>
            <p className="recommendation-subtitle">
              {item.league || '—'} · {formatMoscowDateTime(item.starts_at || '') || '—'}
            </p>
          </div>
          <button className="modal-close-btn" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>

        <div className="modal-switches">
          {RISK_LEVELS.map((risk, i) => (
            bets[i] ? (
              <button
                key={risk.key}
                type="button"
                className={`modal-switch modal-risk-switch modal-risk-switch-${risk.key}${activeIndex === i ? ' active' : ''}`}
                onClick={() => setActiveIndex(i)}
              >
                {risk.label}
              </button>
            ) : null
          ))}
        </div>

        {activeBet ? (
          <div className="bet-detail">
            <div className="bet-detail-row">
              <span className="forecast-label">Риск</span>
              <span className={`risk-badge risk-badge-${RISK_LEVELS[activeIndex].key}`}>{RISK_LEVELS[activeIndex].label}</span>
            </div>
            <div className="bet-detail-row">
              <span className="forecast-label">Коэффициент</span>
              <strong>{activeBet.coeff ?? '—'}</strong>
            </div>
            <div className="bet-detail-row">
              <span className="forecast-label">Прогноз</span>
              <span>{activeBet.forecast || '—'}</span>
            </div>
            <div className="bet-detail-row">
              <span className="forecast-label">Вероятность / уверенность</span>
              <span>{activeBet.probability ?? '—'}% / {activeBet.confidence || '—'}</span>
            </div>
            {activeBet.description ? (
              <p className="bet-detail-desc">{activeBet.description}</p>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Закрыть</button>
          {!hideMatchLink ? (
            <Link className="button-link button-link-primary" to={detailsHref} onClick={onClose}>К матчу →</Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
