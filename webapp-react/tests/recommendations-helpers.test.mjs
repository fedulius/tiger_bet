import test from 'node:test';
import assert from 'node:assert/strict';

import { formatRelativeUpdatedAt, getTopRecommendations } from '../src/lib/recommendations.js';

test('getTopRecommendations returns max 3 items preserving order', () => {
  const result = getTopRecommendations([
    { id: 'm1' },
    { id: 'm2' },
    { id: 'm3' },
    { id: 'm4' },
  ]);

  assert.deepEqual(result.map((x) => x.id), ['m1', 'm2', 'm3']);
});

test('formatRelativeUpdatedAt returns readable seconds delta', () => {
  const now = new Date('2026-04-23T10:00:05.000Z').getTime();
  const text = formatRelativeUpdatedAt('2026-04-23T10:00:00.000Z', { now });

  assert.equal(text, 'Обновлено 5 сек назад');
});

test('formatRelativeUpdatedAt handles invalid value as zero seconds', () => {
  const text = formatRelativeUpdatedAt('bad-date', { now: 1000 });
  assert.equal(text, 'Обновлено 0 сек назад');
});
