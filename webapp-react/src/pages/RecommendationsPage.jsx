import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getRecommendations } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { formatRelativeUpdatedAt } from '../lib/recommendations.js';

function RecCard({ rec, onClick }) {
  const bets = Array.isArray(rec.bets) ? rec.bets.slice(0, 3) : [];
  const brief = rec.ai_brief && typeof rec.ai_brief === 'object' ? rec.ai_brief : null;

  const riskMap = {
    low: { label: 'Надёжный', dotClass: 'green' },
    medium: { label: 'Средний', dotClass: 'amber' },
    high: { label: 'Рискованный', dotClass: 'red' },
  };

  return (
    <div className="rec-card" onClick={onClick}>
      <div className="rec-card-top">
        <div>
          <div className="rec-card-match">{rec.match || 'Матч'}</div>
          <div className="rec-card-league">{[rec.sport_name, rec.league].filter(Boolean).join(' · ') || 'Лига'}</div>
        </div>
        <div className="rec-card-time">{formatMoscowDateTime(rec.starts_at) || '—'}</div>
      </div>

      {brief && brief.brief && (
        <div className="rec-ai-brief">
          <div className="rec-ai-brief-label">
            <span className="rec-ai-brief-dot" />
            {brief.headline || 'AI Прогноз'}
          </div>
          <div className="rec-ai-brief-text">{brief.brief}</div>
        </div>
      )}

      {bets.length > 0 && (
        <div className="rec-bets">
          {bets.map((bet, i) => {
            const risk = riskMap[bet.risk_label] || riskMap.low;
            return (
              <button className="rec-bet" key={i} onClick={(e) => { e.stopPropagation(); onClick(); }}>
                <div className="rec-bet-label">
                  <span className={`risk-dot ${risk.dotClass}`} />
                  {risk.label}
                </div>
                <div className="rec-bet-forecast">{bet.forecast}</div>
                <div className="rec-bet-coeff">{bet.coeff ?? '—'}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RecommendationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await auth();
        const data = await getRecommendations();
        if (!cancelled) {
          setItems(data.items || []);
          setUpdatedAt(data.updated_at || '');
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
  }, []);

  const openMatch = (rec) => {
    const slug = rec.match_slug || rec.slug || rec.match_id;
    if (slug) {
      navigate(`/match/${slug}`);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Прогнозы</div>
          <div className="page-subtitle">
            {updatedAt ? formatRelativeUpdatedAt(updatedAt) : `Загружено ${items.length} матчей`}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>Загрузка...</div>
      )}

      {error && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red)' }}>{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>Нет рекомендаций</div>
      )}

      {items.map((rec) => (
        <RecCard key={rec.id || rec.match_slug} rec={rec} onClick={() => openMatch(rec)} />
      ))}
    </>
  );
}
