import React from 'react';

function EmptyState({ message }) {
  return <div className="bets-empty-state">{message}</div>;
}

export function BetsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Ставки</div>
          <div className="page-subtitle">Раздел истории и трекинга ставок</div>
        </div>
      </div>

      <EmptyState message="Active daily picks перенесены в таб «Прогнозы». История ставок будет подключена отдельно." />
    </>
  );
}
