import test from 'node:test';
import assert from 'node:assert/strict';

import { collectAvailableSports } from '../src/lib/feed.js';

test('collectAvailableSports returns backend metadata when available', () => {
  const result = collectAvailableSports({
    available_sports: ['Теннис', 'Футбол', 'Теннис'],
    items: [{ sport: 'Баскетбол' }],
  });

  assert.deepEqual(result, ['Теннис', 'Футбол']);
});

test('collectAvailableSports falls back to current page items when backend metadata is absent', () => {
  const result = collectAvailableSports({
    items: [{ sport: 'Теннис' }, { sport: 'Теннис' }, { sport: 'Футбол' }],
  });

  assert.deepEqual(result, ['Теннис', 'Футбол']);
});

test('collectAvailableSports preserves previously visible filters when a sport-specific response lacks metadata', () => {
  const result = collectAvailableSports({
    items: [{ sport: 'Баскетбол' }],
  }, {
    fallbackSports: ['Баскетбол', 'Теннис'],
    preserveFallback: true,
  });

  assert.deepEqual(result, ['Баскетбол', 'Теннис']);
});

test('collectAvailableSports does not preserve old filters unless asked', () => {
  const result = collectAvailableSports({
    items: [{ sport: 'Баскетбол' }],
  }, {
    fallbackSports: ['Баскетбол', 'Теннис'],
    preserveFallback: false,
  });

  assert.deepEqual(result, ['Баскетбол']);
});

test('collectAvailableSports returns empty list for malformed payload', () => {
  assert.deepEqual(collectAvailableSports(null), []);
  assert.deepEqual(collectAvailableSports({ available_sports: '', items: null }), []);
});
