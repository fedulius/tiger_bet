import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { auth, getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { resolveMatchId } from '../lib/match.js';

const STAT_ROWS = [
  { key: 'possession', label: 'Владение мячом', suffix: '%', isBar: true },
  { key: 'shots', label: 'Удары' },
  { key: 'shotsOnTarget', label: 'Удары в створ' },
  { key: 'corners', label: 'Угловые' },
  { key: 'fouls', label: 'Фолы' },
  { key: 'offsides', label: 'Офсайды' },
  { key: 'xg', label: 'xG', decimals: 2 },
  { key: 'passes', label: 'Передачи' },
  { key: 'yellowCards', label: 'Жёлтые карточки' },
  { key: 'redCards', label: 'Красные карточки' },
  { key: 'goalkeeperSaves', label: 'Сейвы вратарей' },
  { key: 'bigChances', label: 'Опасные моменты' },
];

function StatRow({ label, home, away, isBar, decimals }) {
  const hVal = home != null ? (decimals ? Number(home).toFixed(decimals) : home) : '—';
  const aVal = away != null ? (decimals ? Number(away).toFixed(decimals) : away) : '—';
  const total = (Number(home) || 0) + (Number(away) || 0);
  const homePct = total > 0 ? (Number(home) || 0) / total * 100 : 50;

  return (
    <div style={{ padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '15px', minWidth: '40px' }}>{hVal}</span>
        <span style={{ color: 'var(--text-3)', fontSize: '12px', textAlign: 'center', flex: 1 }}>{label}</span>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '15px', minWidth: '40px', textAlign: 'right' }}>{aVal}</span>
      </div>
      {isBar && (
        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-2, #2a2a2e)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${homePct}%`, background: 'var(--accent, #4a9eff)', borderRadius: '3px 0 0 3px', transition: 'width 0.3s' }} />
          <div style={{ width: `${100 - homePct}%`, background: 'var(--text-3, #666)', borderRadius: '0 3px 3px 0', opacity: 0.3 }} />
        </div>
      )}
    </div>
  );
}

function EventRow({ event, homeTeamId, homeTeamName, awayTeamName }) {
  const isHome = event.teamId === homeTeamId;
  // SStats: type=1 Goal/Penalty/Missed Penalty, type=2 Yellow/Red (check name), type=3 Substitution
  let typeEmoji = '•';
  if (event.type === 1) {
    if (event.name === 'Penalty') typeEmoji = '⚽';
    else if (event.name === 'Missed Penalty') typeEmoji = '❌';
    else typeEmoji = '⚽';
  } else if (event.type === 2) typeEmoji = event.name?.includes('Red') ? '🟥' : '🟨';
  else if (event.type === 3) typeEmoji = '🔄';
  const minute = event.minute != null ? `${event.minute}'` : '';
  const teamName = isHome ? homeTeamName : awayTeamName;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0',
      fontSize: '13px', color: 'var(--text)', borderBottom: '1px solid var(--sep)',
    }}>
      <span style={{ minWidth: '36px', textAlign: 'right', color: 'var(--text-3)', fontSize: '12px', fontWeight: 600 }}>
        {minute}
      </span>
      <span style={{ fontSize: '16px', minWidth: '24px', textAlign: 'center' }}>{typeEmoji}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{ fontWeight: 600 }}>{event.player || event.name || ''}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{teamName}</span>
      </div>
    </div>
  );
}

export function MatchPage() {
  const { id: routeParamId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const matchId = useMemo(
    () => resolveMatchId({ routeParamId, search: location.search }),
    [routeParamId, location.search],
  );

  const [state, setState] = useState({ loading: true, error: '', item: null, unauthorized: false });

  // Auto-refresh for live matches
  useEffect(() => {
    if (!state.item || !state.item.isLive || state.item.isFinished) return;

    const interval = setInterval(async () => {
      try {
        const updated = await getMatchDetails(matchId);
        setState((prev) => ({ ...prev, item: updated }));
      } catch {
        // silent — next tick will retry
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [matchId, state.item?.isLive, state.item?.isFinished]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!matchId) {
        setState({ loading: false, error: 'Не указан id матча', item: null, unauthorized: false });
        return;
      }

      setState({ loading: true, error: '', item: null, unauthorized: false });

      try {
        await auth();
        const item = await getMatchDetails(matchId);
        if (!cancelled) {
          setState({ loading: false, error: '', item, unauthorized: false });
        }
      } catch (error) {
        if (!cancelled) {
          if (String(error?.message || '') === 'HTTP 401') {
            setState({ loading: false, error: '', item: null, unauthorized: true });
          } else {
            setState({ loading: false, error: 'Матч не найден', item: null, unauthorized: false });
          }
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [matchId]);

  const item = state.item;

  const matchName = item?.match || 'Матч — Матч';
  const parts = matchName.split(' — ');
  const team1Name = parts[0] || 'Команда 1';
  const team2Name = parts[1] || 'Команда 2';

  const team1Code = item?.team1_code || team1Name.substring(0, 3).toUpperCase();
  const team2Code = item?.team2_code || team2Name.substring(0, 3).toUpperCase();

  const stats = item?.stats || {};
  const events = item?.events || [];

  if (state.unauthorized) {
    return (
      <div className="page active">
        <div className="detail-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <span className="detail-title">Доступ ограничен</span>
        </div>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-2)' }}>
          Откройте приложение через кнопку в Telegram-боте.
        </div>
      </div>
    );
  }

  return (
    <div className="page active">
      {/* Header */}
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <span className="detail-title">{item?.league || 'Матч'}</span>
      </div>

      {state.loading && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: 'calc(100vh - 120px)',
        }}>
          <div style={{ fontSize: '40px', animation: 'ball-bounce 0.6s ease-in-out infinite alternate' }}>⚽</div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginTop: '16px' }}>Загрузка</div>
          <style>{`@keyframes ball-bounce { 0% { transform: translateY(0); } 100% { transform: translateY(-16px); } }`}</style>
        </div>
      )}

      {state.error && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>{state.error}</div>
      )}

      {!state.loading && !state.error && item && (
        <>
          {/* Hero */}
          <div className="detail-hero">
            <div className="detail-team">
              <div className="detail-flag">
                {team1Code !== 'WW' ? (
                  <img src={`/country-flags/${team1Code}.svg`} alt={team1Code}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <span style={{ display: team1Code !== 'WW' ? 'none' : 'flex', fontSize: '16px' }}>⚽</span>
              </div>
              <div className="detail-team-name">{team1Name}</div>
            </div>
            <div className="detail-score">
              {item.isLive && <span className="live-dot" style={{ marginRight: '6px' }} />}
              {item.score || '—'}
              {item.penaltyResult && (
                <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px', textAlign: 'center' }}>
                  по пенальти: {item.penaltyResult.home} : {item.penaltyResult.away}
                </div>
              )}
            </div>
            <div className="detail-team">
              <div className="detail-flag">
                {team2Code !== 'WW' ? (
                  <img src={`/country-flags/${team2Code}.svg`} alt={team2Code}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <span style={{ display: team2Code !== 'WW' ? 'none' : 'flex', fontSize: '16px' }}>⚽</span>
              </div>
              <div className="detail-team-name">{team2Name}</div>
            </div>
          </div>

          <div className="detail-meta">
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
              {item.league || ''}
            </div>
            {item.round && (
              <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }}>
                {item.round}
              </div>
            )}
            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
              {formatMoscowDateTime(item.starts_at || '') || '—'}
              {item.halftime && <span style={{ marginLeft: '8px' }}>Тайм: {item.halftime}</span>}
            </div>
          </div>

          {/* Statistics */}
          {Object.keys(stats).length > 0 && (
            <>
              <div className="section-header">Статистика</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '12px 16px' }}>
                {STAT_ROWS.filter((r) => stats[r.key] && (stats[r.key].home != null || stats[r.key].away != null)).map((row) => (
                  <StatRow
                    key={row.key}
                    label={row.label}
                    home={stats[row.key]?.home}
                    away={stats[row.key]?.away}
                    isBar={row.isBar}
                    decimals={row.decimals}
                  />
                ))}
              </div>
            </>
          )}

          {/* Events */}
          {events.length > 0 && (
            <>
              <div className="section-header">События</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '8px 16px' }}>
                {[...events].sort((a, b) => (b.minute || 0) - (a.minute || 0)).map((e) => (
                  <EventRow key={e.id} event={e} homeTeamId={item.homeTeamId}
                    homeTeamName={team1Name} awayTeamName={team2Name} />
                ))}
              </div>
            </>
          )}

          <div style={{ height: 20 }} />
        </>
      )}
    </div>
  );
}
