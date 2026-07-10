'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BeginController = require('../bot/controller/BeginController');

function makeMessage() {
  return {
    chat: { id: 42 },
    message_id: 7,
    from: {
      id: 337412226,
      username: 'tester',
      first_name: 'Tester',
      language_code: 'ru',
    },
  };
}

test('begin greet shows only WebApp button and no sport category buttons', async () => {
  const sqlCalls = [];
  const sent = [];
  const deleted = [];
  const controller = new BeginController({
    pg: {
      connection: async (sql, params) => {
        sqlCalls.push({ sql, params });
        if (/public\.sport/i.test(sql)) {
          throw new Error('sport categories should not be loaded for bot start screen');
        }
        return [{ user_sync: 1 }];
      },
    },
    lib: {
      bot: {
        sendMessage(chatId, text, options) {
          sent.push({ chatId, text, options });
        },
        deleteMessage(chatId, messageId) {
          deleted.push({ chatId, messageId });
        },
      },
      keyboard: {
        generateKeyboard() {
          throw new Error('sport keyboard should not be generated for bot start screen');
        },
      },
    },
  });

  const originalWebAppUrl = process.env.WEBAPP_URL;
  process.env.WEBAPP_URL = 'https://example.test/webapp';
  try {
    await controller.greetAction(makeMessage());
  } finally {
    if (originalWebAppUrl === undefined) delete process.env.WEBAPP_URL;
    else process.env.WEBAPP_URL = originalWebAppUrl;
  }

  assert.equal(sqlCalls.length, 1);
  assert.match(sqlCalls[0].sql, /public\.user_sync/);
  assert.deepEqual(deleted, [{ chatId: 42, messageId: 7 }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Откройте приложение в WebApp.');
  assert.deepEqual(sent[0].options.reply_markup.inline_keyboard, [[{
    text: 'Показать web-app',
    web_app: { url: 'https://example.test/webapp' },
  }]]);
});
