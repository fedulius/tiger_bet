// Task 3 MVP service: recommendations feed for webApp.
// Пока персональных настроек нет, поэтому используем fallback список.

const FALLBACK_TOP_MATCHES = [
  {
    id: 'fallback-3',
    match: 'Fnatic vs G2',
    league: 'ESL Pro League',
    starts_at: '2026-04-22T20:00:00.000Z',
    main_thought: 'Победа G2 по текущей форме',
    confidence: 70,
  },
  {
    id: 'fallback-1',
    match: 'Arsenal vs Chelsea',
    league: 'Premier League',
    starts_at: '2026-04-22T17:30:00.000Z',
    main_thought: 'Обе забьют, но Arsenal выглядит сильнее',
    confidence: 68,
  },
  {
    id: 'fallback-4',
    match: 'NAVI vs Spirit',
    league: 'BLAST Premier',
    starts_at: '2026-04-22T22:15:00.000Z',
    main_thought: 'NAVI через плотный матч',
    confidence: 64,
  },
  {
    id: 'fallback-2',
    match: 'Real Madrid vs Sevilla',
    league: 'La Liga',
    starts_at: '2026-04-22T19:00:00.000Z',
    main_thought: 'Победа Real Madrid с контролем темпа',
    confidence: 74,
  },
];

function toIsoDate(value) {
  return new Date(value).toISOString();
}

function pickTopByTime(items, limit = 3) {
  return [...items]
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, limit);
}

function markNewItems(items, nowIso) {
  const nowTs = new Date(nowIso).getTime();

  return items.map((item) => {
    const startTs = new Date(item.starts_at).getTime();
    const diffMinutes = Math.abs(startTs - nowTs) / (1000 * 60);

    return {
      ...item,
      // В MVP считаем «новыми» ближайшие события в окне 120 минут.
      is_new: diffMinutes <= 120,
    };
  });
}

function getRecommendations() {
  const updatedAt = new Date().toISOString();

  const items = markNewItems(
    pickTopByTime(FALLBACK_TOP_MATCHES, 3),
    updatedAt,
  );

  return {
    items,
    source: 'fallback-top',
    updated_at: toIsoDate(updatedAt),
  };
}

module.exports = {
  getRecommendations,
};
