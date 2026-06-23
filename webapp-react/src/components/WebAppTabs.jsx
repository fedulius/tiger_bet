import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

function RecommendationsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.75l2.55 5.17 5.71.83-4.13 4.02.97 5.68L12 16.77l-5.1 2.68.97-5.68L3.74 9.75l5.71-.83L12 3.75z"
        fill="currentColor"
      />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25V6.75zm3 1.5a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H7zm0 4a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5H7zm0 4a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H7z"
        fill="currentColor"
      />
    </svg>
  );
}

export function WebAppTabs() {
  const { pathname } = useLocation();
  const isFeed = pathname.startsWith('/feed');

  return (
    <nav className={`webapp-tabs${isFeed ? ' at-feed' : ''}`} aria-label="Навигация">
      <span className="webapp-tab-pill" aria-hidden="true" />
      <NavLink
        aria-label="Рекомендации"
        title="Рекомендации"
        className={({ isActive }) => `webapp-tab${isActive ? ' active' : ''}`}
        to="/"
        end
      >
        <RecommendationsIcon />
      </NavLink>
      <NavLink
        aria-label="Лента"
        title="Лента"
        className={({ isActive }) => `webapp-tab${isActive ? ' active' : ''}`}
        to="/feed"
      >
        <FeedIcon />
      </NavLink>
    </nav>
  );
}
