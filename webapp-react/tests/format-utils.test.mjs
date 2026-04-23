import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMoscowDateTime } from '../src/lib/format.js';

test('formatMoscowDateTime converts UTC into Europe/Moscow format YYYY-MM-DD HH:mm', () => {
  const value = formatMoscowDateTime('2026-04-22T17:30:00.000Z');
  assert.equal(value, '2026-04-22 20:30');
});

test('formatMoscowDateTime returns empty string for invalid input', () => {
  assert.equal(formatMoscowDateTime('not-a-date'), '');
});
