import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFavorites, getRecommendations, setFavorites, auth } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { formatRelativeUpdatedAt, getTopRecommendations } from '../lib/recommendations.js';
import { BetModal, RISK_LEVELS } from '../components/BetModal.jsx';

const DEFAULT_CATALOG = {
  sports: [],
  sportUrlMap: {},
  leaguesBySport: {},
};

const SPORT_ICON_SVG_BY_SLUG = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/sport-icons/*.svg', { eager: true, query: '?raw', import: 'default' }))
    .map(([path, svg]) => [path.split('/').pop().replace('.svg', ''), svg]),
);

function uniqTrimmed(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function normalizeSportSetting(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = String(item.name || item.sport || '').trim();
  if (!name) {
    return null;
  }

  const leagues = uniqTrimmed(item.leagues);
  const availableLeagues = uniqTrimmed(item.available_leagues);
  const sportUrl = String(item.sport_url || '').trim();

  return {
    name,
    sportUrl,
    leagues,
    allLeagues: item.all_leagues !== false ? leagues.length === 0 : false,
    availableLeagues,
    summary: String(item.leagues_summary || '').trim() || (leagues.length === 0 ? 'Все лиги' : leagues.join(', ')),
  };
}

function normalizeFavoritesPayload(payload) {
  const sports = (Array.isArray(payload?.sports) ? payload.sports : [])
    .map(normalizeSportSetting)
    .filter(Boolean);

  const availableSportsRaw = Array.isArray(payload?.available_sports) ? payload.available_sports : [];
  const sportUrlMap = {};
  const availableSportsNames = [];
  for (const item of availableSportsRaw) {
    const name = typeof item === 'string' ? item.trim() : String(item?.sport_name || '').trim();
    const url = typeof item === 'object' ? String(item?.sport_url || '').trim() : '';
    if (name) {
      availableSportsNames.push(name);
      if (url) sportUrlMap[name] = url;
    }
  }

  return {
    sports,
    availableSports: [...new Set(availableSportsNames)],
    sportUrlMap,
    leaguesBySport: payload?.leagues_catalog && typeof payload.leagues_catalog === 'object'
      ? Object.fromEntries(Object.entries(payload.leagues_catalog).map(([key, value]) => [String(key || '').trim(), uniqTrimmed(value)]))
      : {},
  };
}

function RecommendationCard({ item, onOpenBet }) {
  const bets = Array.isArray(item.bets) ? item.bets.slice(0, 3) : [];
  const defaultBetIndex = bets.findIndex(Boolean);

  return (
    <article className="recommendation-card" data-id={item.id || ''}>
      <button
        type="button"
        className="card-link"
        onClick={defaultBetIndex >= 0 ? () => onOpenBet(item, defaultBetIndex) : undefined}
      >
        <div className="recommendation-head">
          <div>
            <h3>{item.match || 'Матч'}</h3>
            <p className="recommendation-subtitle">{[item.sport_name, item.league].filter(Boolean).join(' · ') || 'Лига не указана'}</p>
          </div>
          {item.is_new ? <span className="recommendation-badge">Новый</span> : null}
        </div>
        <p className="card-time">{formatMoscowDateTime(item.starts_at || '') || '—'}</p>
      </button>
      {bets.length > 0 ? (
        <div className="risk-buttons">
          {RISK_LEVELS.map((risk, i) => (
            bets[i] ? (
              <button
                key={risk.key}
                className={`risk-btn risk-btn-${risk.key}`}
                type="button"
                onClick={() => onOpenBet(item, i)}
              >
                {risk.label}
                <span className="risk-btn-coeff">× {bets[i].coeff ?? '—'}</span>
              </button>
            ) : null
          ))}
        </div>
      ) : null}
    </article>
  );
}

function getSportIconDataUrl(sportUrl) {
  const slug = String(sportUrl || '').trim();
  const svg = slug ? SPORT_ICON_SVG_BY_SLUG[slug] : '';

  if (!svg) {
    return '';
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function SportIcon({ sportUrl, alt, className }) {
  const src = getSportIconDataUrl(sportUrl);

  if (!src) {
    return null;
  }

  return <img className={className} src={src} alt={alt} />;
}

function SportSettingCard({ item, onConfigure, onRemove }) {
  const leagueCount = item.leagues && item.leagues.length > 0 ? item.leagues.length : 0;
  const leagueLabel = leagueCount > 0 ? `${leagueCount} выбранные лиги` : 'Все лиги включены';
  const showTags = item.leagues && item.leagues.length > 0;

  return (
    <article className="sport-card" data-id={`favorite-sport-${item.name}`}>
      <div className="sport-card-head">
        <div className="sport-card-meta">
          <div className="sport-icon sport-icon-default">
            <SportIcon className="sport-icon-img" sportUrl={item.sportUrl} alt={item.name} />
          </div>
          <div>
            <h3 className="sport-name">{item.name}</h3>
            <p className="sport-leagues">{leagueLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(item.name)}
          aria-label="Удалить"
          className="sport-remove-btn"
        >
          <span className="sport-remove-glyph">×</span>
        </button>
      </div>

      {showTags && (
        <div className="sport-tags-row">
          {item.leagues.map((league) => (
            <span key={league} className="league-tag">{league}</span>
          ))}
        </div>
      )}

      <button
        className="primary-button sport-configure-btn"
        type="button"
        onClick={() => onConfigure(item.name)}
      >
        Настроить лиги
      </button>
    </article>
  );
}

export function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsError, setRecommendationsError] = useState('');
  const [isRecommendationsLoading, setIsRecommendationsLoading] = useState(true);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [authGate, setAuthGate] = useState('pending');
  const recommendationsVersionRef = useRef('');

  const [favorites, setFavoritesState] = useState({ sports: [] });
  const [catalog, setCatalog] = useState(DEFAULT_CATALOG);

  const [betModal, setBetModal] = useState({ isOpen: false, item: null, betIndex: 0 });
  const [confirmRemove, setConfirmRemove] = useState({ isOpen: false, sportName: '' });
  const [confirmRemoveClosing, setConfirmRemoveClosing] = useState(false);
  const [favoritesModalClosing, setFavoritesModalClosing] = useState(false);

  const [modal, setModal] = useState({
    isOpen: false,
    mode: 'sports',
    query: '',
    pendingSports: [],
    selectedSportName: '',
    pendingLeagues: [],
  });

  const availableSportsToAdd = useMemo(() => {
    const selected = new Set(favorites.sports.map((item) => item.name));
    const query = String(modal.query || '').toLowerCase().trim();

    return (catalog.sports || []).filter((name) => {
      if (selected.has(name)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return name.toLowerCase().includes(query);
    });
  }, [catalog.sports, favorites.sports, modal.query]);

  const availableLeaguesForSelectedSport = useMemo(() => {
    const query = String(modal.query || '').toLowerCase().trim();
    const options = catalog.leaguesBySport?.[modal.selectedSportName] || [];

    return options.filter((name) => (!query ? true : name.toLowerCase().includes(query)));
  }, [catalog.leaguesBySport, modal.query, modal.selectedSportName]);

  const stats = useMemo(() => ({
    recommendations: recommendations.length,
    sports: favorites.sports.length,
  }), [favorites.sports.length, recommendations.length]);

  async function refreshRecommendations(options = {}) {
    setRefreshStatus('Обновляем...');
    setRecommendationsError('');

    const requestedVersionSource = options.recommendationsVersion ?? recommendationsVersionRef.current;
    const requestedVersion = options.resetVersion
      ? ''
      : String(requestedVersionSource || '').trim();

    try {
      const payload = await getRecommendations(
        requestedVersion ? { recommendations_version: requestedVersion } : {},
      );
      recommendationsVersionRef.current = String(payload?.recommendations_version || '').trim();
      setRecommendations(getTopRecommendations(payload?.items || []));
      setRefreshStatus(formatRelativeUpdatedAt(payload?.updated_at || new Date().toISOString()));
    } catch (error) {
      if (error?.status === 409 && error?.payload?.error === 'STALE_RECOMMENDATIONS_VERSION') {
        recommendationsVersionRef.current = '';
        setRecommendationsError(String(error?.payload?.message || 'Рекомендации обновились'));
        return await refreshRecommendations({ resetVersion: true });
      }
      setRecommendationsError('Не удалось обновить рекомендации.');
      setRefreshStatus('Ошибка обновления');
      if (!recommendations.length) {
        setRecommendations([]);
      }
    } finally {
      setIsRecommendationsLoading(false);
    }
  }

  async function authorizeWebApp() {
    const authResult = await auth().then(() => ({ ok: true })).catch(() => ({ ok: false }));

    if (!authResult.ok) {
      setAuthGate('unauthorized');
      setRecommendationsError('Не удалось авторизоваться.');
      setRefreshStatus('Ошибка авторизации');
      return false;
    }

    setAuthGate('ok');
    return true;
  }

  async function refreshRecommendationsWithAuth() {
    setIsRecommendationsLoading(true);
    const authorized = await authorizeWebApp();

    if (!authorized) {
      setIsRecommendationsLoading(false);
      return;
    }

    await refreshRecommendations();
  }

  async function loadFavorites() {
    try {
      const payload = await getFavorites();
      const normalized = normalizeFavoritesPayload(payload);
      setFavoritesState({ sports: normalized.sports });
      setCatalog({
        sports: normalized.availableSports,
        sportUrlMap: normalized.sportUrlMap,
        leaguesBySport: normalized.leaguesBySport,
      });
    } catch {
      setFavoritesState({ sports: [] });
      setCatalog(DEFAULT_CATALOG);
    }
  }

  async function persistFavorites(nextFavorites) {
    setFavoritesState(nextFavorites);
    const payload = await setFavorites({
      sports: nextFavorites.sports.map((item) => ({
        name: item.name,
        leagues: item.allLeagues ? [] : uniqTrimmed(item.leagues),
      })),
    });

    const normalized = normalizeFavoritesPayload(payload);
    setFavoritesState({ sports: normalized.sports });
    recommendationsVersionRef.current = '';
    await refreshRecommendations({ resetVersion: true });
  }

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    (async () => {
      const authorized = await authorizeWebApp();

      if (authorized) {
        await Promise.allSettled([
          refreshRecommendations(),
          loadFavorites(),
        ]);
      } else {
        setIsRecommendationsLoading(false);
      }

      if (!cancelled) {
        timerId = setInterval(() => {
          refreshRecommendationsWithAuth();
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

  useEffect(() => {
    if (!modal.isOpen && !confirmRemove.isOpen) return;
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
  }, [modal.isOpen, confirmRemove.isOpen]);

  function handleRemoveClick(sportName) {
    setConfirmRemove({ isOpen: true, sportName });
  }

  function cancelConfirmRemove() {
    setConfirmRemoveClosing(true);
    setTimeout(() => {
      setConfirmRemoveClosing(false);
      setConfirmRemove({ isOpen: false, sportName: '' });
    }, 200);
  }

  async function confirmRemoveSport() {
    const { sportName } = confirmRemove;
    cancelConfirmRemove();
    await removeFavoriteSport(sportName);
  }

  function openBetModal(item, betIndex) {
    setBetModal({ isOpen: true, item, betIndex });
  }

  function closeBetModal() {
    setBetModal((prev) => ({ ...prev, isOpen: false }));
  }

  function openSportsModal() {
    setModal({
      isOpen: true,
      mode: 'sports',
      query: '',
      pendingSports: [],
      selectedSportName: '',
      pendingLeagues: [],
    });
  }

  function openLeagueModal(sportName) {
    const current = favorites.sports.find((item) => item.name === sportName);

    setModal({
      isOpen: true,
      mode: 'leagues',
      query: '',
      pendingSports: [],
      selectedSportName: sportName,
      pendingLeagues: current?.allLeagues ? [] : [...(current?.leagues || [])],
    });
  }

  function closeFavoritesModal() {
    setFavoritesModalClosing(true);
    setTimeout(() => {
      setFavoritesModalClosing(false);
      setModal((prev) => ({ ...prev, isOpen: false }));
    }, 200);
  }

  function togglePendingSport(value, checked) {
    const next = new Set(modal.pendingSports || []);
    if (checked) next.add(value);
    else next.delete(value);

    setModal((prev) => ({
      ...prev,
      pendingSports: [...next],
    }));
  }

  function togglePendingLeague(value, checked) {
    const next = new Set(modal.pendingLeagues || []);
    if (checked) next.add(value);
    else next.delete(value);

    setModal((prev) => ({
      ...prev,
      pendingLeagues: [...next],
    }));
  }

  async function applyFavorites() {
    if (modal.mode === 'sports') {
      const selectedSports = uniqTrimmed(modal.pendingSports);
      const existingByName = new Map(favorites.sports.map((item) => [item.name, item]));
      const nextSports = [
        ...favorites.sports,
        ...selectedSports
          .filter((name) => !existingByName.has(name))
          .map((name) => ({
            name,
            sportUrl: catalog.sportUrlMap?.[name] || '',
            leagues: [],
            allLeagues: true,
            availableLeagues: catalog.leaguesBySport?.[name] || [],
            summary: 'Все лиги',
          })),
      ];

      closeFavoritesModal();
      try {
        await persistFavorites({ sports: nextSports });
      } catch {
        await loadFavorites();
      }
      return;
    }

    const nextSports = favorites.sports.map((item) => {
      if (item.name !== modal.selectedSportName) {
        return item;
      }

      const leagues = uniqTrimmed(modal.pendingLeagues);
      return {
        ...item,
        leagues,
        allLeagues: leagues.length === 0,
        summary: leagues.length === 0 ? 'Все лиги' : leagues.join(', '),
      };
    });

    closeFavoritesModal();
    try {
      await persistFavorites({ sports: nextSports });
    } catch {
      await loadFavorites();
    }
  }

  async function removeFavoriteSport(sportName) {
    const next = {
      sports: favorites.sports.filter((item) => item.name !== sportName),
    };

    try {
      await persistFavorites(next);
    } catch {
      await loadFavorites();
    }
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
          <p>Вы не авторизованы в WebApp. Откройте приложение через кнопку в Telegram-боте.</p>
          <button className="primary-button" type="button" onClick={refreshRecommendationsWithAuth}>Повторить авторизацию</button>
        </section>
      </main>
    );
  }

  return (
    <>
      <header className="header header-blue" id="top-header">
        <div className="header-top">
          <span className="eyebrow">TELEGRAM WEBAPP</span>
          <span className="status"><span className="status-dot"></span>{refreshStatus || '—'}</span>
        </div>
        <div className="brand-row">
          <div className="brand">
            <div className="logo-t">T</div>
            <div>
              <h1>Tiger Bet</h1>
              <p className="header-subtitle">Живые рекомендации и избранные фильтры...</p>
            </div>
          </div>
        </div>

        <div className="stats-grid" aria-label="Краткая сводка" style={{ marginBottom: '16px' }}>
          <div className="stat-card"><strong>{stats.recommendations}</strong><span>карточек</span></div>
          <div className="stat-card"><strong>{stats.sports}</strong><span>вида спорта</span></div>
        </div>

        <button className="refresh-btn" type="button" onClick={refreshRecommendationsWithAuth} style={{ display: 'block', margin: '0 auto', padding: '8px 40px', fontSize: '1.05rem' }}>Обновить сейчас</button>
      </header>

      <main className="layout">
        <section id="recommendations">
          <div className="section-head section-head-stack">
            <div>
              <h2>Рекомендованные матчи</h2>
              <p className="section-description">Топ-матчи с тремя ставками, коэффициентами и кратким обоснованием.</p>
            </div>
          </div>
          <div className="block-error" aria-live="polite">
            {recommendationsError ? (
              <>
                <span>{recommendationsError} </span>
                <button className="secondary-button" type="button" onClick={refreshRecommendationsWithAuth}>Повторить</button>
              </>
            ) : null}
          </div>

          <div id="recommendations-list">
            {isRecommendationsLoading ? <div>Загрузка...</div> : null}
            {!isRecommendationsLoading && recommendations.length === 0 ? <div className="recommendations-empty">Нет подходящих событий для рекомендаций</div> : null}
            {!isRecommendationsLoading && recommendations.map((item) => (
              <RecommendationCard item={item} key={item.id || item.match} onOpenBet={openBetModal} />
            ))}
          </div>
        </section>

        <section id="favorites-sports">
          <div className="section-head">
            <div>
              <h2>Избранные виды спорта</h2>
              <p className="section-description">Для каждого выбранного спорта можно отдельно оставить все лиги или сузить выбор до нужных турниров.</p>
            </div>
            <div className="favorites-sports-actions">
              <span className="favorites-sports-count">{favorites.sports.length} из 8</span>
            </div>
          </div>
          <div id="sports-chips" className="chips-row">
            {favorites.sports.length === 0 ? (
              <span className="recommendations-empty">Пока пусто</span>
            ) : favorites.sports.map((item) => (
              <SportSettingCard item={item} key={item.name} onConfigure={openLeagueModal} onRemove={handleRemoveClick} />
            ))}
          </div>
          <button className="favorites-add-card" id="add-sports-btn" type="button" onClick={openSportsModal}>
            <span className="favorites-add-icon"><span className="favorites-add-plus">+</span></span>
            <span>Добавить вид спорта</span>
          </button>
        </section>
      </main>

      {betModal.isOpen && betModal.item ? (
        <BetModal item={betModal.item} betIndex={betModal.betIndex} onClose={closeBetModal} />
      ) : null}

      {(confirmRemove.isOpen || confirmRemoveClosing) ? (
        <div className={`modal modal-centered${confirmRemoveClosing ? ' modal--closing' : ''}`} aria-hidden="false" onClick={cancelConfirmRemove}>
          <div
            className="modal-card confirm-remove-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-remove-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id="confirm-remove-title">Удалить спорт из избранного</h3>
              <button type="button" className="modal-close-btn" aria-label="Закрыть" onClick={cancelConfirmRemove}>×</button>
            </div>
            <p className="confirm-remove-text">Спорт «{confirmRemove.sportName}» будет удалён из списка избранных.</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={cancelConfirmRemove}>Отмена</button>
              <button className="danger-button" type="button" onClick={confirmRemoveSport}>Удалить</button>
            </div>
          </div>
        </div>
      ) : null}

      {(modal.isOpen || favoritesModalClosing) ? (
        <div id="favorites-modal" className={`modal${favoritesModalClosing ? ' modal--closing' : ''}`} aria-hidden="false">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="favorites-modal-title">
            <div className="modal-head">
              <h3 id="favorites-modal-title">
                {modal.mode === 'sports' ? 'Добавить виды спорта' : `Лиги: ${modal.selectedSportName}`}
              </h3>
              <button id="favorites-close-btn" type="button" aria-label="Закрыть" onClick={closeFavoritesModal}>×</button>
            </div>

            <input
              id="favorites-search"
              type="search"
              placeholder={modal.mode === 'sports' ? 'Поиск по видам спорта' : 'Поиск по лигам'}
              value={modal.query}
              onChange={(event) => setModal((prev) => ({ ...prev, query: event.target.value || '' }))}
            />

            {modal.mode === 'sports' ? (
              <div id="favorites-options" className="favorites-options">
                {availableSportsToAdd.length === 0 ? (
                  <div className="recommendations-empty">Ничего не найдено</div>
                ) : availableSportsToAdd.map((value) => {
                  const isChecked = (modal.pendingSports || []).includes(value);
                  const optionSportUrl = catalog.sportUrlMap?.[value];

                  return (
                    <label className="favorite-option" key={`sport-${value}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) => togglePendingSport(value, event.target.checked)}
                      />
                      <SportIcon className="sport-option-icon" sportUrl={optionSportUrl} alt="" />
                      {value}
                    </label>
                  );
                })}
              </div>
            ) : (
              <>
                <label className="favorite-option" key="all-leagues-option">
                  <input
                    type="checkbox"
                    checked={modal.pendingLeagues.length === 0}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setModal((prev) => ({ ...prev, pendingLeagues: [] }));
                      }
                    }}
                  />
                  Все лиги
                </label>
                <div id="favorites-options" className="favorites-options">
                  {availableLeaguesForSelectedSport.length === 0 ? (
                    <div className="recommendations-empty">Для этого спорта пока нет каталога лиг</div>
                  ) : availableLeaguesForSelectedSport.map((value) => {
                    const isChecked = (modal.pendingLeagues || []).includes(value);

                    return (
                      <label className="favorite-option" key={`league-${value}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) => togglePendingLeague(value, event.target.checked)}
                        />
                        {value}
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="modal-actions">
              <button className="primary-button" id="favorites-apply-btn" type="button" onClick={applyFavorites}>Применить</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
