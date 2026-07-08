import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { auth, getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { resolveMatchId } from '../lib/match.js';
import { getTeamBadge } from '../lib/teamVisuals.js';

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

function EmptyState({ text }) {
  return (
    <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-3)' }}>
      {text}
    </div>
  );
}

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

function EventRow({ event, homeTeamId, homeTeamCode, awayTeamCode, score, isLast }) {
  const isHome = event.teamId === homeTeamId;
  const teamCode = isHome ? homeTeamCode : awayTeamCode;
  let icon = '⚽';
  let iconBg = 'oklch(0.72 0.09 150 / 0.18)';
  let typeLabel = 'Гол';
  let desc = '';

  if (event.type === 1) {
    if (event.name === 'Missed Penalty') { icon = '❌'; iconBg = 'oklch(0.66 0.13 25 / 0.15)'; typeLabel = 'Нереализ. пенальти'; }
    else if (event.name === 'Penalty') { typeLabel = 'Гол'; desc = 'Пенальти'; }
    else { typeLabel = 'Гол'; }
  } else if (event.type === 2) {
    if (event.name?.includes('Red')) { icon = '🟥'; iconBg = 'oklch(0.66 0.13 25 / 0.18)'; typeLabel = 'Красная карточка'; }
    else { icon = '🟨'; iconBg = 'oklch(0.78 0.12 72 / 0.18)'; typeLabel = 'Жёлтая карточка'; }
  } else if (event.type === 3) {
    icon = '🔄'; iconBg = 'oklch(0.65 0.02 250 / 0.14)'; typeLabel = 'Замена';
  } else if (event.type === 4) {
    icon = '❌'; iconBg = 'oklch(0.66 0.13 25 / 0.15)'; typeLabel = 'Пенальти отменён';
  }

  const minute = event.minute != null ? `${event.minute}'` : '';
  const playerName = event.player || '';
  const showScore = event.type === 1 && score;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', marginLeft: '-8px', borderBottom: isLast ? 'none' : '1px solid var(--sep)' }}>
      {/* Minute */}
      <div style={{ minWidth: '30px', fontSize: '13px', fontWeight: 600, color: 'var(--text-3)', textAlign: 'right' }}>{minute}</div>
      {/* Country code badge */}
      <div style={{ width: '28px', height: '20px', borderRadius: '4px', background: 'var(--sep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 800, color: 'var(--text-3)', flexShrink: 0, letterSpacing: '0.3px' }}>
        {(teamCode || '???').slice(0, 3).toUpperCase()}
      </div>
      {/* Event icon */}
      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>
        {icon}
      </div>
      {/* Event text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {typeLabel}{playerName ? ` — ${playerName}` : ''}
        </div>
      </div>
      {/* Score */}
      {showScore && (
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{score}</div>
      )}
    </div>
  );
}

function formatDetailLiveValue(item) {
  if (item?.elapsed != null && Number.isFinite(Number(item.elapsed))) {
    return `${Number(item.elapsed)}'`;
  }

  const statusName = String(item?.statusName || '').toLowerCase();
  if (statusName.includes('half time')) return 'HT';
  if (statusName.includes('break time')) return 'Пер.';
  if (statusName.includes('extra time')) return 'ДВ';
  if (statusName.includes('penalties')) return 'Пен.';

  return '';
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
  const [activeTab, setActiveTab] = useState('analytics');

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
  const team1Badge = getTeamBadge({ id: item?.homeTeamId, name: item?.team1_name_ru || team1Name, country: { code: item?.team1_code, name: '' } });
  const team2Badge = getTeamBadge({ id: item?.awayTeamId, name: item?.team2_name_ru || team2Name, country: { code: item?.team2_code, name: '' } });

  const stats = item?.stats || {};
  const events = item?.events || [];
  const visibleStatRows = STAT_ROWS.filter((row) => stats[row.key] && (stats[row.key].home != null || stats[row.key].away != null));

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
                {(team1Badge.logoUrl || team1Badge.flagCode) ? (
                  <img src={team1Badge.logoUrl || `/country-flags/${team1Badge.flagCode}.svg`} alt={team1Name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <span style={{ display: (team1Badge.logoUrl || team1Badge.flagCode) ? 'none' : 'flex', fontSize: '16px' }}>⚽</span>
              </div>
              <div className="detail-team-name">{team1Name}</div>
            </div>
            <div className="detail-score" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: '92px', textAlign: 'center' }}>
              {item.isLive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '14px', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)' }}>
                  <span className="live-dot" />
                  <span className="live-value" style={{ color: 'var(--text-3)' }}>
                    {formatDetailLiveValue(item)}
                  </span>
                </div>
              )}
              <div style={{ lineHeight: 1 }}>
                {item.score || '—'}
              </div>
              {item.penaltyResult && (
                <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px', textAlign: 'center' }}>
                  по пенальти: {item.penaltyResult.home} : {item.penaltyResult.away}
                </div>
              )}
            </div>
            <div className="detail-team">
              <div className="detail-flag">
                {(team2Badge.logoUrl || team2Badge.flagCode) ? (
                  <img src={team2Badge.logoUrl || `/country-flags/${team2Badge.flagCode}.svg`} alt={team2Name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <span style={{ display: (team2Badge.logoUrl || team2Badge.flagCode) ? 'none' : 'flex', fontSize: '16px' }}>⚽</span>
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

          {/* Tab toggle — only when match is live/finished AND has analytics */}
          {item.hasAnalytics && (item.isLive || item.isFinished) && (
            <div style={{ display: 'flex', margin: '16px 16px 0', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', overflow: 'hidden', position: 'relative' }}>
              {/* Sliding indicator */}
              <div style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: '50%',
                background: 'var(--accent, #e9b949)',
                borderRadius: 'var(--radius)',
                transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: activeTab === 'stats' ? 'translateX(100%)' : 'translateX(0)',
                zIndex: 0,
              }} />
              <button
                onClick={() => setActiveTab('analytics')}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: activeTab === 'analytics' ? '#0c0d10' : 'var(--text-2)',
                  fontWeight: 700, fontSize: '13px', transition: 'color 0.2s',
                  position: 'relative', zIndex: 1,
                }}
              >Аналитика</button>
              <button
                onClick={() => setActiveTab('stats')}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: activeTab === 'stats' ? '#0c0d10' : 'var(--text-2)',
                  fontWeight: 700, fontSize: '13px', transition: 'color 0.2s',
                  position: 'relative', zIndex: 1,
                }}
              >Статистика</button>
            </div>
          )}

          {/* Analytics tab — shown when: no toggle (upcoming), or analytics tab active */}
          {(activeTab === 'analytics' || !item.hasAnalytics || (!item.isLive && !item.isFinished)) && (
            <div className="tab-content-enter" key={`analytics-${activeTab}`}>
              {/* Form */}
              <div className="section-header">Форма команд</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '12px 16px' }}>
                {item.form ? (
                  [{ label: team1Name, isHome: true }, { label: team2Name, isHome: false }].map((team) => {
                    const tData = team.isHome ? item.form.home : item.form.away;
                    return (
                      <div key={team.label} style={{ padding: '10px 0', borderBottom: team.isHome ? '1px solid var(--sep)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{team.label}</span>
                        {tData.recent && tData.recent.length > 0 && (
                          <div style={{ display: 'flex', gap: '5px' }}>
                            {tData.recent.map((m, i) => {
                              const chipColor = m.result === 'W' ? 'oklch(0.72 0.09 150)' : m.result === 'D' ? 'oklch(0.78 0.10 72)' : 'oklch(0.66 0.13 25)';
                              const chipBg = m.result === 'W' ? 'oklch(0.72 0.09 150 / 0.16)' : m.result === 'D' ? 'oklch(0.78 0.10 72 / 0.16)' : 'oklch(0.66 0.13 25 / 0.16)';
                              const label = m.result === 'W' ? 'В' : m.result === 'D' ? 'Н' : 'П';
                              return (
                                <div key={i} style={{
                                  width: '28px', height: '28px', borderRadius: '8px',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '12px', fontWeight: 800, color: chipColor, background: chipBg,
                                }}>{label}</div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <EmptyState text="Нет данных о форме команд" />
                )}
              </div>

              {/* H2H */}
              <div className="section-header">Личные встречи</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', overflow: 'hidden' }}>
                {item.h2h && item.h2h.length > 0 ? (() => {
                  // Compute summary
                  let homeWins = 0, draws = 0, awayWins = 0;
                  for (const m of item.h2h) {
                    const h = Number(m.homeResult);
                    const a = Number(m.awayResult);
                    if (h > a) homeWins++;
                    else if (h < a) awayWins++;
                    else draws++;
                  }
                  const total = item.h2h.length;
                  return (
                    <>
                      {/* Summary bar */}
                      <div style={{ display: 'flex', textAlign: 'center', borderBottom: '1px solid var(--sep)' }}>
                        <div style={{ flex: 1, padding: '14px 8px 10px', background: 'oklch(0.72 0.09 150 / 0.12)' }}>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: 'oklch(0.72 0.09 150)' }}>{homeWins}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{team1Name}</div>
                        </div>
                        <div style={{ flex: 1, padding: '14px 8px 10px', background: 'var(--sep)' }}>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-3)' }}>{draws}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>Ничьи</div>
                        </div>
                        <div style={{ flex: 1, padding: '14px 8px 10px', background: 'oklch(0.66 0.13 25 / 0.12)' }}>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: 'oklch(0.66 0.13 25)' }}>{awayWins}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{team2Name}</div>
                        </div>
                      </div>
                      {/* Progress bar */}
                      {total > 0 && (
                        <div style={{ display: 'flex', height: '5px' }}>
                          <div style={{ flex: homeWins, background: 'oklch(0.72 0.09 150)' }} />
                          <div style={{ flex: draws, background: 'var(--text-3)' }} />
                          <div style={{ flex: awayWins, background: 'oklch(0.66 0.13 25)' }} />
                        </div>
                      )}
                      {/* Match list */}
                      {item.h2h.map((m) => (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--sep)' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-3)', minWidth: '75px' }}>{m.date?.split('T')[0] || ''}</span>
                          <span style={{ flex: 1, fontSize: '13px', color: 'var(--text)', textAlign: 'right' }}>{m.homeTeam}</span>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)', minWidth: '45px', textAlign: 'center' }}>{m.homeResult} : {m.awayResult}</span>
                          <span style={{ flex: 1, fontSize: '13px', color: 'var(--text)' }}>{m.awayTeam}</span>
                        </div>
                      ))}
                    </>
                  );
                })() : (
                  <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'oklch(0.65 0.02 250 / 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.65 0.02 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Встреч пока не было</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.4' }}>Команды ещё не играли друг с другом — истории личных встреч нет.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Injuries */}
              <div className="section-header">Травмы и дисквалификации</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', overflow: 'hidden' }}>
                {item.injuries && item.injuries.length > 0 ? (() => {
                  // Group by team
                  const teams = new Map();
                  for (const inj of item.injuries) {
                    const tid = inj.teamId;
                    if (!teams.has(tid)) teams.set(tid, []);
                    teams.get(tid).push(inj);
                  }
                  // Render order: home team first, then away
                  const teamOrder = [item.homeTeamId, item.awayTeamId].filter(Boolean);
                  const allTeamIds = [...teamOrder, ...[...teams.keys()].filter((id) => !teamOrder.includes(id))];
                  const teamNames = { [item.homeTeamId]: team1Name, [item.awayTeamId]: team2Name };
                  const teamCodes = { [item.homeTeamId]: item.team1_code, [item.awayTeamId]: item.team2_code };

                  function injuryBadge(reason) {
                    const r = (reason || '').toLowerCase();
                    if (r.includes('дисквалиф') || r.includes('suspended') || r.includes('yellow card') || r.includes('жёлт'))
                      return { label: 'Дисквал.', bg: 'oklch(0.75 0.02 250 / 0.15)', color: 'oklch(0.65 0.02 250)' };
                    if (r.includes('под вопрос') || r.includes('doubt') || r.includes('question')
                      || r.includes('not certain') || r.includes('possible'))
                      return { label: 'Под вопросом', bg: 'oklch(0.78 0.12 72 / 0.15)', color: 'oklch(0.65 0.12 72)' };
                    return { label: 'Травма', bg: 'oklch(0.66 0.13 25 / 0.15)', color: 'oklch(0.66 0.13 25)' };
                  }

                  return (
                    <>
                      {allTeamIds.filter((tid) => teams.has(tid)).map((tid, gi) => {
                        const players = teams.get(tid);
                        const name = teamNames[tid] || `Команда ${tid}`;
                        const code = teamCodes[tid] || '';
                        return (
                          <div key={tid}>
                            {/* Team header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px 8px', background: 'var(--sep)', borderBottom: '1px solid var(--sep)' }}>
                              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, color: 'var(--text-3)', border: '1px solid var(--sep)', overflow: 'hidden' }}>
                                {code && code !== 'WW' ? (
                                  <img src={`/country-flags/${code}.svg`} alt={code} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : name.slice(0, 3).toUpperCase()}
                              </div>
                              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{name}</span>
                            </div>
                            {/* Players */}
                            {players.map((inj, i) => {
                              const badge = injuryBadge(inj.reason);
                              return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < players.length - 1 ? '1px solid var(--sep)' : (gi < allTeamIds.filter((tid2) => teams.has(tid2)).length - 1 ? '1px solid var(--sep)' : 'none') }}>
                                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{inj.playerName}</span>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: badge.color, background: badge.bg, padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap' }}>{badge.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </>
                  );
                })() : (
                  <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'oklch(0.72 0.09 150 / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.72 0.09 150)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Потерь нет</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.4' }}>Обе команды в оптимальных составах — травмированных и дисквалифицированных нет.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Brief analytics */}
              <div className="section-header">Краткая аналитика</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', overflow: 'hidden' }}>
                {(item.ai_brief || (item.glicko && item.glicko.homeWinProbability != null)) ? (
                  <>
                    {item.ai_brief && (
                      <div style={{ padding: '14px 16px' }}>
                        {item.ai_brief.headline && (
                          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>{item.ai_brief.headline}</div>
                        )}
                        {item.ai_brief.brief && (
                          <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.5' }}>{item.ai_brief.brief}</div>
                        )}
                        {item.ai_brief.risk_note && (
                          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '8px', fontStyle: 'italic' }}>{item.ai_brief.risk_note}</div>
                        )}
                      </div>
                    )}
                    {item.glicko && item.glicko.homeWinProbability != null && (
                      <div style={{ padding: item.ai_brief ? '0 16px 14px' : '14px 16px' }}>
                        {item.ai_brief && <div style={{ borderTop: '1px solid var(--sep)', margin: '0 -16px 12px', paddingTop: '12px' }} />}
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Вероятности модели</div>
                        {(() => {
                          const hp = Math.round((item.glicko.homeWinProbability || 0) * 100);
                          const dp = Math.round((item.glicko.drawProbability || 0) * 100);
                          const ap = Math.round((item.glicko.awayWinProbability || 0) * 100);
                          const total = hp + dp + ap || 1;
                          const hasDraw = dp > 0;
                          return (
                            <>
                              <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                                <div style={{ flex: hp / total, background: 'var(--accent, #e9b949)' }} />
                                {hasDraw && <div style={{ flex: dp / total, background: 'var(--text-3, #666)', borderLeft: '2px solid var(--surface)', borderRight: '2px solid var(--surface)' }} />}
                                <div style={{ flex: ap / total, background: 'var(--text-2, #999)' }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span style={{ color: 'var(--accent, #e9b949)', fontWeight: 700 }}>{hp}%</span>
                                {hasDraw && <span style={{ color: 'var(--text-2, #999)', fontWeight: 600 }}>{dp}%</span>}
                                <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>{ap}%</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>
                                <span>{team1Name}</span>
                                {hasDraw && <span>Ничья</span>}
                                <span>{team2Name}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'oklch(0.78 0.12 72 / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.78 0.12 72)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Аналитика готовится</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.4' }}>Прогноз Tiger AI появится ближе к началу матча.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stats tab */}
          {activeTab === 'stats' && (
            <div className="tab-content-enter" key={`stats-${activeTab}`}>
              {Object.keys(stats).length > 0 && (
                <>
                  <div className="section-header">Статистика</div>
                  {visibleStatRows.length > 0 ? (
                    <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '12px 16px' }}>
                      {visibleStatRows.map((row) => (
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
                  ) : (
                    <div style={{
                      margin: '0 16px',
                      background: 'linear-gradient(180deg, color-mix(in oklab, var(--surface) 92%, oklch(0.78 0.12 72) 8%) 0%, var(--surface) 100%)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid color-mix(in oklab, var(--sep) 72%, oklch(0.78 0.12 72) 28%)',
                      padding: '18px 16px',
                      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '20px',
                          background: 'oklch(0.78 0.12 72 / 0.14)',
                          border: '1px solid oklch(0.78 0.12 72 / 0.22)',
                          flexShrink: 0,
                        }}>
                          📊
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', marginBottom: '6px' }}>
                            Пока статистика недоступна
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.5' }}>
                            Для этого матча провайдер ещё не отдал live-данные. Мы работаем над этим ⏳
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              {events.length > 0 && (
                <>
                  <div className="section-header">Хронология матча</div>
                  <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '8px 16px', maxHeight: '320px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    {(() => {
                      const sorted = [...events].sort((a, b) => (a.minute || 0) - (b.minute || 0));
                      let homeGoals = 0, awayGoals = 0;
                      const scoreMap = new Map();
                      for (const e of sorted) {
                        if (e.type === 1 && e.name !== 'Missed Penalty') {
                          if (e.teamId === item.homeTeamId) homeGoals++;
                          else awayGoals++;
                          scoreMap.set(e.id, `${homeGoals}:${awayGoals}`);
                        }
                      }
                      return sorted.map((e, i) => (
                        <EventRow key={e.id} event={e} homeTeamId={item.homeTeamId}
                          homeTeamCode={team1Code} awayTeamCode={team2Code}
                          score={scoreMap.get(e.id)}
                          isLast={i === sorted.length - 1} />
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ height: 20 }} />
        </>
      )}
    </div>
  );
}
