import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getDailyPicks } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';

function buildDailyPickItems(feed) {
  const slots = [feed?.today, feed?.tomorrow].filter(Boolean);
  return slots.map((slot, index) => {
    const bets = Array.isArray(slot.recommended_bets) ? slot.recommended_bets.slice(0, 3) : [];
    const primaryBet = slot.primary_bet || bets[0] || null;
    return {
      id: slot.id || `${slot.slot_date || index}:${slot.match_id || index}`,
      match_id: slot.match_id,
      match_slug: slot.match_slug,
      match: slot.match,
      sport_name: slot.sport_name,
      league: slot.league,
      starts_at: slot.starts_at,
      bets: bets.map((bet) => ({
        forecast: bet.label || bet.forecast || bet.selection || bet.market || slot.headline || 'Прогноз',
        coeff: bet.rate ?? bet.odds ?? bet.coeff ?? null,
        risk_label: bet.risk_label || 'low',
      })),
      ai_brief: {
        headline: slot.headline || (slot.slot_date === feed?.today_date ? 'Прогноз на сегодня' : 'Прогноз на завтра'),
        brief: slot.brief || slot.risk_note || '',
      },
      _slotLabel: slot.slot_date,
      _primaryForecast: primaryBet?.forecast || primaryBet?.selection || primaryBet?.market || '',
    };
  });
}

function RecCard({ rec, onClick }) {
  const bets = Array.isArray(rec.bets) ? rec.bets.slice(0, 3) : [];
  const brief = rec.ai_brief && typeof rec.ai_brief === 'object' ? rec.ai_brief : null;

  const riskMap = {
    low: { label: 'Надёжный', dotClass: 'green' },
    medium: { label: 'Средний', dotClass: 'amber' },
    high: { label: 'Рискованный', dotClass: 'red' },
  };

  const riskOrder = { low: 0, medium: 1, high: 2 };
  const sortedBets = [...bets].sort((a, b) => (riskOrder[a.risk_label] ?? 1) - (riskOrder[b.risk_label] ?? 1));

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

      {sortedBets.length > 0 && (
        <div className="rec-bets">
          {sortedBets.map((bet, i) => {
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
        const dailyPicks = await getDailyPicks();
        if (!cancelled) {
          setItems(buildDailyPickItems(dailyPicks));
          setUpdatedAt(dailyPicks?.updated_at || '');
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
            {updatedAt ? `Обновлено ${new Date(updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}` : ''}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>Загрузка...</div>
      )}

      {error && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red)' }}>{error}</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="section-header" style={{ marginTop: 0 }}>
          <div>
            <div className="section-title">Прогнозы на сегодня и завтра</div>
          </div>
        </div>
      )}

      {!loading && !error && items.map((rec) => (
        <RecCard key={rec.id} rec={rec} onClick={() => openMatch(rec)} />
      ))}

      {!loading && !error && items.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>Нет прогнозов</div>
      )}
    </>
  );
}
