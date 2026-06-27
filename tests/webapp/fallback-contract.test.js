const test = require('node:test');
const assert = require('node:assert/strict');

const { getRecommendations } = require('../../webapp/services/recommendationService');
const { getHistory } = require('../../webapp/services/historyService');

test('getRecommendations returns empty payload when source items are empty', async () => {
  const payload = await getRecommendations({
    source: 'favorites',
    items: [],
  });

  assert.equal(payload.source, 'favorites');
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length, 0);
});

test('history service returns default empty-state message and CTA when sample is disabled', () => {
  const payload = getHistory({ sample: false });

  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length, 0);
  assert.equal(payload.empty_state?.message, 'Здесь появятся ваши последние прогнозы');
  assert.equal(payload.empty_state?.cta?.label, 'Открыть рекомендации');
  assert.equal(payload.empty_state?.cta?.target, '#recommendations');
});
