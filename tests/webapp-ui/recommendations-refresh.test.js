const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const APP_JS = path.join(__dirname, '..', '..', 'webapp', 'public', 'app.js');

function makeElement(initial = {}) {
  return {
    innerHTML: initial.innerHTML || '',
    textContent: initial.textContent || '',
    value: initial.value || '',
    style: initial.style || {},
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

test('recommendations auto-refresh interval starts on init (3-5 minutes)', async () => {
  const elements = {
    'refresh-btn': makeElement(),
    'recommendations-list': makeElement(),
    'recommendations-error': makeElement(),
    'refresh-status': makeElement(),
    'history-list': makeElement(),
  };

  let intervalMs = null;

  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] || makeElement();
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async () => ({ ok: true, json: async () => ({ items: [], updated_at: new Date().toISOString() }) }),
    setInterval: (fn, ms) => {
      intervalMs = ms;
      return 123;
    },
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    Date,
    console,
  };

  const code = fs.readFileSync(APP_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  const app = sandbox.__webapp_createApp({
    document: sandbox.document,
    fetch: sandbox.fetch,
    setIntervalFn: sandbox.setInterval,
    clearIntervalFn: sandbox.clearInterval,
    now: () => Date.now(),
  });

  await app.init();

  assert.equal(typeof intervalMs, 'number');
  assert.ok(intervalMs >= 180000 && intervalMs <= 300000, 'auto-refresh must poll every 3-5 minutes');
});

test('recommendations soft error does not block UI and shows inline retry', async () => {
  const recommendationsList = makeElement({ innerHTML: '<article class="recommendation-card">existing</article>' });
  const recommendationsError = makeElement();
  const elements = {
    'refresh-btn': makeElement(),
    'recommendations-list': recommendationsList,
    'recommendations-error': recommendationsError,
    'refresh-status': makeElement(),
    'history-list': makeElement(),
  };

  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] || makeElement();
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async (url) => {
      if (url === '/api/webapp/recommendations') {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    },
    setInterval: () => 321,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    Date,
    console,
  };

  const code = fs.readFileSync(APP_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  const app = sandbox.__webapp_createApp({
    document: sandbox.document,
    fetch: sandbox.fetch,
    setIntervalFn: setInterval,
    clearIntervalFn: clearInterval,
    now: () => Date.now(),
  });

  await app.refreshRecommendations();

  assert.match(recommendationsList.innerHTML, /existing/);
  assert.match(recommendationsError.innerHTML, /Повторить/);
});
