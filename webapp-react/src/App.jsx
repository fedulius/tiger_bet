import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { PredictionPage } from './pages/PredictionPage.jsx';
import { BetsPage } from './pages/BetsPage.jsx';
import { LeaguesPage } from './pages/LeaguesPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { MatchPage } from './pages/MatchPage.jsx';
import { WebAppTabs } from './components/WebAppTabs.jsx';
import { initTelegramWebApp } from './lib/telegram.js';
import { auth, setOnAccessDenied } from './lib/api.js';

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

function DeniedScreen() {
  return (
    <div style={{ padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔒</div>
      <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)', marginBottom: '12px' }}>
        Купите подписку для доступа в приложение
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.5 }}>
        Ваш Telegram-аккаунт не добавлен в список доступа.<br />
        Обратитесь к администратору для получения доступа.
      </div>
    </div>
  );
}

export default function App() {
  const [authState, setAuthState] = useState('pending');

  useEffect(() => { initTelegramWebApp(); }, []);

  useEffect(() => {
    setOnAccessDenied(() => setAuthState('denied'));
    let cancelled = false;
    auth()
      .then(() => { if (!cancelled) setAuthState('ok'); })
      .catch((err) => {
        if (!cancelled) {
          setAuthState(err?.status === 403 ? 'denied' : 'error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const baselineHeight = Math.max(window.innerHeight || 0, vv?.height || 0);

    const setKeyboardOpen = (open) => {
      root.classList.toggle(KEYBOARD_OPEN_CLASS, open);
    };

    const updateKeyboardState = () => {
      const active = document.activeElement;
      const activeIsInput = isTextInputElement(active);
      const viewportHeight = vv?.height || window.innerHeight || 0;
      const keyboardOpen = activeIsInput && baselineHeight - viewportHeight > KEYBOARD_DELTA_PX;
      setKeyboardOpen(keyboardOpen);
    };

    const handleFocusIn = (event) => {
      if (isTextInputElement(event.target)) {
        setKeyboardOpen(true);
      }
      window.setTimeout(updateKeyboardState, 30);
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!isTextInputElement(active)) {
          setKeyboardOpen(false);
        }
        updateKeyboardState();
      }, 80);
    };

    updateKeyboardState();
    vv?.addEventListener('resize', updateKeyboardState);
    window.addEventListener('resize', updateKeyboardState);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      setKeyboardOpen(false);
      vv?.removeEventListener('resize', updateKeyboardState);
      window.removeEventListener('resize', updateKeyboardState);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  if (authState === 'pending') {
    return (
      <div className="app-shell">
        <div className="page active" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 'calc(100vh - 120px)',
        }}>
          <div style={{ fontSize: '40px', animation: 'ball-bounce 0.6s ease-in-out infinite alternate' }}>⚽</div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginTop: '16px' }}>Загрузка</div>
          <style>{`@keyframes ball-bounce { 0% { transform: translateY(0); } 100% { transform: translateY(-16px); } }`}</style>
        </div>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="app-shell">
        <div className="page active">
          <DeniedScreen />
        </div>
      </div>
    );
  }

  if (authState === 'error') {
    return (
      <div className="app-shell">
        <div className="page active" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 'calc(100vh - 120px)', padding: '20px',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
            Ошибка подключения
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)' }}>
            Попробуйте обновить страницу
          </div>
        </div>
      </div>
    );
  }

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
      <WebAppTabs />
    </div>
  );
}
