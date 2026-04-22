const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { getRecommendations } = require('../../webapp/services/recommendationService');

const APP_JS = path.join(__dirname, '..', '..', 'webapp', 'public', 'app.js');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    listeners: {},
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
  };
}

test('recommendations fallback to top matches when favorites source is empty', () => {
  const payload = getRecommendations({
    source: 'favorites',
    items: [],
  });

  assert.equal(payload.source, 'fallback-top');
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length, 3);
});

test('history UI renders default empty-state text and CTA when API sends empty items without empty_state', async () => {
  const historyList = makeElement();

  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'history-list') return historyList;
        return makeElement();
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async (url) => {
      if (url === '/api/webapp/history') {
        return {
          ok: true,
          json: async () => ({
            items: [],
          }),
        };
      }

      return { ok: true, json: async () => ({ items: [], updated_at: new Date().toISOString() }) };
    },
    Date,
    setTimeout,
    clearTimeout,
    setInterval: () => 112,
    clearInterval: () => {},
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

  await app.loadHistory();

  assert.match(historyList.innerHTML, /История пока пустая/);
  assert.match(historyList.innerHTML, /Открыть рекомендации/);
  assert.match(historyList.innerHTML, /href="#recommendations"/);
});
