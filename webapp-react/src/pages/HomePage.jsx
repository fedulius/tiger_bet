import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, getHomeMatches, getRecommendedPick } from '../lib/api.js';
import { resolveLeague, resolveRound, resolveTeamName } from '../lib/locale.js';
import { getTeamBadge } from '../lib/teamVisuals.js';

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
  return {
    ...team,
    name: ruName,
  };
}

function TeamRow({ team, score, showScore }) {
  const resolved = resolveTeam(team);
  const badge = getTeamBadge(team);
  const badgeSrc = badge.logoUrl || (badge.flagCode ? `/country-flags/${badge.flagCode}.svg` : null);
  return (
    <div className="match-team">
      <div className="team-flag">
        {badgeSrc ? (
          <img
            src={badgeSrc}
            alt={resolved.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <span style={{ display: badgeSrc ? 'none' : 'flex', fontSize: '14px' }}>⚽</span>
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

function formatLiveValue(match) {
  if (match?.elapsed != null && Number.isFinite(Number(match.elapsed))) {
    return `${Number(match.elapsed)}'`;
  }

  const statusName = String(match?.statusName || '').toLowerCase();
  if (statusName.includes('half time')) return 'HT';
  if (statusName.includes('break time')) return 'Пер.';
  if (statusName.includes('extra time')) return 'ДВ';
  if (statusName.includes('penalties')) return 'Пен.';

  return formatScore(match.score) || formatTime(match.date);
}

function MatchCard({ match, onClick }) {
  const finished = isFinished(match.status);
  const live = isLive(match.status);
  const hasScore = match.score?.home != null;

  return (
    <div className={`match-card${match.isFollowed ? ' is-followed' : ''}`} onClick={onClick}>
      {match.isFollowed && (
        <div className="match-follow-badge" aria-label="Матч отслеживается" title="Матч отслеживается">
          ✓
        </div>
      )}
      <div className="match-teams">
        <TeamRow team={match.home} score={match.score.home} showScore={hasScore} />
        <TeamRow team={match.away} score={match.score.away} showScore={hasScore} />
      </div>
      <div className="match-info">
        {live ? (
          <div className="match-time live">
            <span className="live-dot" />
            <span className="live-value">{formatLiveValue(match)}</span>
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

function RecommendedPickCard({ payload, onOpenMatch }) {
  const item = payload?.item;
  if (!item) {
    const empty = payload?.empty_state;
    if (!empty) return null;
    return (
      <section className="recommended-pick-card recommended-pick-card--empty">
        <div className="recommended-pick-kicker">🎯 Ставка дня</div>
        <div className="recommended-pick-match">{empty.title}</div>
        <div className="recommended-pick-reason">{empty.description}</div>
      </section>
    );
  }
  const riskText = item.bet?.risk_level === 'low'
    ? 'Низкий риск'
    : item.bet?.risk_level === 'medium'
      ? 'Средний риск'
      : item.bet?.risk_label || '';
  const warning = Array.isArray(item.warnings) && item.warnings.length ? item.warnings[0] : '';
  return (
    <section
      className={`recommended-pick-card${item.match_id ? ' recommended-pick-card--clickable' : ''}`}
      role={item.match_id ? 'button' : undefined}
      tabIndex={item.match_id ? 0 : undefined}
      onClick={item.match_id ? () => onOpenMatch(item.match_id) : undefined}
      onKeyDown={item.match_id ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenMatch(item.match_id);
        }
      } : undefined}
    >
      <div className="recommended-pick-kicker">🎯 Ставка дня</div>
      <div className="recommended-pick-match">{item.match}</div>
      <div className="recommended-pick-meta">
        {item.league}{item.starts_at ? ` · ${formatTime(item.starts_at)}` : ''}
      </div>
      <div className="recommended-pick-bet">
        <span>{item.bet?.label || item.headline}</span>
        {item.bet?.odds_decimal ? <strong>Кэф {item.bet.odds_decimal}</strong> : null}
      </div>
      {riskText ? <div className="recommended-pick-risk">{riskText}</div> : null}
      {warning ? <div className="recommended-pick-warning">{warning}</div> : null}
      {item.bet?.reason ? <div className="recommended-pick-reason">{item.bet.reason}</div> : null}
    </section>
  );
}

let currentHomeTab = 'today';

function rememberHomeTab(dayKey) {
  if (DATE_TABS.some((tab) => tab.key === dayKey)) {
    currentHomeTab = dayKey;
  }
}

export function HomePage() {
  const [activeTab, setActiveTab] = useState(() => currentHomeTab);
  const [data, setData] = useState(null);
  const [recommendedPick, setRecommendedPick] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState('pending');
  const [loadError, setLoadError] = useState('');
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      await auth();
      setAuthState('ok');
      const [matchesResult, pickResult] = await Promise.all([
        getHomeMatches(),
        getRecommendedPick().catch(() => null),
      ]);
      setData(matchesResult);
      setRecommendedPick(pickResult);
    } catch (err) {
      if (err.status === 401) {
        setAuthState('unauthorized');
      } else if (err.status === 403) {
        setAuthState('denied');
      } else {
        setAuthState('ok');
        setLoadError('Не удалось загрузить матчи. Проверьте соединение и попробуйте ещё раз.');
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
    }, 30000);

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

    if (authState === 'denied') {
      return (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '12px' }}>
            Доступ к приложению пока не открыт
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '20px' }}>
            Ваш Telegram-аккаунт не добавлен в список доступа
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

      <RecommendedPickCard
        payload={recommendedPick}
        onOpenMatch={(matchId) => navigate(`/match/${matchId}`, { state: { fromTab: activeTab } })}
      />

      {loadError && !data ? (
        <div style={{ padding: '56px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '14px' }}>⚠️</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>
            Матчи не загрузились
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '22px', lineHeight: 1.45 }}>
            {loadError}
          </div>
          <button
            onClick={loadData}
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
            Повторить
          </button>
        </div>
      ) : noLeagues ? (
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
                onClick={() => { rememberHomeTab(key); setActiveTab(key); }}
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
                      onClick={() => navigate(`/match/${match.id}`, { state: { fromTab: activeTab } })}
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
