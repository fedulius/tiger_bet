import React from 'react';
import { useParams } from 'react-router-dom';

export function MatchPage() {
  const { id } = useParams();

  return (
    <main className="layout">
      <h1>Детали матча</h1>
      <p>ID: {id}</p>
      <p className="hint">Экран-плейсхолдер для поэтапной миграции match view.</p>
    </main>
  );
}
