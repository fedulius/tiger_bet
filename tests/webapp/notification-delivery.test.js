'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendPendingDeliveries, renderTemplate } = require('../../webapp/services/notificationDeliveryService');
const { createFakePg } = require('./testHelpers');

test('delivery send marks sent and records attempt', async () => {
  const pg = createFakePg({ handler: async (query) => {
    if (/UPDATE notification\.delivery d/i.test(query)) return [{ notification_delivery_id: 7, user_id: 2, notification_event_id: 9, recipient_address: '123', rendered_payload: { text: 'hello' }, attempt_count: 0, max_attempts: 5 }];
    return [];
  } });
  const result = await sendPendingDeliveries({ pg, sender: async ({ chatId, text }) => { assert.equal(chatId, '123'); assert.equal(text, 'hello'); return { message_id: 88 }; } });
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0, retry: 0 });
  assert.ok(pg.calls.some(({ query }) => /delivery_status='sent'/i.test(query)));
  assert.ok(pg.calls.some(({ query }) => /INSERT INTO notification\.delivery_attempt/i.test(query) && /'sent'/i.test(query)));
});

test('Telegram 403 marks delivery failed and cancels that follow', async () => {
  const pg = createFakePg({ handler: async (query) => {
    if (/UPDATE notification\.delivery d/i.test(query)) return [{ notification_delivery_id: 8, user_id: 3, notification_event_id: 10, recipient_address: '456', rendered_payload: { text: 'hello' }, attempt_count: 0, max_attempts: 5 }];
    return [];
  } });
  const error = Object.assign(new Error('blocked'), { status: 403 });
  const result = await sendPendingDeliveries({ pg, sender: async () => { throw error; } });
  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1, retry: 0 });
  assert.ok(pg.calls.some(({ query }) => /delivery_status=\$2/i.test(query)));
  assert.ok(pg.calls.some(({ query }) => /UPDATE public\.match_follow SET follow_status='cancelled'/i.test(query)));
  assert.ok(pg.calls.some(({ query }) => /notification\.delivery_attempt/i.test(query) && /\$3/.test(query)));
});

test('template renderer exposes text and HTML-ready fields', () => {
  const rendered = renderTemplate({ title_template: 'Title', body_template: 'Счёт: {{score}}\n{{match_title}}' }, { score: '1:0', match_title: 'A — B' });
  assert.deepEqual(rendered, { title: 'Title', text: 'Счёт: 1:0\nA — B', html: 'Счёт: 1:0<br>A — B' });
});

test('template renderer unescapes literal newline sequences and trims empty tail', () => {
  const rendered = renderTemplate(
    { title_template: '⚽ Матч начался', body_template: '⚽ Матч начался\\n\\n{{match_title}}\\n{{league_name}}\\n\\n' },
    { match_title: 'Испания — Бельгия', league_name: 'Футбол · Чемпионат мира' },
  );
  assert.deepEqual(rendered, {
    title: '⚽ Матч начался',
    text: '⚽ Матч начался\n\nИспания — Бельгия\nФутбол · Чемпионат мира',
    html: '⚽ Матч начался<br><br>Испания — Бельгия<br>Футбол · Чемпионат мира',
  });
});

test('all match follow telegram templates render complete clean text', () => {
  const fields = {
    match_title: 'Испания — Бельгия',
    league_name: 'Футбол · Чемпионат мира',
    score: '2:1',
    elapsed: "73'",
  };
  const templates = [
    { title_template: '⚽ Матч начался', body_template: '⚽ Матч начался\\n\\n{{match_title}}\\n{{league_name}}\\n\\n' },
    { title_template: '⚽ ГООООООЛ!!!', body_template: '⚽ Изменился счёт\\n\\n{{match_title}}\\n{{league_name}}\\n\\nСчёт: {{score}}\\n{{elapsed}}' },
    { title_template: '🏁 Матч завершён', body_template: '🏁 Матч завершён\\n\\n{{match_title}}\\n{{league_name}}\\n\\nИтоговый счёт: {{score}}' },
    { title_template: '⚠️ Матч отменён', body_template: '⚠️ Матч отменён или прерван\\n\\n{{match_title}}\\n{{league_name}}' },
  ];

  for (const template of templates) {
    const rendered = renderTemplate(template, fields);
    assert.ok(rendered.text.length > 0);
    assert.equal(rendered.text, rendered.text.trim());
    assert.doesNotMatch(rendered.text, /\\n/);
    assert.doesNotMatch(rendered.text, /{{/);
    assert.doesNotMatch(rendered.text, /\n{3,}/);
  }
});
