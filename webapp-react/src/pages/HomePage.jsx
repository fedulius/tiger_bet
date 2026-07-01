import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getHomeMatches } from '../lib/api.js';
import { resolveLeague, resolveRound, resolveTeamName, resolveTeamCode, TEAM_LOCALE } from '../lib/locale.js';

const DATE_TABS = [
  { key: 'yesterday', label: 'Вчера' },
  { key: 'today', label: 'Сегодня' },
  { key: 'tomorrow', label: 'Завтра' },
];

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  } catch {
    return '';
  }
}

function formatScore(score) {
  if (score.home == null) return null;
  return `${score.home} : ${score.away}`;
}

function isFinished(status) {
  return [8, 9, 10, 17, 18].includes(status);
}

function isLive(status) {
  return [3, 4, 5, 6, 7, 11, 18, 19].includes(status);
}

function resolveTeam(team) {
  const name = team?.name || '';
  const ruName = resolveTeamName(name);
  const code = resolveTeamCode(name, team?.country?.code);
  return {
    name: ruName,
    id: team?.id,
    country: {
      code: code === 'WW' ? 'US' : code,
      name: ruName,
    },
  };
}

function TeamRow({ team, score, showScore }) {
  const resolved = resolveTeam(team);
  const code = resolved.country?.code;
  const hasFlag = code && code !== 'WW';
  return (
    <div className="match-team">
      <div className="team-flag">
        {hasFlag ? (
          <img
            src={`/country-flags/${code}.svg`}
            alt={code}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <span style={{ display: hasFlag ? 'none' : 'flex', fontSize: '14px' }}>⚽</span>
      </div>
      <span className="team-name">{resolved.name}</span>
      {showScore && score != null && (
        <span className="team-score" style={{ fontSize: '16px', fontWeight: 800, minWidth: '14px', textAlign: 'right' }}>
          {score}
        </span>
      )}
    </div>
  );
}

function MatchCard({ match, onClick }) {
  const finished = isFinished(match.status);
  const live = isLive(match.status);
  const hasScore = match.score?.home != null;

  return (
    <div className="match-card" onClick={onClick}>
      <div className="match-teams">
        <TeamRow team={match.home} score={match.score.home} showScore={hasScore} />
        <TeamRow team={match.away} score={match.score.away} showScore={hasScore} />
      </div>
      <div className="match-info">
        {live ? (
          <div className="match-time live">
            <span className="live-dot" />
            {hasScore ? formatScore(match.score) : formatTime(match.date)}
          </div>
        ) : finished ? (
          <div className="match-time" style={{ color: 'var(--text-3)', fontWeight: 600 }}>
            {hasScore ? formatScore(match.score) : '…'}
            {match.penaltyResult && (
              <div style={{ fontSize: '10px', fontWeight: 400, marginTop: '2px' }}>
                пен. {match.penaltyResult.home}:{match.penaltyResult.away}
              </div>
            )}
          </div>
        ) : (
          <div className="match-time">{formatTime(match.date)}</div>
        )}
        {match.round && <div className="match-stage">{resolveRound(match.round)}</div>}
      </div>
    </div>
  );
}

function EmptyDay({ message }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '14px' }}>
      {message}
    </div>
  );
}

export function HomePage() {
  const [activeTab, setActiveTab] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState('pending');
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await auth();
      setAuthState('ok');
      const result = await getHomeMatches();
      setData(result);
    } catch (err) {
      if (err.status === 401) {
        setAuthState('unauthorized');
      } else {
        setAuthState('ok');
        setData({ yesterday: [], today: [], tomorrow: [] });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh when there are live matches
  useEffect(() => {
    if (!data) return;

    const hasLive = ['yesterday', 'today', 'tomorrow'].some((day) =>
      (data[day] || []).some((league) =>
        league.matches.some((m) => isLive(m.status)),
      ),
    );

    if (!hasLive) return;

    const interval = setInterval(() => {
      loadData();
    }, 60000);

    return () => clearInterval(interval);
  }, [data, loadData]);

  if (authState === 'pending' || (loading && !data)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 120px)',
      }}>
        <div style={{
          fontSize: '40px',
          animation: 'ball-bounce 0.6s ease-in-out infinite alternate',
        }}>
          ⚽
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-3)', marginTop: '16px' }}>
          Загрузка
        </div>
        <style>{`
          @keyframes ball-bounce {
            0% { transform: translateY(0); }
            100% { transform: translateY(-16px); }
          }
        `}</style>
      </div>
    );
  }

  if (authState === 'unauthorized') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '12px' }}>
          Доступ ограничен
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '20px' }}>
          Откройте приложение через кнопку в Telegram-боте
        </div>
        <button
          onClick={loadData}
          style={{
            padding: '10px 24px',
            borderRadius: '12px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  const noLeagues = data && Array.isArray(data.leagues) && data.leagues.length === 0;
  const leagues = data?.[activeTab] || [];
  const hasAnyData = (data?.yesterday?.length || 0) + (data?.today?.length || 0) + (data?.tomorrow?.length || 0) > 0;

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <span>Tiger</span>
          <span className="accent">Bet</span>
        </div>
      </div>

      {noLeagues ? (
        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚽</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
            Для отображения матчей выберите лигу
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '24px' }}>
            Выберите интересующие вас лиги, и матчи появятся здесь
          </div>
          <button
            onClick={() => navigate('/leagues')}
            style={{
              padding: '12px 28px',
              borderRadius: '14px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              fontSize: '15px',
              cursor: 'pointer',
            }}
          >
            Выбрать лигу
          </button>
        </div>
      ) : (
        <>
          <div className="date-pills">
            {DATE_TABS.map(({ key, label }) => (
              <button
                key={key}
                className={`date-pill${key === activeTab ? ' active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {!hasAnyData && !loading ? (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>😴</div>
              <div style={{ fontSize: '15px', color: 'var(--text-3)' }}>
                В ближайшие дни матчей нет
              </div>
            </div>
          ) : leagues.length === 0 ? (
            <EmptyDay message={`Нет матчей ${activeTab === 'yesterday' ? 'вчера' : activeTab === 'tomorrow' ? 'завтра' : 'сегодня'}`} />
          ) : (
            leagues.map((league) => (
              <div className="league-group" key={league.league}>
                <div className="league-header">
                  <div className="league-logo">
                    {league.league?.slice(0, 3).toUpperCase()}
                  </div>
                  <span className="league-name">{resolveLeague(league.league)}</span>
                </div>
                <div className="match-list">
                  {league.matches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      onClick={() => navigate(`/match/${match.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </>
  );
}
