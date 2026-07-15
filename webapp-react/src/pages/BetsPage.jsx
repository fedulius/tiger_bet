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
  aggregateBetsByProbability,
  aggregateBetsByReferenceDirection,
  getProfitBuckets,
  getHistoryRecords,
  getHistoryRecordStreaks,
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

function ProgressRow({ group, tone }) {
  const rate = group.hit_rate_percent == null ? 0 : Math.max(0, Math.min(100, group.hit_rate_percent));
  return (
    <div className="bets-analytics-row">
      <div className={`bets-analytics-dot bets-analytics-dot-${tone}`} />
      <div className="bets-analytics-row-main">
        <div className="bets-analytics-row-top"><strong>{group.label}</strong><span>{pluralBets(group.total)}</span></div>
        <div className="bets-analytics-track"><span className={`bets-analytics-fill bets-analytics-fill-${tone}`} style={{ width: `${rate}%` }} /></div>
      </div>
      <strong className="bets-analytics-rate">{group.hit_rate_percent == null ? '—' : `${group.hit_rate_percent.toFixed(0)}%`}</strong>
    </div>
  );
}

function AnalyticsGroup({ title, groups, tones = [] }) {
  return (
    <section className="bets-analytics-section" aria-label={title}>
      <div className="bets-analytics-label">{title}</div>
      <div className="bets-analytics-card">
        {groups.length > 0 ? groups.map((group, index) => <ProgressRow key={group.key} group={group} tone={tones[index] || 'neutral'} />) : <div className="bets-analytics-empty">Нет данных за период</div>}
      </div>
    </section>
  );
}

function ProfitChart({ records }) {
  const buckets = getProfitBuckets(records);
  const max = Math.max(1, ...buckets.map((bucket) => Math.abs(bucket.value)));
  return (
    <section className="bets-analytics-section" aria-label="Динамика профита">
      <div className="bets-analytics-label">ДИНАМИКА ПРОФИТА</div>
      <div className="bets-profit-card">
        {buckets.length > 0 ? <div className="bets-profit-bars">{buckets.map((bucket) => (
          <div className="bets-profit-column" key={bucket.label}>
            <span className={`bets-profit-value ${bucket.value >= 0 ? 'bets-history-profit-positive' : 'bets-history-profit-negative'}`}>{bucket.value >= 0 ? '+' : ''}{bucket.value}</span>
            <div className="bets-profit-bar-wrap"><span className={`bets-profit-bar ${bucket.value >= 0 ? 'bets-profit-bar-positive' : 'bets-profit-bar-negative'}`} style={{ height: `${Math.max(8, Math.round(Math.abs(bucket.value) / max * 100))}%` }} /></div>
            <span className="bets-profit-label">{bucket.label}</span>
          </div>
        ))}</div> : <div className="bets-analytics-empty">Нет данных за период</div>}
      </div>
    </section>
  );
}

function Records({ records, directionGroups }) {
  const { current, best } = getHistoryRecordStreaks(records);
  const oddsGroups = [
    { label: '<1.80', test: (value) => value < 1.8 },
    { label: '1.80–2.20', test: (value) => value >= 1.8 && value <= 2.2 },
    { label: '>2.20', test: (value) => value > 2.2 },
  ].map((group) => {
    const bets = records.filter((record) => Number.isFinite(Number(record.odds_decimal)) && group.test(Number(record.odds_decimal)));
    const settled = bets.filter((record) => ['won', 'lost'].includes(record.result_code));
    return { ...group, rate: settled.length > 0 ? settled.filter((record) => record.result_code === 'won').length / settled.length : -1, total: bets.length };
  });
  const bestOdds = oddsGroups.filter((group) => group.total > 0).sort((a, b) => b.rate - a.rate)[0]?.label || '—';
  const favorite = directionGroups.filter((group) => group.key !== 'other').sort((a, b) => b.total - a.total)[0]?.label || '—';
  const stakes = records
    .map((record) => Number(record?.stake_units ?? record?.stake))
    .filter((value) => Number.isFinite(value));
  const averageStake = stakes.length > 0
    ? `${(stakes.reduce((sum, value) => sum + value, 0) / stakes.length).toFixed(2)} pts`
    : '—';
  const rows = [['Текущая серия', `${current} побед`], ['Лучшая серия', `${best} побед`], ['Средняя ставка', averageStake], ['Любимое направление', favorite], ['Лучший диапазон коэф.', bestOdds]];
  return <section className="bets-analytics-section" aria-label="Показатели и рекорды"><div className="bets-analytics-label">ПОКАЗАТЕЛИ И РЕКОРДЫ</div><div className="bets-records-card">{rows.map(([label, value]) => <div className="bets-record-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>;
}

function BetBreakdowns({ items }) {
  const probabilityGroups = useMemo(() => aggregateBetsByProbability(items), [items]);
  const directionGroups = useMemo(() => aggregateBetsByReferenceDirection(items).filter((group) => group.key !== 'other'), [items]);
  const records = useMemo(() => getHistoryRecords(items), [items]);
  return <div className="bets-history-breakdowns">
    <AnalyticsGroup title="ПО ТИПУ СТАВОК" groups={probabilityGroups} tones={['green', 'amber', 'red']} />
    <AnalyticsGroup title="ПО НАПРАВЛЕНИЮ" groups={directionGroups} tones={['green', 'amber', 'amber', 'red', 'red']} />
    <ProfitChart records={records} />
    <Records records={records} directionGroups={directionGroups} />
  </div>;
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

function FlatBetCard({ record }) {
  const date = formatMoscowDateTime(record.date);
  const result = getHistoryStatusPresentation(record.result_code);
  const meta = [date, record.league].filter(Boolean).join(' · ');
  return <article className="bets-flat-card">
    <div className="bets-flat-main"><strong>{record.match || 'Матч'}</strong><span className="bets-flat-label">{record.label || record.market_name || 'Ставка'}</span>{meta && <span className="bets-flat-meta">{meta}</span>}</div>
    <div className="bets-flat-aside"><strong>{formatOdds(record.odds_decimal)}</strong><span className={statusClass(result.code)}>{result.label}</span><span className={record.profit_units >= 0 ? 'bets-history-profit-positive' : 'bets-history-profit-negative'}>{record.profit_label}</span></div>
  </article>;
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
              <div className="bets-analytics-label bets-history-all-label">ВСЕ СТАВКИ</div>
              {filteredItems.length > 0 ? (
                <div className="bets-flat-list">
                  {getHistoryRecords(filteredItems).map((record) => <FlatBetCard key={record.id} record={record} />)}
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
