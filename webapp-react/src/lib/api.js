import { withTelegramInitDataHeaders, getTelegramInitData } from './telegram.js';

let authToken = '';
let _onAccessDenied = null;

export function setOnAccessDenied(cb) {
  _onAccessDenied = cb;
}

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
    if (response.status === 403 && _onAccessDenied) {
      _onAccessDenied();
    }
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

export function getHomeMatches() {
  return getJson('/home');
}

export function getPrediction(slug) {
  return getJson(`/prediction/${encodeURIComponent(slug)}`);
}

export function getDailyPicks() {
  return getJson('/home/daily-picks');
}

export async function fetchJSON(url, options = {}) {
  const hasBody = options.body != null;
  const headers = buildHeaders({
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...options.headers,
  });
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    if (response.status === 403 && _onAccessDenied) {
      _onAccessDenied();
    }
    throw error;
  }
  return response.json();
}

export function getLeagueSearchSuggestions(query) {
  return fetchJSON(`/leagues/search/suggest?q=${encodeURIComponent(query)}`);
}

export function searchLeagues(query) {
  return fetchJSON(`/leagues/search?q=${encodeURIComponent(query)}`);
}
