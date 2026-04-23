import { withTelegramInitDataHeaders } from './telegram.js';

async function getJson(url) {
  const response = await fetch(url, {
    headers: withTelegramInitDataHeaders(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

export function getRecommendations() {
  return getJson('/api/webapp/recommendations');
}

export function getHistory() {
  return getJson('/api/webapp/history');
}

export function getFavorites() {
  return getJson('/api/webapp/favorites');
}

export function setFavorites(payload) {
  return fetch('/api/webapp/favorites', {
    method: 'PUT',
    headers: withTelegramInitDataHeaders({
      'content-type': 'application/json',
    }),
    body: JSON.stringify(payload || {}),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });
}

export function getMatchDetails(id) {
  return getJson(`/api/webapp/match/${encodeURIComponent(id)}`);
}
