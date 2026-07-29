'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pg = require('../DataBase').postgres;
const { processFollowedMatches } = require('../webapp/services/matchFollowWorker');
const { sendPendingDeliveries } = require('../webapp/services/notificationDeliveryService');

function createTelegramSender({ token = process.env.TELEGRAM_BOT_TOKEN, fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  return async ({ chatId, text, webAppUrl = null }) => {
    const body = { chat_id: String(chatId), text: String(text ?? '') };
    if (webAppUrl) {
      body.reply_markup = {
        inline_keyboard: [[{ text: 'Перейти к матчу', web_app: { url: String(webAppUrl) } }]],
      };
    }
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.description || `Telegram API request failed with status ${response.status}`);
      error.status = response.status;
      error.response = response;
      throw error;
    }
    return payload.result;
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const deliveryOnly = process.argv.includes('--delivery-only');
  try {
    const follow = deliveryOnly
      ? { skipped: true, reason: 'delivery_only' }
      : await processFollowedMatches({ pg, dryRun });
    const delivery = dryRun
      ? { skipped: true, reason: 'dry_run' }
      : await sendPendingDeliveries({ pg, sender: createTelegramSender() });
    const summary = { follow, delivery };
    console.log(JSON.stringify(summary));
    return summary;
  } catch (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) main();

module.exports = main;
module.exports.createTelegramSender = createTelegramSender;
