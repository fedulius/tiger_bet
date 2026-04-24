export function getTopRecommendations(items, limit = 3) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.slice(0, limit);
}

export function formatRelativeUpdatedAt(updatedAtIso, { now = Date.now() } = {}) {
  const updatedMs = new Date(updatedAtIso).getTime();
  if (!Number.isFinite(updatedMs)) {
    return 'Обновлено 0 сек назад';
  }

  const diffSeconds = Math.max(0, Math.floor((now - updatedMs) / 1000));
  return `Обновлено ${diffSeconds} сек назад`;
}
