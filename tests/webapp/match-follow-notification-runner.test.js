'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramSender } = require('../../scripts/run_match_follow_notifications');

test('Telegram sender posts sendMessage through injected fetch', async () => {
  const calls = [];
  const sender = createTelegramSender({
    token: 'bot-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    },
  });

  const result = await sender({ chatId: '123', text: 'Привет' });

  assert.deepEqual(result, { message_id: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/botbot-token/sendMessage');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { chat_id: '123', text: 'Привет' });
});

test('Telegram sender surfaces Bot API errors without a second network call', async () => {
  let calls = 0;
  const sender = createTelegramSender({
    token: 'bot-token',
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden' }) };
    },
  });

  await assert.rejects(() => sender({ chatId: '123', text: 'hello' }), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /Forbidden/);
    return true;
  });
  assert.equal(calls, 1);
});
