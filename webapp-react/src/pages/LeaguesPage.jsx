import React, { useState } from 'react';

const MOCK_LEAGUES_FAV = [
  { id: 'wc', abbr: 'ЧМ', name: 'Чемпионат мира FIFA 2026', country: 'Международные' },
  { id: 'apl', abbr: 'АПЛ', name: 'Премьер-лига', country: 'Англия' },
  { id: 'ucl', abbr: 'ЛЧ', name: 'Лига чемпионов', country: 'Европа' },
];

const MOCK_LEAGUES_ALL = [
  { id: 'laliga', abbr: 'ЛЛ', name: 'Ла Лига', country: 'Испания' },
  { id: 'bundes', abbr: 'БЛ', name: 'Бундеслига', country: 'Германия' },
  { id: 'seriea', abbr: 'СА', name: 'Серия А', country: 'Италия' },
  { id: 'ligue1', abbr: 'Л1', name: 'Лига 1', country: 'Франция' },
  { id: 'eredivisie', abbr: 'ЭР', name: 'Эредивизи', country: 'Нидерланды' },
  { id: 'primeira', abbr: 'ПР', name: 'Примейра', country: 'Португалия' },
];

export function LeaguesPage() {
  const [favs, setFavs] = useState({ wc: true, apl: true, ucl: true });
  const [search, setSearch] = useState('');

  const toggleFav = (id) => {
    setFavs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filterLeagues = (leagues) =>
    leagues.filter((l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.country.toLowerCase().includes(search.toLowerCase())
    );

  const favLeagues = filterLeagues(MOCK_LEAGUES_FAV);
  const allLeagues = filterLeagues(MOCK_LEAGUES_ALL);

  return (
    <>
      <div className="page-header">
        <div className="page-title">Мои лиги</div>
      </div>

      <div className="search-wrap">
        <span>🔍</span>
        <input
          className="search-input"
          type="text"
          placeholder="Поиск лиги..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {favLeagues.length > 0 && (
        <>
          <div className="section-header">Избранные</div>
          {favLeagues.map((league) => (
            <div className="league-row" key={league.id}>
              <div className="league-row-logo">{league.abbr}</div>
              <div className="league-row-info">
                <div className="league-row-title">{league.name}</div>
                <div className="league-row-country">{league.country}</div>
              </div>
              <span
                className={`league-star ${favs[league.id] ? 'on' : 'off'}`}
                onClick={(e) => { e.stopPropagation(); toggleFav(league.id); }}
              >
                {favs[league.id] ? '★' : '☆'}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="section-header">Все лиги</div>
      {allLeagues.map((league) => (
        <div className="league-row" key={league.id}>
          <div className="league-row-logo">{league.abbr}</div>
          <div className="league-row-info">
            <div className="league-row-title">{league.name}</div>
            <div className="league-row-country">{league.country}</div>
          </div>
          <span
            className={`league-star ${favs[league.id] ? 'on' : 'off'}`}
            onClick={(e) => { e.stopPropagation(); toggleFav(league.id); }}
          >
            {favs[league.id] ? '★' : '☆'}
          </span>
        </div>
      ))}
    </>
  );
}
