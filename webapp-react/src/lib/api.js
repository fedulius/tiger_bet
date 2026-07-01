import { withTelegramInitDataHeaders, getTelegramInitData } from './telegram.js';

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

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function isLocalhostOrigin() {
  const hostname = globalThis?.location?.hostname || '';
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export async function auth() {
  const endpoint = !getTelegramInitData() && isLocalhostOrigin() ? '/auth/preview' : '/auth';
  const payload = await getJson(endpoint);
  authToken = String(payload?.token || '').trim();
  return payload;
}

export function getRecommendations({ recommendations_version } = {}) {
  const params = new URLSearchParams();
  if (recommendations_version) params.set('recommendations_version', recommendations_version);
  const suffix = params.toString();
  return getJson(suffix ? `/recommendations?${suffix}` : '/recommendations');
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
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });
}

export function getMatchDetails(id) {
  return getJson(`/match/${encodeURIComponent(id)}`);
}

export function getFeed({ window, sport, country, league, feed_version, limit = 10, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (window) params.set('window', window);
  if (sport) params.set('sport', sport);
  if (country) params.set('country', country);
  if (league) params.set('league', league);
  if (feed_version) params.set('feed_version', feed_version);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return getJson(`/feed?${params.toString()}`);
}
