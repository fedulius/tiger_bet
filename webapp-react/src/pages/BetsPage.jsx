import React, { useEffect, useMemo, useState } from 'react';
import { auth, getDailyPicks } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';

function formatOdds(value) {
  const odds = Number(value);
  if (!Number.isFinite(odds)) return '—';
  return odds.toFixed(2);
}

function resolvePickStatus(slot, activeTab) {
  if (activeTab === 'history') {
    return { label: 'История скоро', className: 'pending' };
  }

  const status = String(slot?.status || '').toLowerCase();
  if (status === 'ready') return { label: 'Готово', className: 'open' };
  if (status === 'won') return { label: 'Выигрыш', className: 'win' };
  if (status === 'lost') return { label: 'Проигрыш', className: 'lose' };
  if (status === 'void') return { label: 'Возврат', className: 'pending' };
  return { label: 'Ожидание', className: 'pending' };
}

function buildActiveBet(slot) {
  if (!slot) return null;

  const primaryBet = slot.primary_bet || slot.recommended_bets?.[0] || null;
  const selection = String(
    primaryBet?.forecast
    || primaryBet?.selection
    || primaryBet?.market
    || slot.headline
    || 'Прогноз готовится'
  ).trim();

  const metaParts = [slot.sport_name, slot.league, formatMoscowDateTime(slot.starts_at)].filter(Boolean);
  const status = resolvePickStatus(slot, 'active');

  return {
    id: slot.id || `${slot.slot_date}:${slot.match_id}`,
    match: slot.match || 'Матч',
    pick: selection,
    meta: metaParts.join(' · '),
    coeff: formatOdds(primaryBet?.odds ?? primaryBet?.coeff),
    status: status.label,
    statusClass: status.className,
    brief: slot.brief || '',
    slotLabel: slot.slot_date,
  };
}

function buildHistoryPlaceholder() {
  return [
    {
      id: 'history-placeholder',
      match: 'История ставок появится после settlement flow',
      pick: 'Пока подключены только активные daily picks',
      meta: 'Следующий шаг — чтение settled результатов из БД',
      coeff: '—',
      status: 'Скоро',
      statusClass: 'pending',
      brief: '',
    },
  ];
}

function EmptyState({ message }) {
  return <div className="bets-empty-state">{message}</div>;
}

export function BetsPage() {
  const [tab, setTab] = useState('active');
  const [feed, setFeed] = useState({ today: null, tomorrow: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await auth();
        const data = await getDailyPicks();
        if (!cancelled) {
          setFeed({
            today: data?.today || null,
            tomorrow: data?.tomorrow || null,
            updatedAt: data?.updated_at || '',
          });
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

  const activeBets = useMemo(() => {
    return [buildActiveBet(feed.today), buildActiveBet(feed.tomorrow)].filter(Boolean);
  }, [feed.today, feed.tomorrow]);

  const bets = tab === 'active' ? activeBets : buildHistoryPlaceholder();

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Ставки</div>
          <div className="page-subtitle">Daily picks на сегодня и завтра</div>
        </div>
      </div>

      <div className="balance-card">
        <div>
          <div className="balance-label">Активных daily picks</div>
          <div className="balance-value">{activeBets.length} <span className="balance-unit">из 2</span></div>
        </div>
        <div className="balance-delta">{feed.updatedAt ? 'Обновлено' : 'Ожидание'}</div>
      </div>

      <div className="segment-control">
        <button
          className={`segment-btn${tab === 'active' ? ' active' : ''}`}
          onClick={() => setTab('active')}
        >
          Активные
        </button>
        <button
          className={`segment-btn${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          История
        </button>
      </div>

      {loading && <EmptyState message="Загрузка ставок..." />}
      {!loading && error && <EmptyState message={error} />}
      {!loading && !error && bets.length === 0 && tab === 'active' && <EmptyState message="Нет daily picks на сегодня и завтра" />}

      {!loading && !error && bets.map((bet) => (
        <div className="bet-row" key={bet.id}>
          <div className="bet-row-main">
            <div className="bet-row-match">{bet.match}</div>
            <div className="bet-row-pick">{bet.pick}</div>
            <div className="bet-row-meta">{bet.meta}</div>
            {bet.brief ? <div className="bet-row-brief">{bet.brief}</div> : null}
          </div>
          <div className="bet-row-right">
            <div className="bet-row-coeff">{bet.coeff}</div>
            <div className={`bet-row-status ${bet.statusClass}`}>{bet.status}</div>
          </div>
        </div>
      ))}
    </>
  );
}
