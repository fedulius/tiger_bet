import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MOCK_LEAGUES = [
  {
    abbr: 'ЧМ',
    name: 'Чемпионат мира FIFA 2026',
    matches: [
      { id: 'fra-swe', t1: { name: 'Франция', code: 'FRA', score: 2 }, t2: { name: 'Швеция', code: 'SWE', score: 1 }, time: "67'", stage: 'В игре', live: true },
      { id: 'mex-ecu', t1: { name: 'Мексика', code: 'MEX' }, t2: { name: 'Эквадор', code: 'ECU' }, time: '02:00', stage: '1/8 финала' },
      { id: 'eng-cod', t1: { name: 'Англия', code: 'ENG' }, t2: { name: 'ДР Конго', code: 'COD' }, time: '05:00', stage: '1/8 финала' },
    ],
  },
  {
    abbr: 'АПЛ',
    name: 'Премьер-лига',
    matches: [
      { id: 'ars-che', t1: { name: 'Арсенал', code: 'ARS' }, t2: { name: 'Челси', code: 'CHE' }, time: '21:00', stage: 'Тур 1' },
      { id: 'liv-new', t1: { name: 'Ливерпуль', code: 'LIV' }, t2: { name: 'Ньюкасл', code: 'NEW' }, time: '21:00', stage: 'Тур 1' },
    ],
  },
  {
    abbr: 'ЛЧ',
    name: 'Лига чемпионов',
    matches: [
      { id: 'rma-bay', t1: { name: 'Реал Мадрид', code: 'RMA' }, t2: { name: 'Бавария', code: 'BAY' }, time: '3 июл', stage: 'Финал' },
    ],
  },
];

const DATES = ['Вчера', 'Сегодня', 'Завтра', '2 июля', '3 июля'];

function MatchCard({ match, onClick }) {
  const scoreStyle = (val) => ({ fontSize: '16px', fontWeight: 800, color: val != null ? 'var(--text)' : 'transparent', minWidth: '14px', textAlign: 'right' });

  return (
    <div className="match-card" onClick={onClick}>
      <div className="match-teams">
        <div className="match-team">
          <div className="team-flag">{match.t1.code}</div>
          <span className="team-name">{match.t1.name}</span>
          <span className="team-score" style={scoreStyle(match.t1.score)}>{match.t1.score ?? ''}</span>
        </div>
        <div className="match-team">
          <div className="team-flag">{match.t2.code}</div>
          <span className="team-name">{match.t2.name}</span>
          <span className="team-score" style={scoreStyle(match.t2.score)}>{match.t2.score ?? ''}</span>
        </div>
      </div>
      <div className="match-info">
        {match.live ? (
          <div className="match-time live">
            <span className="live-dot" />
            {match.time}
          </div>
        ) : (
          <div className="match-time">{match.time}</div>
        )}
        <div className="match-stage">{match.stage}</div>
      </div>
    </div>
  );
}

export function HomePage() {
  const [dateIdx, setDateIdx] = useState(1);
  const navigate = useNavigate();

  const openMatch = (matchId) => {
    navigate(`/match/${matchId}`);
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <span>Tiger</span>
          <span className="accent">Bet</span>
        </div>
        <button className="page-header-btn">⚙</button>
      </div>

      <div className="date-pills">
        {DATES.map((label, i) => (
          <button
            key={label}
            className={`date-pill${i === dateIdx ? ' active' : ''}`}
            onClick={() => setDateIdx(i)}
          >
            {label}
          </button>
        ))}
      </div>

      {MOCK_LEAGUES.map((league) => (
        <div className="league-group" key={league.abbr}>
          <div className="league-header">
            <div className="league-logo">{league.abbr}</div>
            <span className="league-name">{league.name}</span>
            <span className="league-chevron">›</span>
          </div>
          <div className="match-list">
            {league.matches.map((match) => (
              <MatchCard key={match.id} match={match} onClick={() => openMatch(match.id)} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
