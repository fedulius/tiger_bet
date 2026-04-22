const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const APP_JS = path.join(__dirname, '..', '..', 'webapp', 'public', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', '..', 'webapp', 'public', 'index.html');

function makeElement(initial = {}) {
  return {
    id: initial.id || '',
    value: initial.value || '',
    innerHTML: initial.innerHTML || '',
    textContent: initial.textContent || '',
    style: initial.style || {},
    dataset: initial.dataset || {},
    listeners: {},
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
    click() {
      if (this.listeners.click) {
        this.listeners.click({ preventDefault() {}, target: this });
      }
    },
  };
}

test('favorites modal markup exists in index.html', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.match(html, /id="favorites-modal"/);
  assert.match(html, /id="favorites-search"/);
  assert.match(html, /id="favorites-options"/);
  assert.match(html, /id="favorites-apply-btn"/);
});

test('favorites flow: search + apply PUT + chips remove updates state', async () => {
  const fetchCalls = [];

  const elements = {
    'refresh-btn': makeElement({ id: 'refresh-btn' }),
    'recommendations-list': makeElement({ id: 'recommendations-list' }),
    'refresh-status': makeElement({ id: 'refresh-status' }),
    'add-sports-btn': makeElement({ id: 'add-sports-btn' }),
    'add-leagues-btn': makeElement({ id: 'add-leagues-btn' }),
    'favorites-modal': makeElement({ id: 'favorites-modal', style: { display: 'none' } }),
    'favorites-search': makeElement({ id: 'favorites-search', value: '' }),
    'favorites-options': makeElement({ id: 'favorites-options' }),
    'favorites-apply-btn': makeElement({ id: 'favorites-apply-btn' }),
    'favorites-close-btn': makeElement({ id: 'favorites-close-btn' }),
    'sports-chips': makeElement({ id: 'sports-chips' }),
    'leagues-chips': makeElement({ id: 'leagues-chips' }),
    'history-list': makeElement({ id: 'history-list' }),
  };

  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (url === '/api/webapp/favorites' && (!options || options.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ sports: ['football'], leagues: ['Premier League'], profile: 'guest' }),
        };
      }

      if (url === '/api/webapp/recommendations') {
        return {
          ok: true,
          json: async () => ({ updated_at: new Date().toISOString(), items: [] }),
        };
      }

      if (url === '/api/webapp/history') {
        return {
          ok: true,
          json: async () => ({ items: [], empty_state: { message: 'empty', cta: { label: 'go', target: '#recommendations' } } }),
        };
      }

      return { ok: true, json: async () => ({}) };
    },
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };

  const code = fs.readFileSync(APP_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  assert.equal(typeof sandbox.__webapp_createApp, 'function');

  const app = sandbox.__webapp_createApp({
    document: sandbox.document,
    fetch: sandbox.fetch,
    setIntervalFn: setInterval,
    clearIntervalFn: clearInterval,
    now: () => Date.now(),
  });

  await app.loadFavorites();

  app.openFavoritesModal('sports');
  elements['favorites-search'].value = 'foot';
  app.renderFavoritesOptions();
  assert.match(elements['favorites-options'].innerHTML, /football/i);

  app.toggleOption('sports', 'tennis', true);
  await app.applyFavorites();

  const putCall = fetchCalls.find((call) => call.url === '/api/webapp/favorites' && call.options?.method === 'PUT');
  assert.ok(putCall, 'PUT /api/webapp/favorites must be called');

  app.removeFavorite('sports', 'tennis');
  assert.ok(!app.getState().favorites.sports.includes('tennis'));
});
