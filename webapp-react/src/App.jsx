import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { PredictionPage } from './pages/PredictionPage.jsx';
import { BetsPage } from './pages/BetsPage.jsx';
import { LeaguesPage } from './pages/LeaguesPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { MatchPage } from './pages/MatchPage.jsx';
import { WebAppTabs } from './components/WebAppTabs.jsx';
import { initTelegramWebApp } from './lib/telegram.js';

const KEYBOARD_OPEN_CLASS = 'keyboard-open';
const KEYBOARD_DELTA_PX = 140;

function isTextInputElement(target) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = (target.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(type);
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

export default function App() {
  const location = useLocation();
  const isMatchPage = location.pathname.startsWith('/match') || location.pathname.startsWith('/prediction');

  useEffect(() => { initTelegramWebApp(); }, []);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const baselineHeight = Math.max(window.innerHeight || 0, vv?.height || 0);

    const updateKeyboardState = () => {
      const active = document.activeElement;
      const activeIsInput = isTextInputElement(active);
      const viewportHeight = vv?.height || window.innerHeight || 0;
      const keyboardOpen = activeIsInput && baselineHeight - viewportHeight > KEYBOARD_DELTA_PX;
      root.classList.toggle(KEYBOARD_OPEN_CLASS, keyboardOpen);
    };

    const handleFocusIn = () => updateKeyboardState();
    const handleFocusOut = () => {
      window.setTimeout(updateKeyboardState, 50);
    };

    updateKeyboardState();
    vv?.addEventListener('resize', updateKeyboardState);
    window.addEventListener('resize', updateKeyboardState);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      root.classList.remove(KEYBOARD_OPEN_CLASS);
      vv?.removeEventListener('resize', updateKeyboardState);
      window.removeEventListener('resize', updateKeyboardState);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="page active">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/prediction/:slug" element={<PredictionPage />} />
          <Route path="/bets" element={<BetsPage />} />
          <Route path="/leagues" element={<LeaguesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/match.html" element={<MatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!isMatchPage ? <WebAppTabs /> : null}
    </div>
  );
}
