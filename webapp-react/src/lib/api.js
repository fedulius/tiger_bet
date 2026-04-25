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

export function auth() {
  return getJson('/auth')
}

export function getRecommendations() {
  return getJson('/recommendations');
}

export function getHistory() {
  return getJson('/history');
}

export function getFavorites() {
  return getJson('/favorites');
}

export function setFavorites(payload) {
  return fetch('/favorites', {
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
  return getJson(`/match/${encodeURIComponent(id)}`);
}
