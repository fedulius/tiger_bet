import React, { useState } from 'react';

const MOCK_BETS_ACTIVE = [
  { match: 'Франция — Швеция', pick: 'Победа Франции', meta: 'ЧМ 2026 · 200 pts', coeff: '1.45', status: 'В игре', statusClass: 'open' },
  { match: 'Реал Мадрид — Бавария', pick: 'Тотал больше 2.5', meta: 'ЛЧ · Финал · 150 pts', coeff: '1.90', status: 'Ожидание', statusClass: 'open' },
];

const MOCK_BETS_HISTORY = [
  { match: 'Бельгия — Сенегал', pick: 'Победа Бельгии', meta: 'ЧМ 2026 · 100 pts', coeff: '1.65', status: 'Выигрыш +65', statusClass: 'win' },
  { match: 'Испания — Австрия', pick: 'Тотал больше 3.5', meta: 'ЧМ 2026 · 120 pts', coeff: '2.40', status: 'Проигрыш', statusClass: 'lose' },
];

export function BetsPage() {
  const [tab, setTab] = useState('active');
  const bets = tab === 'active' ? MOCK_BETS_ACTIVE : MOCK_BETS_HISTORY;

  return (
    <>
      <div className="page-header">
        <div className="page-title">Ставки</div>
      </div>

      <div className="balance-card">
        <div>
          <div className="balance-label">Баланс</div>
          <div className="balance-value">1,240 <span className="balance-unit">pts</span></div>
        </div>
        <div className="balance-delta">+18%</div>
      </div>

      <div className="segment-control">
        <button
          className={`segment-btn${tab === 'active' ? ' active' : ''}`}
          onClick={() => setTab('active')}
        >
          Активные
        </button>
        <button
          className={`segment-btn${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          История
        </button>
      </div>

      {bets.map((bet, i) => (
        <div className="bet-row" key={i}>
          <div className="bet-row-main">
            <div className="bet-row-match">{bet.match}</div>
            <div className="bet-row-pick">{bet.pick}</div>
            <div className="bet-row-meta">{bet.meta}</div>
          </div>
          <div className="bet-row-right">
            <div className="bet-row-coeff">{bet.coeff}</div>
            <div className={`bet-row-status ${bet.statusClass}`}>{bet.status}</div>
          </div>
        </div>
      ))}
    </>
  );
}
