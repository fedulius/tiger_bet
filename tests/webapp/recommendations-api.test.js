const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');

test('GET /recommendations returns 3 items sorted by starts_at', async () => {
  const app = buildApp({ pg: null, bot: null });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/recommendations',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.ok(['fallback-top', 'stavka-live'].includes(payload.source));
    assert.ok(payload.updated_at);
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 3);

    for (const item of payload.items) {
      assert.ok(item.id);
      assert.ok(item.match);
      assert.ok(item.league);
      assert.ok(item.starts_at);
      assert.ok(item.main_thought);
      assert.equal(typeof item.confidence, 'number');
      assert.equal(typeof item.is_new, 'boolean');
    }

    const starts = payload.items.map((item) => item.starts_at);
    const sortedStarts = [...starts].sort((a, b) => new Date(a) - new Date(b));
    assert.deepEqual(starts, sortedStarts);
  } finally {
    await app.close();
  }
});
