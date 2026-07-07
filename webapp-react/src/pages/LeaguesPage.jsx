import React, { useState, useEffect, useRef } from 'react';
import {
  fetchJSON,
  auth,
  getLeagueSearchSuggestions,
  searchLeagues,
} from '../lib/api.js';

export function LeaguesPage() {
  const [level, setLevel] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sports, setSports] = useState([]);
  const [countries, setCountries] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [suggestions, setSuggestions] = useState({ leagues: [], countries: [], sports: [] });
  const [searchResults, setSearchResults] = useState([]);
  const [favs, setFavs] = useState({});
  const [favList, setFavList] = useState([]);
  const [selectedSport, setSelectedSport] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchError, setSearchError] = useState('');
  const toastTimer = useRef(null);
  const [animDir, setAnimDir] = useState('none'); // 'forward' | 'backward' | 'none'
  const [levelKey, setLevelKey] = useState(0);
  const favsDirty = useRef(false); // true after optimistic remove, skip server refresh
  const latestSuggestRef = useRef(0);
  const latestSearchRef = useRef(0);
  const touchStartYRef = useRef(null);
  const swipeDismissedKeyboardRef = useRef(false);

  useEffect(() => {
    (async () => {
      try { await auth(); } catch {}
      loadSports();
      loadFavs();
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSuggestions({ leagues: [], countries: [], sports: [] });
      setSearchResults([]);
      setSuggestLoading(false);
      setSearchLoading(false);
      setSearchError('');
      return;
    }

    const requestId = ++latestSuggestRef.current;
    setSuggestLoading(true);
    setSearchError('');
    getLeagueSearchSuggestions(debouncedQuery)
      .then((payload) => {
        if (requestId !== latestSuggestRef.current) return;
        setSuggestions({
          leagues: payload?.leagues || [],
          countries: payload?.countries || [],
          sports: payload?.sports || [],
        });
      })
      .catch(() => {
        if (requestId !== latestSuggestRef.current) return;
        setSuggestions({ leagues: [], countries: [], sports: [] });
        setSearchError('Не удалось выполнить поиск');
      })
      .finally(() => {
        if (requestId === latestSuggestRef.current) setSuggestLoading(false);
      });
  }, [debouncedQuery]);

  useEffect(() => {
    const handleTouchStart = (event) => {
      touchStartYRef.current = event.touches?.[0]?.clientY ?? null;
      swipeDismissedKeyboardRef.current = false;
    };

    const handleTouchMove = (event) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches?.[0]?.clientY ?? null;
      if (startY == null || currentY == null || swipeDismissedKeyboardRef.current) return;

      const deltaY = currentY - startY;
      if (deltaY < 28) return;

      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        active.blur();
        swipeDismissedKeyboardRef.current = true;
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      swipeDismissedKeyboardRef.current = false;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSearchLoading(false);
      setSearchResults([]);
      return;
    }

    const requestId = ++latestSearchRef.current;
    setSearchLoading(true);
    setSearchError('');
    searchLeagues(debouncedQuery)
      .then((payload) => {
        if (requestId !== latestSearchRef.current) return;
        setSearchResults(payload?.leagues || []);
      })
      .catch(() => {
        if (requestId !== latestSearchRef.current) return;
        setSearchResults([]);
        setSearchError('Не удалось выполнить поиск');
      })
      .finally(() => {
        if (requestId === latestSearchRef.current) setSearchLoading(false);
      });
  }, [debouncedQuery]);

  const loadSports = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON('/leagues/sports');
      setSports(data.sports || []);
    } catch { setSports([]); }
    setLoading(false);
  };

  const loadCountries = async (sportId) => {
    setLoading(true);
    try {
      const data = await fetchJSON(`/leagues/sports/${sportId}/countries`);
      setCountries(data.countries || []);
    } catch { setCountries([]); }
    setLoading(false);
  };

  const loadLeagues = async (sportId, countryId) => {
    setLoading(true);
    try {
      const data = await fetchJSON(`/leagues/sports/${sportId}/countries/${countryId}/leagues`);
      setLeagues(data.leagues || []);
    } catch { setLeagues([]); }
    setLoading(false);
  };

  const loadFavs = async () => {
    if (favsDirty.current) return; // skip server refresh after optimistic remove
    try {
      const data = await fetchJSON('/leagues/favorites');
      const list = data.favorites || [];
      const map = {};
      list.forEach(f => { map[f.tournament_id] = true; });
      setFavs(map);
      setFavList(list);
    } catch {
      setFavs({});
      setFavList([]);
    }
  };

  const showToast = (msg, onUndo) => {
    setToast({ msg, onUndo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const toggleFav = async (tournamentId) => {
    const isFav = favs[tournamentId];
    // Toggle star visual immediately (soft remove)
    setFavs(prev => ({ ...prev, [tournamentId]: !isFav }));
    try {
      if (isFav) {
        await fetchJSON(`/leagues/favorites/${tournamentId}`, { method: 'DELETE' });
      } else {
        await fetchJSON('/leagues/favorites', {
          method: 'POST',
          body: JSON.stringify({ tournament_id: tournamentId }),
        });
        loadFavs();
      }
    } catch {
      // Revert on error
      setFavs(prev => ({ ...prev, [tournamentId]: isFav }));
    }
  };

  const openSport = (sport) => {
    setSelectedSport(sport);
    setAnimDir('forward');
    setLevelKey(k => k + 1);
    setLevel(2);
    loadCountries(sport.sport_id);
  };

  const openCountry = (country, sportOverride = null) => {
    const sport = sportOverride || selectedSport;
    if (!sport?.sport_id) return;
    setSelectedSport(sport);
    setSelectedCountry(country);
    setAnimDir('forward');
    setLevelKey(k => k + 1);
    setLevel(3);
    loadLeagues(sport.sport_id, country.country_id);
  };

  const goBack = () => {
    setAnimDir('backward');
    setLevelKey(k => k + 1);
    if (level === 3) {
      setLevel(2);
      setLeagues([]);
      setSelectedCountry(null);
    } else if (level === 2) {
      setLevel(1);
      setCountries([]);
      setSelectedSport(null);
      loadFavs();
    }
  };

  const filterList = (list, keys) =>
    list.filter(item =>
      keys.some(k => String(item[k] || '').toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSuggestions({ leagues: [], countries: [], sports: [] });
    setSearchResults([]);
    setSearchError('');
  };

  const renderSkeletonRows = (count = 6, showTrailing = false) => (
    <div className="card-group skeleton-group" aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="league-row skeleton-row" key={idx}>
          <div className="league-logo-lg skeleton-logo" />
          <div className="league-row-info">
            <div className="skeleton-line skeleton-line-title" />
            <div className="skeleton-line skeleton-line-meta" />
          </div>
          {showTrailing ? <div className="skeleton-trailing" /> : null}
        </div>
      ))}
    </div>
  );

  const renderSearchBar = () => (
    <div className="card-group" style={{ marginBottom: 12 }}>
      <div className="league-row" style={{ gap: 10 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              clearSearch();
            }
          }}
          placeholder="Найти лигу, страну или спорт..."
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-1)',
            fontSize: 16,
          }}
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={clearSearch}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', fontSize: 14 }}
          >
            Сброс
          </button>
        ) : null}
      </div>
    </div>
  );

  const renderSearchEmpty = (text) => (
    <div className="card-group">
      <div className="league-row">
        <div className="league-row-info">
          <div className="league-row-title">{text}</div>
        </div>
      </div>
    </div>
  );

  const renderSuggestionSection = (title, items, renderRow) => {
    if (!items.length) return null;
    return (
      <React.Fragment key={title}>
        <div className="section-header">{title}</div>
        <div className="card-group">
          {items.map(renderRow)}
        </div>
      </React.Fragment>
    );
  };

  const renderSuggestions = () => {
    if (debouncedQuery.length < 2) return null;
    if (suggestLoading) return renderSkeletonRows(4, true);
    if (searchError) return renderSearchEmpty(searchError);

    const hasAny = searchResults.length || suggestions.countries.length || suggestions.sports.length;
    if (!hasAny && !searchLoading) return renderSearchEmpty('Ничего не найдено');

    return (
      <>
        {renderSuggestionSection('Страны', suggestions.countries, (c) => (
          <div
            className="league-row league-row-tappable"
            key={`country-${c.country_id}-${c.sport_id}`}
            onClick={() => openCountry(
              { country_id: c.country_id, country_name: c.country_name, country_code: c.country_code },
              { sport_id: c.sport_id, sport_name: c.sport_name }
            )}
          >
            <div className="league-logo-lg">
              {c.country_code
                ? <img src={`/country-flags/${c.country_code}.svg`} alt={c.country_code} style={{ width: 28, height: 20, objectFit: 'contain' }} />
                : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>?</span>}
            </div>
            <div className="league-row-info">
              <div className="league-row-title">{c.country_name}</div>
              <div className="league-row-country">{c.sport_name}</div>
            </div>
            <span className="chevron">›</span>
          </div>
        ))}

        {renderSuggestionSection('Виды спорта', suggestions.sports, (sp) => (
          <div className="league-row league-row-tappable" key={`sport-${sp.sport_id}`} onClick={() => openSport(sp)}>
            <div className="league-logo-lg">
              <img src={`/sport-icons/${sp.sport_url}.svg`} alt={sp.sport_name} style={{ width: 28, height: 28, objectFit: 'contain' }} />
            </div>
            <div className="league-row-info">
              <div className="league-row-title">{sp.sport_name}</div>
            </div>
            <span className="chevron">›</span>
          </div>
        ))}
      </>
    );
  };

  const renderLiveLeagueResults = () => {
    if (debouncedQuery.length < 2) return null;
    if (searchLoading) {
      return (
        <>
          <div className="section-header">Все найденные лиги</div>
          {renderSkeletonRows(6, true)}
        </>
      );
    }
    if (searchError) return null;
    if (searchResults.length === 0) return null;

    return (
      <>
        <div className="section-header">Все найденные лиги</div>
        <div className="card-group">
          {searchResults.map((l) => (
            <div
              className="league-row league-row-tappable"
              key={`search-league-${l.tournament_id}`}
              onClick={() => toggleFav(l.tournament_id)}
            >
              <div className="league-logo-lg">
                <img src={l.tournament_image_path} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6 }} />
              </div>
              <div className="league-row-info">
                <div className="league-row-title">{l.tournament_name}</div>
                <div className="league-row-country">{l.sport_name} · {l.country_name}</div>
              </div>
              <span
                className={`league-star ${favs[l.tournament_id] ? 'on' : 'off'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFav(l.tournament_id);
                }}
              >
                {favs[l.tournament_id] ? '★' : '☆'}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  };

  // Level 1: Sports
  if (level === 1) {
    const filteredSports = filterList(sports, ['sport_name']);
    const filteredFavs = filterList(favList, ['tournament_name', 'country_name', 'sport_name']);
    const slideStyle = animDir === 'backward' ? { '--slide-from': '-30px' } : { '--slide-from': '30px' };
    const showSearchFlow = debouncedQuery.length >= 2 || searchQuery.trim().length >= 2;

    return (
      <div key={levelKey} className="level-enter" style={slideStyle}>
        <div className="page-header">
          <div className="page-title">Виды спорта</div>
        </div>

        {renderSearchBar()}

        {showSearchFlow ? (
          <>
            {renderSuggestions()}
            {renderLiveLeagueResults()}
          </>
        ) : (
          <>
            {filteredFavs.length > 0 && (
              <>
                <div className="section-header">Избранные лиги</div>
                <div className="card-group">
                  {filteredFavs.map((l) => (
                    <div className="league-row league-row-tappable" key={l.tournament_id} onClick={() => toggleFav(l.tournament_id)}>
                      <div className="league-logo-lg">
                        <img src={l.tournament_image_path} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6 }} />
                      </div>
                      <div className="league-row-info">
                        <div className="league-row-title">{l.tournament_name}</div>
                        <div className="league-row-country">{l.sport_name} · {l.country_name}</div>
                      </div>
                      <span className={`league-star ${favs[l.tournament_id] ? 'on' : 'off'}`}>
                        {favs[l.tournament_id] ? '★' : '☆'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="section-header">Все виды спорта</div>
            {loading ? renderSkeletonRows(6, true) : (
              <div className="card-group">
                {filteredSports.map((sp) => (
                  <div className="league-row league-row-tappable" key={sp.sport_id} onClick={() => openSport(sp)}>
                    <div className="league-logo-lg">
                      <img src={`/sport-icons/${sp.sport_url}.svg`} alt={sp.sport_name} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                    </div>
                    <div className="league-row-info">
                      <div className="league-row-title">{sp.sport_name}</div>
                      <div className="league-row-country">{sp.tournament_count || ''} турниров</div>
                    </div>
                    <span className="chevron">›</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ height: 90 }} />

        {toast && (
          <div className="toast" onClick={toast.onUndo}>
            <span>{toast.msg}</span>
            <span className="toast-action">Отмена</span>
          </div>
        )}
      </div>
    );
  }

  // Level 2: Countries
  if (level === 2) {
    const filtered = filterList(countries, ['country_name', 'country_name_en']);
    const slideStyle = animDir === 'backward' ? { '--slide-from': '-30px' } : { '--slide-from': '30px' };

    return (
      <div key={levelKey} className="level-enter" style={slideStyle}>
        <div className="detail-header">
          <button type="button" className="back-btn" onClick={goBack} aria-label="Назад">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="detail-header-copy">
            <div className="detail-header-kicker">Виды спорта</div>
            <div className="detail-header-title">{selectedSport?.sport_name}</div>
          </div>
        </div>

        <div className="section-subhead">Страны и турниры</div>
        {loading ? renderSkeletonRows(7, true) : (
          <div className="card-group">
            {filtered.map((c) => (
              <div className="league-row league-row-tappable" key={c.country_id} onClick={() => openCountry(c)}>
                <div className="league-logo-lg">
                  {c.country_code
                    ? <img src={`/country-flags/${c.country_code}.svg`} alt={c.country_code} style={{ width: 28, height: 20, objectFit: 'contain' }} />
                    : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>?</span>}
                </div>
                <div className="league-row-info">
                  <div className="league-row-title">{c.country_name}</div>
                  <div className="league-row-country">{c.tournament_count || ''} турниров</div>
                </div>
                <span className="chevron">›</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 90 }} />
      </div>
    );
  }

  // Level 3: Leagues
  if (level === 3) {
    const filtered = filterList(leagues, ['tournament_name', 'tournament_name_en']);
    const slideStyle = animDir === 'backward' ? { '--slide-from': '-30px' } : { '--slide-from': '30px' };

    return (
      <div key={levelKey} className="level-enter" style={slideStyle}>
        <div className="detail-header">
          <button type="button" className="back-btn" onClick={goBack} aria-label="Назад">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="detail-header-copy">
            <div className="detail-header-kicker">{selectedSport?.sport_name}</div>
            <div className="detail-header-title">{selectedCountry?.country_name}</div>
          </div>
        </div>

        <div className="breadcrumb">Лиги и турниры</div>
        {loading ? renderSkeletonRows(7, true) : (
          <div className="card-group">
            {filtered.map((l) => (
              <div className="league-row league-row-tappable" key={l.tournament_id} onClick={() => toggleFav(l.tournament_id)}>
                <div className="league-logo-lg">
                  <img src={l.tournament_image_path} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6 }} />
                </div>
                <div className="league-row-info">
                  <div className="league-row-title">{l.tournament_name}</div>
                  <div className="league-row-country">{selectedCountry?.country_name}</div>
                </div>
                <span className={`league-star ${favs[l.tournament_id] ? 'on' : 'off'}`}>
                  {favs[l.tournament_id] ? '★' : '☆'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 90 }} />
      </div>
    );
  }

  return null;
}
