import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMatchId, buildMatchBackLink } from '../src/lib/match.js';

test('resolveMatchId prefers route param id', () => {
  const id = resolveMatchId({
    routeParamId: 'fallback-1',
    search: '?id=fallback-2',
  });

  assert.equal(id, 'fallback-1');
});

test('resolveMatchId reads id from query for /match.html compatibility', () => {
  const id = resolveMatchId({
    routeParamId: '',
    search: '?id=fallback-2',
  });

  assert.equal(id, 'fallback-2');
});

test('buildMatchBackLink returns /webapp', () => {
  assert.equal(buildMatchBackLink(), '/webapp');
});
