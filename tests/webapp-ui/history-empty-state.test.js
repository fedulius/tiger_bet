const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

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

test('history empty-state renders message and CTA link to recommendations', async () => {
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
            empty_state: {
              message: 'Здесь появятся ваши последние прогнозы',
              cta: { label: 'Открыть рекомендации', target: '#recommendations' },
            },
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

  assert.match(historyList.innerHTML, /Здесь появятся ваши последние прогнозы/);
  assert.match(historyList.innerHTML, /Открыть рекомендации/);
  assert.match(historyList.innerHTML, /href="#recommendations"/);
});

test('history list renders format A item fields', async () => {
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
            items: [
              {
                id: 'h1',
                match: 'Arsenal vs Chelsea',
                league: 'Premier League',
                starts_at: '2026-04-22T17:30:00.000Z',
                main_thought: 'Победа Arsenal',
                confidence: 68,
              },
            ],
            empty_state: null,
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

  assert.match(historyList.innerHTML, /Arsenal vs Chelsea/);
  assert.match(historyList.innerHTML, /Premier League/);
  assert.match(historyList.innerHTML, /2026-04-22 20:30/);
  assert.match(historyList.innerHTML, /Победа Arsenal/);
  assert.match(historyList.innerHTML, /68%/);
});
