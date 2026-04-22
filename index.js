const path = require('path');
const fs = require("fs");
const bot = require('./bot');
const scheduler = require('./scheduler');


const pg = require('./DataBase').postgres;

const fastify = new (require('fastify'))({
  logger: true/*,
  http2: true,
  https: {
    allowHTTP1: true,
    key: fs.readFileSync(path.join('../', 'ssl-cert-snakeoil.key')),
    cert: fs.readFileSync(path.join('../', 'ssl-cert-snakeoil.pem'))
  }*/
});
const plugin = require('fastify-plugin');

const PORT = 8084;
const DOMAIN = '178.236.244.53';

fastify.register(require('fastify-cors'), {
  origin: true
});

fastify.register(plugin((fn, opts, done) => {
  fastify.decorate('bot', {
    bot,
    sendBotMessage: (chatId, messageText) => {
      bot.sendTextMessage(chatId, messageText);
    }
  });
  done();
}));

fastify.register(plugin((fn, opts, done) => {
  fastify.decorate('pg', {
    pg
  });
  done();
}));

// fastify.register(require('fastify-autoload'), {
//   dir: path.join(__dirname, 'routes')
// });

// fastify.listen(PORT, DOMAIN);
scheduler.matches(pg).main();
bot.run(pg);
