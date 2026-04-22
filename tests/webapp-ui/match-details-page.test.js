const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const MATCH_HTML = path.join(__dirname, '..', '..', 'webapp', 'public', 'match.html');
const MATCH_JS = path.join(__dirname, '..', '..', 'webapp', 'public', 'match.js');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    listeners: {},
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
  };
}

test('match details page markup exists and loads match.js', () => {
  const html = fs.readFileSync(MATCH_HTML, 'utf8');
  assert.match(html, /id="match-details"/);
  assert.match(html, /id="match-external-link"/);
  assert.match(html, /src="\/webapp\/match.js"/);
});

test('match.js reads id from query and renders details with external source button', async () => {
  const details = makeElement();
  const external = makeElement();

  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'match-details') return details;
        if (id === 'match-external-link') return external;
        return null;
      },
    },
    window: {
      location: {
        search: '?id=fallback-1',
      },
    },
    URLSearchParams,
    fetch: async (url) => {
      assert.equal(url, '/api/webapp/match/fallback-1');
      return {
        ok: true,
        json: async () => ({
          match: 'Arsenal vs Chelsea',
          league: 'Premier League',
          starts_at: '2026-04-22T17:30:00.000Z',
          main_thought: 'Победа Arsenal',
          confidence: 68,
          basis: 'Форма и xG',
          source_url: 'https://example.com/match',
        }),
      };
    },
    console,
    setTimeout,
    clearTimeout,
  };

  const code = fs.readFileSync(MATCH_JS, 'utf8');
  vm.runInNewContext(code, sandbox);

  assert.equal(typeof sandbox.__matchPage_createApp, 'function');

  const app = sandbox.__matchPage_createApp({
    document: sandbox.document,
    location: sandbox.window.location,
    fetch: sandbox.fetch,
  });

  await app.init();

  assert.match(details.innerHTML, /Arsenal vs Chelsea/);
  assert.match(details.innerHTML, /Форма и xG/);
  assert.match(details.innerHTML, /68%/);
  assert.match(external.innerHTML, /target="_blank"/);
  assert.match(external.innerHTML, /https:\/\/example.com\/match/);
});
