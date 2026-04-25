import React, { useEffect, useMemo, useState } from 'react';
import { getFavorites, getHistory, getRecommendations, setFavorites, auth } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { formatRelativeUpdatedAt, getTopRecommendations } from '../lib/recommendations.js';

const CATALOG = {
  sports: ['football', 'tennis', 'basketball', 'hockey', 'esports'],
  leagues: ['Premier League', 'ATP', 'NBA', 'KHL', 'ESL Pro League', 'La Liga'],
};

function uniqTrimmed(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function RecommendationCard({ item }) {
  const detailsHref = `/webapp/match/${encodeURIComponent(item.id || '')}`;

  return (
    <article className="recommendation-card" data-id={item.id || ''}>
      <div className="recommendation-head">
        <h3>{item.match || 'Матч'}</h3>
        {item.is_new ? <span className="recommendation-badge">Новые</span> : null}
      </div>
      <div className="recommendation-meta">{item.league || ''} · {formatMoscowDateTime(item.starts_at || '')}</div>
      <p>{item.main_thought || ''}</p>
      <div className="recommendation-confidence">Уверенность: {item.confidence ?? '—'}%</div>
      <div className="recommendation-actions">
        {item.source_url ? (
          <a href={item.source_url} target="_blank" rel="noopener noreferrer">Открыть источник</a>
        ) : (
          <a href={detailsHref}>Подробнее</a>
        )}
      </div>
    </article>
  );
}

function ChipsRow({ values, onRemove, type }) {
  if (!values.length) {
    return <span className="recommendations-empty">Пока пусто</span>;
  }

  return values.map((value) => (
    <span className="chip" key={`${type}-${value}`}>
      {value}
      <button type="button" onClick={() => onRemove(type, value)}>×</button>
    </span>
  ));
}

export function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsError, setRecommendationsError] = useState('');
  const [isRecommendationsLoading, setIsRecommendationsLoading] = useState(true);
  const [refreshStatus, setRefreshStatus] = useState('');

  const [favorites, setFavoritesState] = useState({ sports: [], leagues: [] });
  const [history, setHistory] = useState({ items: [], empty_state: null, error: '' });

  const [modal, setModal] = useState({
    isOpen: false,
    openedFor: 'sports',
    query: '',
    pending: {
      sports: [],
      leagues: [],
    },
  });

  const currentOptions = useMemo(() => {
    const kind = modal.openedFor;
    const options = CATALOG[kind] || [];
    const query = String(modal.query || '').toLowerCase().trim();

    if (!query) {
      return options;
    }

    return options.filter((name) => name.toLowerCase().includes(query));
  }, [modal.openedFor, modal.query]);

  async function refreshRecommendations() {
    setRefreshStatus('Обновляем...');
    setRecommendationsError('');

    try {
      const payload = await getRecommendations();
      setRecommendations(getTopRecommendations(payload?.items || []));
      setRefreshStatus(formatRelativeUpdatedAt(payload?.updated_at || new Date().toISOString()));
    } catch {
      setRecommendationsError('Не удалось обновить рекомендации.');
      setRefreshStatus('Ошибка обновления');
      if (!recommendations.length) {
        setRecommendations([]);
      }
    } finally {
      setIsRecommendationsLoading(false);
    }
  }

  async function loadFavorites() {
    try {
      const payload = await getFavorites();
      setFavoritesState({
        sports: uniqTrimmed(payload?.sports),
        leagues: uniqTrimmed(payload?.leagues),
      });
    } catch {
      setFavoritesState({ sports: [], leagues: [] });
    }
  }

  async function persistFavorites(nextFavorites) {
    setFavoritesState(nextFavorites);
    await setFavorites(nextFavorites);
  }

  async function loadHistory() {
    try {
      const payload = await getHistory();
      setHistory({
        items: Array.isArray(payload?.items) ? payload.items : [],
        empty_state: payload?.empty_state || null,
        error: '',
      });
    } catch {
      setHistory({ items: [], empty_state: null, error: 'Не удалось загрузить историю' });
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    (async () => {
      await Promise.allSettled([
        auth(),
        refreshRecommendations(),
        loadFavorites(),
        loadHistory(),
      ]);

      if (!cancelled) {
        timerId = setInterval(() => {
          refreshRecommendations();
        }, 180000);
      }
    })();

    return () => {
      cancelled = true;
      if (timerId) {
        clearInterval(timerId);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openFavoritesModal(kind = 'sports') {
    const openedFor = kind === 'leagues' ? 'leagues' : 'sports';

    setModal({
      isOpen: true,
      openedFor,
      query: '',
      pending: {
        sports: [...favorites.sports],
        leagues: [...favorites.leagues],
      },
    });
  }

  function closeFavoritesModal() {
    setModal((prev) => ({ ...prev, isOpen: false }));
  }

  function toggleOption(value, checked) {
    const kind = modal.openedFor;
    const current = new Set(modal.pending[kind] || []);
    if (checked) current.add(value);
    else current.delete(value);

    setModal((prev) => ({
      ...prev,
      pending: {
        ...prev.pending,
        [kind]: [...current],
      },
    }));
  }

  async function applyFavorites() {
    const next = {
      sports: uniqTrimmed(modal.pending.sports),
      leagues: uniqTrimmed(modal.pending.leagues),
    };

    closeFavoritesModal();
    try {
      await persistFavorites(next);
    } catch {
      await loadFavorites();
    }
  }

  async function removeFavorite(type, value) {
    const next = {
      sports: type === 'sports' ? favorites.sports.filter((item) => item !== value) : [...favorites.sports],
      leagues: type === 'leagues' ? favorites.leagues.filter((item) => item !== value) : [...favorites.leagues],
    };

    try {
      await persistFavorites(next);
    } catch {
      await loadFavorites();
    }
  }

  return (
    <>
      <header className="header" id="top-header">
        <div className="brand-row">
          <h1>Tiger Bet</h1>
          <button id="refresh-btn" type="button" onClick={refreshRecommendations}>Обновить сейчас</button>
        </div>

        <nav className="anchors" aria-label="Навигация по блокам">
          <a href="#recommendations">Рекомендации</a>
          <a href="#favorites-sports">Спорт</a>
          <a href="#favorites-leagues">Лиги</a>
        </nav>

        <div className="refresh-status" aria-live="polite">{refreshStatus}</div>
      </header>

      <main className="layout">
        <section id="recommendations">
          <h2>Рекомендованные матчи</h2>
          <div className="block-error" aria-live="polite">
            {recommendationsError ? (
              <>
                <span>{recommendationsError} </span>
                <button type="button" onClick={refreshRecommendations}>Повторить</button>
              </>
            ) : null}
          </div>

          <div id="recommendations-list">
            {isRecommendationsLoading ? <div>Загрузка...</div> : null}
            {!isRecommendationsLoading && recommendations.length === 0 ? <div className="recommendations-empty">Нет рекомендаций</div> : null}
            {!isRecommendationsLoading && recommendations.map((item) => <RecommendationCard item={item} key={item.id || item.match} />)}
          </div>
        </section>

        <section id="favorites-sports">
          <div className="section-head">
            <h2>Избранные виды спорта</h2>
            <button id="add-sports-btn" type="button" onClick={() => openFavoritesModal('sports')}>+ Добавить</button>
          </div>
          <div id="sports-chips" className="chips-row">
            <ChipsRow values={favorites.sports} onRemove={removeFavorite} type="sports" />
          </div>
        </section>

        <section id="favorites-leagues">
          <div className="section-head">
            <h2>Избранные лиги</h2>
            <button id="add-leagues-btn" type="button" onClick={() => openFavoritesModal('leagues')}>+ Добавить</button>
          </div>
          <div id="leagues-chips" className="chips-row">
            <ChipsRow values={favorites.leagues} onRemove={removeFavorite} type="leagues" />
          </div>
        </section>

        <section id="history">
          <h2>Последние прогнозы</h2>
          <div id="history-list">
            {history.error ? history.error : null}
            {!history.error && (!Array.isArray(history.items) || history.items.length === 0) ? (
              <>
                {history.empty_state?.message || 'История пока пустая'}{' '}
                <a href={history.empty_state?.cta?.target || '#recommendations'}>{history.empty_state?.cta?.label || 'Открыть рекомендации'}</a>
              </>
            ) : null}
            {!history.error && Array.isArray(history.items) && history.items.map((item) => (
              <article className="recommendation-card" key={`history-${item.id || item.match}`}>
                <h3>{item.match || 'Матч'}</h3>
                <div className="recommendation-meta">{item.league || ''} · {formatMoscowDateTime(item.starts_at || '')}</div>
                <p>{item.main_thought || ''}</p>
                <div className="recommendation-confidence">Уверенность: {item.confidence ?? '—'}%</div>
              </article>
            ))}
          </div>
        </section>
      </main>

      {modal.isOpen ? (
        <div id="favorites-modal" className="modal" aria-hidden="false">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="favorites-modal-title">
            <div className="modal-head">
              <h3 id="favorites-modal-title">Управление избранным</h3>
              <button id="favorites-close-btn" type="button" aria-label="Закрыть" onClick={closeFavoritesModal}>×</button>
            </div>

            <input
              id="favorites-search"
              type="search"
              placeholder="Поиск по спорту и лигам"
              value={modal.query}
              onChange={(event) => setModal((prev) => ({ ...prev, query: event.target.value || '' }))}
            />

            <div id="favorites-options" className="favorites-options">
              {currentOptions.length === 0 ? (
                <div className="recommendations-empty">Ничего не найдено</div>
              ) : currentOptions.map((value) => {
                const kind = modal.openedFor;
                const isChecked = (modal.pending[kind] || []).includes(value);

                return (
                  <label className="favorite-option" key={`${kind}-${value}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) => toggleOption(value, event.target.checked)}
                    />
                    {value}
                  </label>
                );
              })}
            </div>

            <div className="modal-actions">
              <button id="favorites-apply-btn" type="button" onClick={applyFavorites}>Применить</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
