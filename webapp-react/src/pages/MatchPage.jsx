import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { auth, getMatchDetails } from '../lib/api.js';
import { formatMoscowDateTime } from '../lib/format.js';
import { resolveMatchId } from '../lib/match.js';

// Mock data for demo matches
const MOCK_MATCHES = {
  'fra-swe': {
    match: 'Франция — Швеция',
    league: 'ЧМ 2026 · 1/8 финала',
    starts_at: '2026-06-30T22:00:00.000Z',
    score: '2 : 1',
    team1_code: 'FRA',
    team2_code: 'SWE',
    bets: [
      { forecast: 'Победа Франции', coeff: '1.45' },
      { forecast: 'Тотал больше 2.5', coeff: '1.87' },
      { forecast: 'Точный счёт 2:1', coeff: '8.50' },
    ],
    form: {
      FRA: { name: 'Франция', code: 'FRA', results: ['W', 'W', 'D', 'W', 'W'] },
      SWE: { name: 'Швеция', code: 'SWE', results: ['L', 'W', 'D', 'L', 'W'] },
    },
    h2h: { a: 5, d: 1, b: 1, aLabel: 'Франция', bLabel: 'Швеция' },
  },
  'mex-ecu': {
    match: 'Мексика — Эквадор',
    league: 'ЧМ 2026 · 1/8 финала',
    starts_at: '2026-07-01T02:00:00.000Z',
    score: null,
    team1_code: 'MEX',
    team2_code: 'ECU',
    bets: [
      { forecast: 'Обе забьют', coeff: '1.72' },
      { forecast: 'Тотал меньше 2.5', coeff: '1.95' },
      { forecast: 'Ничья 1:1', coeff: '6.20' },
    ],
    form: {
      MEX: { name: 'Мексика', code: 'MEX', results: ['W', 'D', 'W', 'W', 'L'] },
      ECU: { name: 'Эквадор', code: 'ECU', results: ['D', 'W', 'L', 'D', 'W'] },
    },
    h2h: { a: 3, d: 2, b: 1, aLabel: 'Мексика', bLabel: 'Эквадор' },
  },
  'eng-cod': {
    match: 'Англия — ДР Конго',
    league: 'ЧМ 2026 · 1/8 финала',
    starts_at: '2026-07-01T05:00:00.000Z',
    score: null,
    team1_code: 'ENG',
    team2_code: 'COD',
    bets: [
      { forecast: 'Победа Англии', coeff: '1.25' },
      { forecast: 'Тотал больше 2.5', coeff: '1.65' },
      { forecast: 'Англия -2.5', coeff: '2.10' },
    ],
    form: {
      ENG: { name: 'Англия', code: 'ENG', results: ['W', 'W', 'W', 'D', 'W'] },
      COD: { name: 'ДР Конго', code: 'COD', results: ['L', 'D', 'L', 'W', 'L'] },
    },
    h2h: { a: 2, d: 0, b: 0, aLabel: 'Англия', bLabel: 'ДР Конго' },
  },
  'ars-che': {
    match: 'Арсенал — Челси',
    league: 'АПЛ · Тур 1',
    starts_at: '2026-07-01T21:00:00.000Z',
    score: null,
    team1_code: 'ARS',
    team2_code: 'CHE',
    bets: [
      { forecast: '1X', coeff: '1.32' },
      { forecast: 'Тотал больше 2.5', coeff: '1.80' },
      { forecast: 'Арсенал + ТБ 3.5', coeff: '4.10' },
    ],
    form: {
      ARS: { name: 'Арсенал', code: 'ARS', results: ['W', 'W', 'D', 'W', 'W'] },
      CHE: { name: 'Челси', code: 'CHE', results: ['W', 'L', 'W', 'D', 'W'] },
    },
    h2h: { a: 4, d: 3, b: 3, aLabel: 'Арсенал', bLabel: 'Челси' },
  },
  'liv-new': {
    match: 'Ливерпуль — Ньюкасл',
    league: 'АПЛ · Тур 1',
    starts_at: '2026-07-01T21:00:00.000Z',
    score: null,
    team1_code: 'LIV',
    team2_code: 'NEW',
    bets: [
      { forecast: 'Победа Ливерпуля', coeff: '1.55' },
      { forecast: 'Обе забьют', coeff: '1.75' },
      { forecast: 'Точный счёт 2:1', coeff: '7.50' },
    ],
    form: {
      LIV: { name: 'Ливерпуль', code: 'LIV', results: ['W', 'W', 'W', 'W', 'D'] },
      NEW: { name: 'Ньюкасл', code: 'NEW', results: ['W', 'D', 'L', 'W', 'W'] },
    },
    h2h: { a: 6, d: 2, b: 2, aLabel: 'Ливерпуль', bLabel: 'Ньюкасл' },
  },
  'rma-bay': {
    match: 'Реал Мадрид — Бавария',
    league: 'ЛЧ · Финал',
    starts_at: '2026-07-03T21:00:00.000Z',
    score: null,
    team1_code: 'RMA',
    team2_code: 'BAY',
    bets: [
      { forecast: '1X', coeff: '1.40' },
      { forecast: 'Тотал больше 2.5', coeff: '1.85' },
      { forecast: 'Реал + Обе забьют', coeff: '2.50' },
    ],
    form: {
      RMA: { name: 'Реал Мадрид', code: 'RMA', results: ['W', 'W', 'W', 'D', 'W'] },
      BAY: { name: 'Бавария', code: 'BAY', results: ['W', 'W', 'D', 'W', 'W'] },
    },
    h2h: { a: 4, d: 2, b: 4, aLabel: 'Реал', bLabel: 'Бавария' },
  },
};

function FormChip({ result }) {
  return <span className={`form-chip ${result}`}>{result === 'W' ? 'В' : result === 'D' ? 'Н' : 'П'}</span>;
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

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!matchId) {
        setState({ loading: false, error: 'Не указан id матча', item: null, unauthorized: false });
        return;
      }

      // Check mock data first
      if (MOCK_MATCHES[matchId]) {
        if (!cancelled) {
          setState({ loading: false, error: '', item: MOCK_MATCHES[matchId], unauthorized: false });
        }
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
  const bets = Array.isArray(item?.bets) ? item.bets.slice(0, 3) : [];

  // Parse match name for teams
  const matchName = item?.match || 'Матч — Матч';
  const parts = matchName.split(' — ');
  const team1Name = parts[0] || 'Команда 1';
  const team2Name = parts[1] || 'Команда 2';

  // Extract team codes from match or use defaults
  const team1Code = item?.team1_code || team1Name.substring(0, 3).toUpperCase();
  const team2Code = item?.team2_code || team2Name.substring(0, 3).toUpperCase();

  const quickBets = [
    { level: 'Надёжный', forecast: bets[0]?.forecast || '—', coeff: bets[0]?.coeff || '—', dotClass: 'green' },
    { level: 'Средний', forecast: bets[1]?.forecast || '—', coeff: bets[1]?.coeff || '—', dotClass: 'amber' },
    { level: 'Рискованный', forecast: bets[2]?.forecast || '—', coeff: bets[2]?.coeff || '—', dotClass: 'red' },
  ];

  const form = item?.form || {};
  const h2h = item?.h2h || { a: 0, d: 0, b: 0, aLabel: team1Name, bLabel: team2Name };

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
        <span className="detail-title">Матч</span>
      </div>

      {state.loading && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>Загрузка...</div>
      )}

      {state.error && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-2)' }}>{state.error}</div>
      )}

      {!state.loading && !state.error && item && (
        <>
          {/* Hero */}
          <div className="detail-hero">
            <div className="detail-team">
              <div className="detail-flag">{team1Code}</div>
              <div className="detail-team-name">{team1Name}</div>
            </div>
            <div className="detail-score">{item.score || '—'}</div>
            <div className="detail-team">
              <div className="detail-flag">{team2Code}</div>
              <div className="detail-team-name">{team2Name}</div>
            </div>
          </div>
          <div className="detail-meta">
            <span>{item.league || 'Лига'}</span>
            <span>·</span>
            <span>{item.stage || ''}</span>
            <span>·</span>
            <span>{formatMoscowDateTime(item.starts_at || '') || '—'}</span>
          </div>

          {/* Quick bets */}
          {bets.length > 0 && (
            <>
              <div className="section-header">Быстрые ставки</div>
              <div className="quick-wrap">
                {quickBets.map((bet, i) => (
                  <div className="quick-card" key={i}>
                    <div className="quick-label">
                      <span className={`risk-dot ${bet.dotClass}`} />
                      {bet.level}
                    </div>
                    <div className="quick-forecast">{bet.forecast}</div>
                    <div className="quick-coeff">{bet.coeff}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* All bets */}
          {bets.length > 0 && (
            <>
              <div className="section-header">Все ставки</div>
              {bets.map((bet, i) => (
                <div className="bet-option" key={i}>
                  <span className="bet-option-label">{bet.forecast}</span>
                  <span className="bet-option-coeff">{bet.coeff}</span>
                </div>
              ))}
            </>
          )}

          {/* Form */}
          {Object.keys(form).length > 0 && (
            <>
              <div className="section-header">Форма команд</div>
              <div className="form-group">
                {Object.values(form).map((team) => (
                  <div className="form-row" key={team.code}>
                    <div className="form-team-info">
                      <div className="team-flag">{team.code}</div>
                      <span className="form-team-name">{team.name}</span>
                    </div>
                    <div className="form-chips">
                      {team.results.map((r, j) => (
                        <FormChip key={j} result={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* H2H */}
          <div className="section-header">Личные встречи</div>
          <div className="h2h-card">
            <div className="h2h-cell">
              <div className="h2h-num">{h2h.a}</div>
              <div className="h2h-label">{h2h.aLabel}</div>
            </div>
            <div className="h2h-cell-mid">
              <div className="h2h-num-muted">{h2h.d}</div>
              <div className="h2h-label">Ничьи</div>
            </div>
            <div className="h2h-cell">
              <div className="h2h-num">{h2h.b}</div>
              <div className="h2h-label">{h2h.bLabel}</div>
            </div>
          </div>

          <div style={{ height: 20 }} />
        </>
      )}
    </div>
  );
}
