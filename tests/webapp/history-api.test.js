const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../../server/app');

test('GET /history returns empty-state payload', async () => {
  const app = buildApp({ pg: null, bot: null });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/history',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 0);
    assert.equal(payload.empty_state?.message, 'Здесь появятся ваши последние прогнозы');
    assert.equal(payload.empty_state?.cta?.label, 'Открыть рекомендации');
    assert.equal(payload.empty_state?.cta?.target, '#recommendations');
  } finally {
    await app.close();
  }
});

test('GET /history item shape uses format A fields', async () => {
  const app = buildApp({
    pg: null,
    bot: null,
  });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/history?sample=1',
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(Array.isArray(payload.items), true);
    assert.ok(payload.items.length >= 1);

    const item = payload.items[0];
    assert.ok(item.id);
    assert.ok(item.match);
    assert.ok(item.league);
    assert.ok(item.starts_at);
    assert.ok(item.main_thought);
    assert.equal(typeof item.confidence, 'number');
  } finally {
    await app.close();
  }
});
