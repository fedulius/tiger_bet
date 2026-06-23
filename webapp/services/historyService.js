const { FALLBACK_TOP_MATCHES } = require('./recommendationService');

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

function buildUserHistoryPayload(favoriteSports = []) {
  const ids = new Set((Array.isArray(favoriteSports) ? favoriteSports : [])
    .map((item) => Number(item?.sport_id))
    .filter(Number.isFinite));

  const items = FALLBACK_TOP_MATCHES
    .filter((item) => ids.has(Number(item.sport_id)))
    .slice(0, 3)
    .map((item, index) => ({
      id: `history-${item.id || index + 1}`,
      match: item.match,
      league: item.league,
      starts_at: item.starts_at,
      main_thought: item.main_thought,
      confidence: Number(item.confidence) || 0,
    }));

  if (items.length === 0) {
    return getEmptyHistoryPayload();
  }

  return {
    items,
    empty_state: null,
    updated_at: new Date().toISOString(),
  };
}

function getHistory({ sample = false, favoriteSports = [] } = {}) {
  if (sample) {
    return getSampleHistoryPayload();
  }

  if (Array.isArray(favoriteSports) && favoriteSports.length > 0) {
    return buildUserHistoryPayload(favoriteSports);
  }

  return getEmptyHistoryPayload();
}

module.exports = {
  getHistory,
};
