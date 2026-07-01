import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { BetsPage } from './pages/BetsPage.jsx';
import { LeaguesPage } from './pages/LeaguesPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { MatchPage } from './pages/MatchPage.jsx';
import { WebAppTabs } from './components/WebAppTabs.jsx';

export default function App() {
  const location = useLocation();
  const isMatchPage = location.pathname.startsWith('/match');

  return (
    <div className="app-shell">
      <div className="page active">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
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
