import { withTelegramInitDataHeaders } from './telegram.js';

let authToken = '';

function buildHeaders(headers = {}) {
  const base = withTelegramInitDataHeaders(headers);
  if (authToken) {
    return {
      ...base,
      authorization: `Bearer ${authToken}`,
    };
  }
  return base;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

export async function auth() {
  const payload = await getJson('/auth');
  authToken = String(payload?.token || '').trim();
  return payload;
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
    headers: buildHeaders({
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
