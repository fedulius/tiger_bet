import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { MatchPage } from './pages/MatchPage.jsx';
import { FeedPage } from './pages/FeedPage.jsx';
import { WebAppTabs } from './components/WebAppTabs.jsx';

export default function App() {
  const location = useLocation();
  const isMatchPage = location.pathname.startsWith('/match');

  return (
    <>
      <div className={isMatchPage ? 'app-page-wrapper' : 'app-page-wrapper has-tabs'}>
        <Routes>
          <Route path="/" element={<RecommendationsPage />} />
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/match.html" element={<MatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!isMatchPage ? <WebAppTabs /> : null}
    </>
  );
}
