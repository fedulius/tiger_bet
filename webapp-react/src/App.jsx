import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { MatchPage } from './pages/MatchPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RecommendationsPage />} />
      <Route path="/match/:id" element={<MatchPage />} />
      <Route path="/match.html" element={<MatchPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
