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

          {/* Tab toggle — only when match is live/finished AND has analytics */}
          {item.hasAnalytics && (item.isLive || item.isFinished) && (
            <div style={{ display: 'flex', margin: '16px 16px 0', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', overflow: 'hidden' }}>
              <button
                onClick={() => setActiveTab('analytics')}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                  background: activeTab === 'analytics' ? 'var(--accent, #e9b949)' : 'transparent',
                  color: activeTab === 'analytics' ? '#0c0d10' : 'var(--text-2)',
                  fontWeight: 700, fontSize: '13px', transition: 'all 0.2s',
                }}
              >Аналитика</button>
              <button
                onClick={() => setActiveTab('stats')}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                  background: activeTab === 'stats' ? 'var(--accent, #e9b949)' : 'transparent',
                  color: activeTab === 'stats' ? '#0c0d10' : 'var(--text-2)',
                  fontWeight: 700, fontSize: '13px', transition: 'all 0.2s',
                }}
              >Статистика</button>
            </div>
          )}

          {/* Analytics tab — shown when: no toggle (upcoming), or analytics tab active */}
          {(activeTab === 'analytics' || !item.hasAnalytics || (!item.isLive && !item.isFinished)) && (
            <>
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
                  <EmptyState text="Нет данных о личных встречах" />
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

              {/* Glicko probabilities */}
              <div className="section-header">Вероятности модели</div>
              <div style={{ margin: '0 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--sep)', padding: '12px 16px' }}>
                {item.glicko && item.glicko.homeWinProbability != null ? (
                  <>
                    {(() => {
                      const hp = Math.round((item.glicko.homeWinProbability || 0) * 100);
                      const dp = Math.round((item.glicko.drawProbability || 0) * 100);
                      const ap = Math.round((item.glicko.awayWinProbability || 0) * 100);
                      const total = hp + dp + ap || 1;
                      const hasDraw = dp > 0;
                      return (
                        <>
                          <div style={{ display: 'flex', gap: hasDraw ? '3px' : '0', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                            <div style={{ flex: hp / total, background: 'var(--accent, #e9b949)', borderRadius: hasDraw ? '4px 0 0 4px' : '4px 0 0 4px' }} />
                            {hasDraw && <div style={{ flex: dp / total, background: 'var(--text-3, #666)' }} />}
                            <div style={{ flex: ap / total, background: 'var(--text-2, #999)', borderRadius: hasDraw ? '0 4px 4px 0' : '0 4px 4px 0' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span style={{ color: 'var(--accent, #e9b949)', fontWeight: 700 }}>{hp}%</span>
                            <span style={{ color: 'var(--text-3)' }}>{dp}%</span>
                            <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>{ap}%</span>
                          </div>
                        </>
                      );
                    })()}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>
                      <span>{team1Name}</span>
                      <span>Ничья</span>
                      <span>{team2Name}</span>
                    </div>
                  </>
                ) : (
                  <EmptyState text="Нет данных о вероятностях" />
                )}
              </div>
            </>
          )}

          {/* Stats tab */}
          {activeTab === 'stats' && (
            <>
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
            </>
          )}

          <div style={{ height: 20 }} />
        </>
      )}
    </div>
  );
}
