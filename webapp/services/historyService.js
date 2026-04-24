function getEmptyHistoryPayload() {
  return {
    items: [],
    empty_state: {
      message: 'Здесь появятся ваши последние прогнозы',
      cta: {
        label: 'Открыть рекомендации',
        target: '#recommendations',
      },
    },
    updated_at: new Date().toISOString(),
  };
}

function getSampleHistoryPayload() {
  return {
    items: [
      {
        id: 'history-1',
        match: 'Arsenal vs Chelsea',
        league: 'Premier League',
        starts_at: '2026-04-22T17:30:00.000Z',
        main_thought: 'Победа Arsenal',
        confidence: 68,
      },
    ],
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

function getHistory({ sample = false } = {}) {
  if (sample) {
    return getSampleHistoryPayload();
  }

  return getEmptyHistoryPayload();
}

module.exports = {
  getHistory,
};
