import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getHistory } from '../lib/api.js';
import {
  getHistoryStatusPresentation,
  hasNextHistoryPage,
  mapHistoryCard,
  getRecentBetStreak,
  getAverageOdds,
  filterHistoryCardsByPeriod,
  getHistoryStatsFromCards,
  aggregateBetsByMarketType,
  aggregateBetsByDirection,
  formatProfitUnits,
} from '../lib/bets-history.js';
import { formatMoscowDateTime } from '../lib/format.js';

const HISTORY_LIMIT = 20;
const SEGMENTS = [
  { id: 'active', label: 'Активные' },
  { id: 'history', label: 'История' },
  { id: 'express', label: 'Экспрессы' },
];

const PERIODS = ['Неделя', 'Месяц', 'Всё время'];

function formatOdds(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(2);
}

function pluralBets(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? 'ставка'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
      ? 'ставки'
      : 'ставок';

  return `${count} ${word}`;
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

function Summary({ summary, items, period, onPeriodChange }) {
  const streak = getRecentBetStreak(items);
  const averageOdds = getAverageOdds(items);
  const hitRate = Math.max(0, Math.min(100, summary.hit_rate_percent ?? 0));
  const profitTone = summary.profit_units >= 0 ? 'positive' : 'negative';

  return (
    <>
      <div className="bets-history-periods" role="tablist" aria-label="Период истории">
        {PERIODS.map((item) => (
          <button className={`bets-history-period ${period === item ? 'bets-history-period-active' : ''}`} key={item} type="button" role="tab" aria-selected={period === item} onClick={() => onPeriodChange(item)}>
            {item}
          </button>
        ))}
      </div>
      <section className="bets-history-overview" aria-label="Сводка истории">
        <div className={`bets-history-donut ${summary.hit_rate_percent == null ? 'bets-history-donut-empty' : ''}`} style={{ '--hit-rate': `${hitRate}%` }}>
          <div className="bets-history-donut-center"><strong>{summary.hit_rate_label}</strong><span>ЗАШЛО</span></div>
        </div>
        <div className="bets-history-legend">
          {[
            ['won', 'Зашло', summary.won_count],
            ['lost', 'Не зашло', summary.lost_count],
            ['void', 'Возврат', summary.void_count],
          ].map(([code, label, count]) => (
            <div className="bets-history-legend-row" key={code}><span className={`bets-history-legend-dot bets-history-legend-dot-${code}`} /><span>{label}</span><strong>{count}</strong></div>
          ))}
          <div className="bets-history-neutral-info">Ждём {summary.pending_count} · Не рассчитываем {summary.not_supported_count}</div>
        </div>
      </section>
      <div className="bets-history-metrics" aria-label="Метрики истории">
        <div><span>Проходимость</span><strong>{summary.hit_rate_label}</strong><small>зашло от рассчитанных</small></div>
        <div><span>Чистыми</span><strong className={`bets-history-summary-${profitTone}`}>{summary.profit_label} ед.</strong><small>по выбранному периоду</small></div>
        <div><span>Ср. коэф.</span><strong>{averageOdds == null ? '—' : averageOdds.toFixed(2)}</strong><small>по загруженным ставкам</small></div>
      </div>
      <div className="bets-history-recent">
        <div className="bets-history-section-heading"><strong>Последние ставки</strong><span>{summary.won_count} В · {summary.lost_count} П · {summary.void_count} возврат</span></div>
        <div className="bets-history-streak" aria-label="Последние результаты">
          {streak.length > 0 ? streak.map((item, index) => <span className={`bets-history-streak-square bets-history-streak-${item.code}`} key={`${item.code}-${index}`}>{item.marker}</span>) : <span className="bets-history-recent-empty">Нет рассчитанных ставок</span>}
        </div>
      </div>
    </>
  );
}

function BetBreakdown({ title, groups }) {
  return (
    <section className="bets-history-breakdown" aria-label={title}>
      <div className="bets-history-breakdown-title">{title}</div>
      {groups.length > 0 ? groups.map((group) => {
        const resultCounts = [
          ['Зашло', group.won],
          ['Не зашло', group.lost],
          ['Возврат', group.void],
          ['Ждём', group.pending],
          ['Не рассчитываем', group.not_supported],
        ];

        return (
        <div className="bets-history-breakdown-row" key={group.key}>
          <div className="bets-history-breakdown-main">
            <strong>{group.label}</strong>
            <span>{pluralBets(group.total)}</span>
          </div>
          <div className="bets-history-breakdown-stats">
            <strong>{group.hit_rate_percent == null ? '—' : `${group.hit_rate_percent.toFixed(2)}%`}</strong>
            <span className={group.profit_units >= 0 ? 'bets-history-profit-positive' : 'bets-history-profit-negative'}>{formatProfitUnits(group.profit_units)} ед.</span>
          </div>
          <div className="bets-history-breakdown-counts" aria-label="Счётчики результатов">
            {resultCounts.map(([label, count]) => <span key={label}>{label} {count}</span>)}
          </div>
        </div>
        );
      }) : <div className="bets-history-breakdown-empty">Нет данных за период</div>}
    </section>
  );
}

function BetBreakdowns({ items }) {
  const byMarketType = useMemo(() => aggregateBetsByMarketType(items), [items]);
  const byDirection = useMemo(() => aggregateBetsByDirection(items), [items]);

  return (
    <div className="bets-history-breakdowns">
      <BetBreakdown title="По типам ставок" groups={byMarketType} />
      <BetBreakdown title="По направлениям" groups={byDirection} />
    </div>
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
  const [period, setPeriod] = useState('Всё время');
  const [items, setItems] = useState([]);
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
  const filteredItems = useMemo(() => filterHistoryCardsByPeriod(items, period), [items, period]);
  const filteredSummary = useMemo(() => getHistoryStatsFromCards(filteredItems), [filteredItems]);

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
              <Summary summary={filteredSummary} items={filteredItems} period={period} onPeriodChange={setPeriod} />
              <BetBreakdowns items={filteredItems} />
              <div className="bets-history-list-heading">История ставок</div>
              {filteredItems.length > 0 ? (
                <div className="bets-history-list">
                  {filteredItems.map((card) => (
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
