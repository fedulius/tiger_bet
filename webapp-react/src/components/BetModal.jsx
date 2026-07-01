import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatMoscowDateTime } from '../lib/format.js';

export const RISK_LEVELS = [
  { key: 'low', label: 'Низкий' },
  { key: 'mid', label: 'Средний' },
  { key: 'high', label: 'Высокий' },
];

export function getRiskMeta(bet, index) {
  const label = String(bet?.risk_label || '').trim();
  if (label === 'low') return RISK_LEVELS[0];
  if (label === 'medium') return RISK_LEVELS[1];
  if (label === 'high') return RISK_LEVELS[2];
  return RISK_LEVELS[index] || RISK_LEVELS[0];
}

export function BetModal({ item, betIndex, onClose, hideMatchLink = false }) {
  const [activeIndex, setActiveIndex] = useState(betIndex);
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
  const bets = Array.isArray(item.bets) ? item.bets.slice(0, 3) : [];
  const activeBet = bets[activeIndex] || null;
  const detailsHref = `/match/${encodeURIComponent(item.id || '')}`;

  return (
    <div className={`modal${closing ? ' modal--closing' : ''}`} aria-hidden="false">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bet-modal-title">
        <div className="modal-head">
          <div>
            <h3 id="bet-modal-title">{item.match || 'Матч'}</h3>
            <p className="recommendation-subtitle">
              {item.league || '—'} · {formatMoscowDateTime(item.starts_at || '') || '—'}
            </p>
          </div>
          <button className="modal-close-btn" type="button" aria-label="Закрыть" onClick={handleClose}>×</button>
        </div>

        <div className="modal-switches">
          {bets.map((bet, i) => {
            const risk = getRiskMeta(bet, i);
            return (
              <button
                key={`${risk.key}-${i}`}
                type="button"
                className={`modal-switch modal-risk-switch modal-risk-switch-${risk.key}${activeIndex === i ? ' active' : ''}`}
                onClick={() => setActiveIndex(i)}
              >
                {risk.label} × {bet.coeff ?? '—'}
              </button>
            );
          })}
        </div>

        {activeBet ? (
          <div className="bet-detail">
            <div className="bet-detail-row">
              <span className="forecast-label">Риск</span>
              <span className={`risk-badge risk-badge-${getRiskMeta(activeBet, activeIndex).key}`}>{getRiskMeta(activeBet, activeIndex).label}</span>
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

        {item.ai_brief ? (
          <div className="ai-brief">
            {item.ai_brief.headline ? (
              <p className="ai-brief-headline">{item.ai_brief.headline}</p>
            ) : null}
            {item.ai_brief.brief ? (
              <p className="ai-brief-body">{item.ai_brief.brief}</p>
            ) : null}
            {item.ai_brief.risk_note ? (
              <p className="ai-brief-risk">{item.ai_brief.risk_note}</p>
            ) : null}
            {item.ai_brief.stale ? (
              <p className="ai-brief-stale">Обзор обновляется</p>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={handleClose}>Закрыть</button>
          {!hideMatchLink ? (
            <Link className="button-link button-link-primary" to={detailsHref} onClick={handleClose}>К матчу →</Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
