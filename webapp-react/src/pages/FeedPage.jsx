import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth, getFeed } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { collectAvailableSports } from '../lib/feed.js';
import { FeedBetModal } from '../components/FeedBetModal.jsx';

function FeedCard({ item, onOpen }) {
  const { primary_bet } = item;
  const meta = [item.sport, item.country, item.league].filter(Boolean).join(' · ');

  return (
    <article
      className="feed-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(item); }}
    >
      <div className="feed-card-header">
        <span className="feed-card-meta">{meta || '—'}</span>
        <span className="feed-card-time">{formatMoscowDateTime(item.starts_at) || '—'}</span>
      </div>
      <h3 className="feed-card-match">{item.match || 'Матч'}</h3>
      {primary_bet ? (
        <div className="feed-card-bet">
          <span className="feed-card-forecast">{primary_bet.forecast}</span>
          <span className="feed-card-coeff">× {primary_bet.coeff ?? '—'}</span>
        </div>
      ) : null}
      {item.summary ? (
        <p className="feed-card-summary">{item.summary}</p>
      ) : null}
    </article>
  );
}

export function FeedPage() {
  const [authGate, setAuthGate] = useState('pending');
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [staleNotice, setStaleNotice] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [availableSports, setAvailableSports] = useState([]);
  const [modal, setModal] = useState(null);
  const [feedVersion, setFeedVersion] = useState('');

  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const feedVersionRef = useRef('');

  const syncFeedVersion = useCallback((nextVersion) => {
    const normalized = String(nextVersion || '').trim();
    feedVersionRef.current = normalized;
    setFeedVersion(normalized);
  }, []);

  const resetFeedVersion = useCallback(() => {
    syncFeedVersion('');
  }, [syncFeedVersion]);

  const reloadFromStart = useCallback(async (sport, message) => {
    if (message) {
      setStaleNotice(message);
    }
    setOffset(0);
    resetFeedVersion();
    await fetchPage('all', sport, 0, true, { ignoreStaleOnce: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFeedVersion]);

  async function fetchPage(win, sport, off, isFirstPage, options = {}) {
    if (isFirstPage) {
      setIsLoading(true);
      setError('');
    }

    const requestedVersionSource = options.feedVersion ?? (!isFirstPage ? feedVersionRef.current : '');
    const requestedVersion = String(requestedVersionSource || '').trim();

    try {
      const data = await getFeed({
        window: win,
        sport,
        feed_version: requestedVersion || undefined,
        limit: 10,
        offset: off,
      });
      const newItems = data.items || [];

      if (isFirstPage) {
        setItems(newItems);
        setAvailableSports((prev) => collectAvailableSports(data, {
          fallbackSports: prev,
          preserveFallback: Boolean(sport),
        }));
        setStaleNotice('');
      } else {
        setItems((prev) => [...prev, ...newItems]);
      }

      syncFeedVersion(data.feed_version || '');
      setHasMore(!!data.has_more);
      setOffset(data.next_offset ?? off + 10);
    } catch (err) {
      if (err?.status === 409 && err?.payload?.error === 'STALE_FEED_VERSION') {
        if (!options.ignoreStaleOnce) {
          await reloadFromStart(sport, err?.payload?.message || 'Лента обновилась');
          return;
        }
      }

      if (isFirstPage) {
        setError('Не удалось загрузить ленту.');
      }
    } finally {
      if (isFirstPage) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await auth();
        setAuthGate('ok');
      } catch {
        setAuthGate('unauthorized');
        setIsLoading(false);
        return;
      }
      await fetchPage('all', '', 0, true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const data = await getFeed({
        window: 'all',
        sport: sportFilter,
        feed_version: feedVersionRef.current || undefined,
        limit: 10,
        offset,
      });
      setItems((prev) => [...prev, ...(data.items || [])]);
      syncFeedVersion(data.feed_version || '');
      setHasMore(!!data.has_more);
      setOffset(data.next_offset ?? offset + 10);
    } catch (err) {
      if (err?.status === 409 && err?.payload?.error === 'STALE_FEED_VERSION') {
        await reloadFromStart(sportFilter, err?.payload?.message || 'Лента обновилась');
      }
      // otherwise silent — user can trigger retry by scrolling up and back
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [feedVersion, hasMore, offset, reloadFromStart, sportFilter, syncFeedVersion]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  function applySportFilter(sport) {
    const next = sport === sportFilter ? '' : sport;
    setSportFilter(next);
    setOffset(0);
    resetFeedVersion();
    fetchPage('all', next, 0, true);
  }

  if (authGate === 'pending') {
    return (
      <main className="layout centered-layout">
        <section className="card auth-card">
          <h2>Проверяем доступ…</h2>
          <p>Подождите пару секунд.</p>
        </section>
      </main>
    );
  }

  if (authGate === 'unauthorized') {
    return (
      <main className="layout centered-layout">
        <section className="card auth-card">
          <h2>Доступ ограничен</h2>
          <p>Откройте приложение через кнопку в Telegram-боте.</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="feed-filters">
        {availableSports.length > 0 ? (
          <div className="feed-filter-chips">
            {availableSports.map((sport) => (
              <button
                key={sport}
                type="button"
                className={`feed-filter-chip${sportFilter === sport ? ' active' : ''}`}
                onClick={() => applySportFilter(sport)}
              >
                {sport}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <main className="layout feed-layout">
        {staleNotice ? (
          <div className="feed-status">{staleNotice}</div>
        ) : null}

        {error ? (
          <div className="block-error feed-error">
            <span>{error} </span>
            <button className="secondary-button" type="button" onClick={() => fetchPage('all', sportFilter, 0, true)}>
              Повторить
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="feed-status">Загрузка...</div>
        ) : null}

        {!isLoading && items.length === 0 && !error ? (
          <div className="feed-status recommendations-empty">
            <strong>Нет ближайших событий</strong>
            <div>Когда появятся события со стартом в ближайшие 2 часа, они отобразятся здесь.</div>
          </div>
        ) : null}

        {!isLoading ? items.map((item) => (
          <FeedCard key={item.id} item={item} onOpen={setModal} />
        )) : null}

        <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />

        {isLoadingMore ? (
          <div className="feed-status">Загружаем ещё...</div>
        ) : null}
      </main>

      {modal ? (
        <FeedBetModal item={modal} onClose={() => setModal(null)} />
      ) : null}
    </>
  );
}
