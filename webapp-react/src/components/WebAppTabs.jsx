import React from 'react';
import { NavLink } from 'react-router-dom';

export function WebAppTabs() {
  return (
    <nav className="webapp-tabs" aria-label="Навигация">
      <NavLink
        className={({ isActive }) => `webapp-tab${isActive ? ' active' : ''}`}
        to="/"
        end
      >
        Рекомендации
      </NavLink>
      <NavLink
        className={({ isActive }) => `webapp-tab${isActive ? ' active' : ''}`}
        to="/feed"
      >
        Лента
      </NavLink>
    </nav>
  );
}
