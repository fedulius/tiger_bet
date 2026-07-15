import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getHistory } from '../lib/api.js';
import {
  getHistoryStatusPresentation,
  getHistorySummaryPresentation,
  hasNextHistoryPage,
  mapHistoryCard,
} from '../lib/bets-history.js';
import { formatMoscowDateTime } from '../lib/format.js';

const HISTORY_LIMIT = 20;
const SEGMENTS = [
  { id: 'active', label: 'Активные' },
  { id: 'history', label: 'История' },
  { id: 'express', label: 'Экспрессы' },
];

function formatOdds(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(2);
}

function statusClass(code) {
  return `bets-history-status bets-history-status-${code || 'unknown'}`;
}

function HistorySkeleton() {
  return (
    <div className="bets-history-skeletons" aria-label="Загрузка истории">
      {[0, 1, 2].map((item) => (
        <div className="bets-history-skeleton" key={item}>
          <div className="bets-history-skeleton-line bets-history-skeleton-line-wide" />
          <div className="bets-history-skeleton-line bets-history-skeleton-line-short" />
          <div className="bets-history-skeleton-line bets-history-skeleton-line-body" />
        </div>
      ))}
    </div>
  );
}

function Summary({ summary }) {
  const cards = [
    { label: 'Прибыль', value: summary.profit_label, accent: summary.profit_units >= 0 ? 'positive' : 'negative' },
    { label: 'Проходимость', value: summary.hit_rate_label },
    { label: 'Всего ставок', value: summary.total_bets },
  ];

  return (
    <>
      <div className="bets-history-summary-grid">
        {cards.map((card) => (
          <div className="bets-history-summary-card" key={card.label}>
            <div className="bets-history-summary-label">{card.label}</div>
            <div className={`bets-history-summary-value ${card.accent ? `bets-history-summary-${card.accent}` : ''}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
      <div className="bets-history-counters" aria-label="Результаты ставок">
        <div className="bets-history-counter bets-history-counter-won"><span>Зашло</span><strong>{summary.won_count}</strong></div>
        <div className="bets-history-counter bets-history-counter-lost"><span>Не зашло</span><strong>{summary.lost_count}</strong></div>
        <div className="bets-history-counter"><span>Возврат</span><strong>{summary.void_count}</strong></div>
        <div className="bets-history-counter"><span>Ждём</span><strong>{summary.pending_count}</strong></div>
        {summary.not_supported_count > 0 && (
          <div className="bets-history-counter"><span>Не рассчитываем</span><strong>{summary.not_supported_count}</strong></div>
        )}
      </div>
    </>
  );
}

function BetRow({ bet }) {
  return (
    <div className="bets-history-bet-row">
      <div className="bets-history-bet-main">
        <div className="bets-history-bet-label">{bet.label || bet.market_name || 'Ставка'}</div>
        <div className="bets-history-bet-meta">
          {[bet.market_name, bet.period, bet.line_value != null ? `линия ${bet.line_value}` : ''].filter(Boolean).join(' · ') || 'Одиночная ставка'}
        </div>
        {bet.reason_text && <div className="bets-history-bet-reason">{bet.reason_text}</div>}
      </div>
      <div className="bets-history-bet-values">
        <strong>{formatOdds(bet.odds_decimal)}</strong>
        <span className={statusClass(bet.result_code)}>{bet.result_label}</span>
        <span className={`bets-history-bet-profit ${bet.profit_units >= 0 ? 'bets-history-profit-positive' : 'bets-history-profit-negative'}`}>
          {bet.profit_label}
        </span>
      </div>
    </div>
  );
}

function HistoryCard({ card, expanded, onToggle }) {
  const status = getHistoryStatusPresentation(card.result_code);
  const date = formatMoscowDateTime(card.published_at || card.starts_at);

  return (
    <article className={`bets-history-card ${expanded ? 'bets-history-card-expanded' : ''}`}>
      <button className="bets-history-card-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
        <div className="bets-history-card-main">
          <div className="bets-history-card-match">{card.match || 'Матч'}</div>
          <div className="bets-history-card-meta">{[card.sport_name, card.league].filter(Boolean).join(' · ') || 'Прогноз'}{date ? ` · ${date}` : ''}</div>
          {card.headline && <div className="bets-history-card-headline">{card.headline}</div>}
        </div>
        <div className="bets-history-card-aside">
          <span className={statusClass(status.code)}>{status.label}</span>
          <span className="bets-history-card-profit">{card.profit_label}</span>
          <span className="bets-history-card-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </div>
      </button>
      {expanded && (
        <div className="bets-history-card-details">
          {card.brief && <p className="bets-history-card-brief">{card.brief}</p>}
          {card.risk_note && <p className="bets-history-card-risk">{card.risk_note}</p>}
          <div className="bets-history-bets-list">
            {card.bets.length > 0 ? card.bets.map((bet) => <BetRow key={bet.id} bet={bet} />) : (
              <div className="bets-history-no-bets">Детализация ставок пока недоступна</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Placeholder({ title, text, navigate }) {
  return (
    <div className="bets-page-placeholder">
      <div className="bets-page-placeholder-icon" aria-hidden="true">◌</div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button type="button" className="bets-page-cta" onClick={() => navigate('/recommendations')}>
        Открыть прогнозы
      </button>
    </div>
  );
}

export function BetsPage() {
  const navigate = useNavigate();
  const [segment, setSegment] = useState('history');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(() => getHistorySummaryPresentation());
  const [pagination, setPagination] = useState({ limit: HISTORY_LIMIT, offset: 0, returned: 0, total_cards: 0 });
  const [emptyState, setEmptyState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const requestIdRef = useRef(0);

  const loadHistory = useCallback(async ({ append = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError('');
    }

    const offset = append ? pagination.offset + pagination.returned : 0;
    try {
      await auth();
      const payload = await getHistory({ limit: HISTORY_LIMIT, offset });
      if (requestId !== requestIdRef.current) return;
      const mappedItems = Array.isArray(payload?.items) ? payload.items.map(mapHistoryCard) : [];
      setItems((previous) => {
        if (!append) return mappedItems;
        const byId = new Map(previous.map((item) => [item.id, item]));
        mappedItems.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
      setSummary(getHistorySummaryPresentation(payload?.summary));
      setPagination(payload?.pagination || { limit: HISTORY_LIMIT, offset, returned: mappedItems.length, total_cards: mappedItems.length });
      setEmptyState(payload?.empty_state || null);
      setExpandedId(null);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err?.message || 'Не удалось загрузить историю');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [pagination.offset, pagination.returned]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    async function loadInitialHistory() {
      try {
        await auth();
        const payload = await getHistory({ limit: HISTORY_LIMIT, offset: 0 });
        if (cancelled || requestId !== requestIdRef.current) return;
        const mappedItems = Array.isArray(payload?.items) ? payload.items.map(mapHistoryCard) : [];
        setItems(mappedItems);
        setSummary(getHistorySummaryPresentation(payload?.summary));
        setPagination(payload?.pagination || { limit: HISTORY_LIMIT, offset: 0, returned: mappedItems.length, total_cards: mappedItems.length });
        setEmptyState(payload?.empty_state || null);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Не удалось загрузить историю');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadInitialHistory();
    return () => { cancelled = true; };
  }, []);

  const canLoadMore = useMemo(() => hasNextHistoryPage(pagination), [pagination]);

  return (
    <div className="bets-page">
      <div className="page-header bets-page-header">
        <div className="page-title">Ставки</div>
      </div>
      <div className="bets-page-segments" role="tablist" aria-label="Раздел ставок">
        {SEGMENTS.map((item) => (
          <button
            className={`bets-page-segment ${segment === item.id ? 'bets-page-segment-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={segment === item.id}
            key={item.id}
            onClick={() => setSegment(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {segment === 'active' && <Placeholder title="Активные ставки" text="Здесь появятся ваши открытые ставки. Сейчас активные ставки ещё не подключены." navigate={navigate} />}
      {segment === 'express' && <Placeholder title="Экспрессы" text="Раздел экспрессов готовится. Мы покажем его только после подключения реальных данных." navigate={navigate} />}

      {segment === 'history' && (
        <div className="bets-history-content">
          {loading && <HistorySkeleton />}
          {!loading && error && (
            <div className="bets-history-state bets-history-state-error">
              <p>{error}</p>
              <button type="button" className="bets-page-cta" onClick={() => loadHistory()}>Повторить</button>
            </div>
          )}
          {!loading && !error && (
            <>
              <Summary summary={summary} />
              {items.length > 0 ? (
                <div className="bets-history-list">
                  {items.map((card) => (
                    <HistoryCard
                      card={card}
                      expanded={expandedId === card.id}
                      key={card.id}
                      onToggle={() => setExpandedId((current) => current === card.id ? null : card.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="bets-history-state bets-history-empty-state">
                  <h2>{emptyState?.message || 'История пока пуста'}</h2>
                  <p>Сохраняйте прогнозы, чтобы видеть результаты и прибыль в одном месте.</p>
                  <button type="button" className="bets-page-cta" onClick={() => navigate('/recommendations')}>
                    {emptyState?.cta?.label || 'Открыть рекомендации'}
                  </button>
                </div>
              )}
              {canLoadMore && (
                <button className="bets-history-load-more" type="button" disabled={loadingMore} onClick={() => loadHistory({ append: true })}>
                  {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
