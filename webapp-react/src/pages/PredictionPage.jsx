import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, getPrediction } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';

const RISK_MAP = {
  low: { label: 'Надёжный', dot: 'green', bg: 'rgba(34,197,94,0.08)' },
  medium: { label: 'Средний', dot: 'amber', bg: 'rgba(245,158,11,0.08)' },
  high: { label: 'Рискованный', dot: 'red', bg: 'rgba(239,68,68,0.08)' },
};

export function PredictionPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await auth();
        const result = await getPrediction(slug);
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Ошибка загрузки');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
        Загрузка...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--red)' }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const bets = data.bets || [];
  const riskNote = data.risk_note;

  return (
    <div className="prediction-page">
      {/* Header */}
      <div className="prediction-header">
        <button className="prediction-back" onClick={() => navigate(-1)} aria-label="Назад">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="prediction-header-info">
          <div className="prediction-title">{data.home_team} — {data.away_team}</div>
          <div className="prediction-meta">
            {[data.sport_name, data.league].filter(Boolean).join(' · ')}
            {data.starts_at && <> · {formatMoscowDateTime(data.starts_at)}</>}
          </div>
        </div>
      </div>

      {/* Headline */}
      {data.headline && (
        <div className="prediction-headline">{data.headline}</div>
      )}

      {/* Brief */}
      {data.brief && (
        <div className="prediction-brief">{data.brief}</div>
      )}

      {/* Risk note */}
      {riskNote && (
        <div className="prediction-risk-note">
          <span className="prediction-risk-icon">⚠️</span>
          {riskNote}
        </div>
      )}

      {/* Bets */}
      {bets.length > 0 && (
        <div className="prediction-bets">
          <div className="prediction-bets-title">Ставки</div>
          {bets.map((bet, i) => {
            const risk = RISK_MAP[bet.risk_label] || RISK_MAP.low;
            return (
              <div className="prediction-bet-card" key={i} style={{ borderLeftColor: risk.dot === 'green' ? 'var(--green, #22c55e)' : risk.dot === 'amber' ? 'var(--amber, #f59e0b)' : 'var(--red, #ef4444)' }}>
                <div className="prediction-bet-top">
                  <span className="prediction-bet-risk" style={{ color: risk.dot === 'green' ? 'var(--green, #22c55e)' : risk.dot === 'amber' ? 'var(--amber, #f59e0b)' : 'var(--red, #ef4444)' }}>
                    {risk.label}
                  </span>
                  <span className="prediction-bet-coeff">{bet.rate ?? '—'}</span>
                </div>
                <div className="prediction-bet-label">{bet.label}</div>
                {bet.reason && (
                  <div className="prediction-bet-reason">{bet.reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="prediction-footer">
        <div className="prediction-footer-text">
          Прогноз сформирован AI · {data.model_name || 'модель'}
        </div>
      </div>

      <style>{`
        .prediction-page {
          padding: 0 16px 32px;
          max-width: 480px;
          margin: 0 auto;
        }
        .prediction-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px 0 12px;
        }
        .prediction-back {
          background: none;
          border: none;
          color: var(--text-2, #666);
          cursor: pointer;
          padding: 4px;
          margin-top: 2px;
          flex-shrink: 0;
        }
        .prediction-back:active {
          opacity: 0.6;
        }
        .prediction-header-info {
          flex: 1;
          min-width: 0;
        }
        .prediction-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text, #fff);
          line-height: 1.3;
        }
        .prediction-meta {
          font-size: 13px;
          color: var(--text-3, #888);
          margin-top: 4px;
        }
        .prediction-headline {
          font-size: 20px;
          font-weight: 700;
          color: var(--text, #fff);
          line-height: 1.35;
          margin: 8px 0 12px;
          padding: 16px;
          background: var(--surface-2, rgba(255,255,255,0.05));
          border-radius: 14px;
        }
        .prediction-brief {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-2, #ccc);
          margin-bottom: 12px;
          padding: 0 4px;
        }
        .prediction-risk-note {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13px;
          color: var(--text-3, #999);
          background: var(--surface-2, rgba(255,255,255,0.04));
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 20px;
          line-height: 1.5;
        }
        .prediction-risk-icon {
          flex-shrink: 0;
          font-size: 14px;
        }
        .prediction-bets {
          margin-bottom: 24px;
        }
        .prediction-bets-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-3, #888);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 10px;
          padding: 0 4px;
        }
        .prediction-bet-card {
          background: var(--surface-2, rgba(255,255,255,0.05));
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 8px;
          border-left: 3px solid;
        }
        .prediction-bet-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .prediction-bet-risk {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .prediction-bet-coeff {
          font-size: 18px;
          font-weight: 800;
          color: var(--text, #fff);
        }
        .prediction-bet-label {
          font-size: 16px;
          font-weight: 600;
          color: var(--text, #fff);
          margin-bottom: 4px;
        }
        .prediction-bet-reason {
          font-size: 13px;
          color: var(--text-3, #999);
          line-height: 1.5;
        }
        .prediction-footer {
          text-align: center;
          padding: 16px 0;
          border-top: 1px solid var(--border, rgba(255,255,255,0.06));
        }
        .prediction-footer-text {
          font-size: 12px;
          color: var(--text-3, #666);
        }
      `}</style>
    </div>
  );
}
