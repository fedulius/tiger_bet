const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const APP_JS = path.join(__dirname, '..', '..', 'webapp', 'public', 'app.js');

function createElement() {
  return {
    innerHTML: '',
    textContent: '',
    listeners: {},
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
    click() {
      if (this.listeners.click) {
        this.listeners.click({ preventDefault() {} });
      }
    },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('recommendations block fetches API and renders exactly 3 cards with Новые badge', async () => {
  const refreshBtn = createElement();
  const recommendationsList = createElement();
  const refreshStatus = createElement();

  const payload = {
    updated_at: new Date().toISOString(),
    items: [
      { id: 'm1', match: 'A vs B', league: 'L1', starts_at: '2026-04-22T17:30:00.000Z', main_thought: 'A', confidence: 70, is_new: true },
      { id: 'm2', match: 'C vs D', league: 'L2', starts_at: '2026-04-22T18:30:00.000Z', main_thought: 'C', confidence: 65, is_new: false },
      { id: 'm3', match: 'E vs F', league: 'L3', starts_at: '2026-04-22T19:30:00.000Z', main_thought: 'E', confidence: 62, is_new: true },
      { id: 'm4', match: 'G vs H', league: 'L4', starts_at: '2026-04-22T20:30:00.000Z', main_thought: 'G', confidence: 59, is_new: false },
    ],
  };

  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'refresh-btn') return refreshBtn;
        if (id === 'recommendations-list') return recommendationsList;
        if (id === 'refresh-status') return refreshStatus;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async () => ({ json: async () => payload }),
    Date,
    setTimeout,
    clearTimeout,
    console,
  };

  const code = fs.readFileSync(APP_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  await flush();
  await flush();

  const cardsCount = (recommendationsList.innerHTML.match(/recommendation-card/g) || []).length;
  assert.equal(cardsCount, 3);
  assert.match(recommendationsList.innerHTML, /Новые/);
  assert.match(recommendationsList.innerHTML, /2026-04-22 20:30/);
});

test('manual refresh updates status as "Обновлено X сек назад"', async () => {
  const refreshBtn = createElement();
  const recommendationsList = createElement();
  const refreshStatus = createElement();

  let calls = 0;
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'refresh-btn') return refreshBtn;
        if (id === 'recommendations-list') return recommendationsList;
        if (id === 'refresh-status') return refreshStatus;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    fetch: async () => {
      calls += 1;
      return {
        json: async () => ({
          updated_at: new Date().toISOString(),
          items: [
            { id: 'm1', match: 'A vs B', league: 'L1', starts_at: '2026-04-22T17:30:00.000Z', main_thought: 'A', confidence: 70, is_new: true },
          ],
        }),
      };
    },
    Date,
    setTimeout,
    clearTimeout,
    console,
  };

  const code = fs.readFileSync(APP_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  await flush();
  await flush();

  refreshBtn.click();
  await flush();
  await flush();

  assert.ok(calls >= 2);
  assert.match(refreshStatus.textContent, /Обновлено \d+ сек назад/);
});
