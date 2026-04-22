const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'webapp', 'public', 'index.html');
const STYLES_CSS = path.join(__dirname, '..', '..', 'webapp', 'public', 'styles.css');

test('webapp index has single-page sections in required order with sticky header anchors', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  const requiredAnchors = [
    'href="#recommendations"',
    'href="#favorites-sports"',
    'href="#favorites-leagues"',
    'href="#history"',
  ];

  for (const anchor of requiredAnchors) {
    assert.match(html, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const order = ['id="recommendations"', 'id="favorites-sports"', 'id="favorites-leagues"', 'id="history"'];
  const positions = order.map((fragment) => html.indexOf(fragment));

  assert.ok(positions.every((p) => p !== -1), 'All required sections must be present');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'Sections must be rendered in required order');
});

test('styles include sticky header and auto theme via prefers-color-scheme', () => {
  const css = fs.readFileSync(STYLES_CSS, 'utf8');

  assert.match(css, /\.header\s*\{[\s\S]*position:\s*sticky;/i);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/i);
});
