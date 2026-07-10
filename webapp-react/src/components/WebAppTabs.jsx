import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M2 10h20"/>
      <path d="M16 14h2"/>
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

export function WebAppTabs() {
  const { pathname } = useLocation();

  const tabs = [
    { to: '/', icon: HomeIcon, label: 'Матчи', match: (path) => path === '/' || path.startsWith('/match') },
    { to: '/recommendations', icon: StarIcon, label: 'Прогнозы', match: (path) => path.startsWith('/recommendations') || path.startsWith('/prediction') },
    { to: '/bets', icon: WalletIcon, label: 'Ставки', match: (path) => path.startsWith('/bets') },
    { to: '/leagues', icon: GlobeIcon, label: 'Лиги', match: (path) => path.startsWith('/leagues') },
    { to: '/profile', icon: UserIcon, label: 'Профиль', match: (path) => path.startsWith('/profile') },
  ];

  return (
    <nav className="bottom-tabs" aria-label="Навигация">
      {tabs.map(({ to, icon: Icon, label, match }) => {
        const isActive = match(pathname);
        return (
          <NavLink
            key={to}
            to={to}
            className={`tab-btn${isActive ? ' active' : ''}`}
            aria-label={label}
            title={label}
            onClick={() => {
              if (to === '/leagues' && isActive) {
                window.dispatchEvent(new CustomEvent('tiger-bet:reset-leagues-tab'));
              }
            }}
          >
            <Icon />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
