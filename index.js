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
const WEBAPP_PUBLIC_DIR = path.join(__dirname, 'webapp', 'public');

const shouldRunHttp = process.env.RUN_HTTP !== '0';
const shouldRunScheduler = process.env.RUN_SCHEDULER !== '0';
const shouldRunBot = process.env.RUN_BOT !== '0';

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

function sendWebappFile(reply, fileName, contentType) {
  const targetPath = path.normalize(path.join(WEBAPP_PUBLIC_DIR, fileName));

  if (!targetPath.startsWith(WEBAPP_PUBLIC_DIR)) {
    return reply.status(400).send('Bad Request');
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf-8');
    return reply.type(contentType).send(content);
  } catch {
    return reply.status(404).send('Not Found');
  }
}

fastify.get('/webapp', async (request, reply) => sendWebappFile(reply, 'index.html', 'text/html; charset=utf-8'));
fastify.get('/webapp/', async (request, reply) => sendWebappFile(reply, 'index.html', 'text/html; charset=utf-8'));
fastify.get('/webapp/styles.css', async (request, reply) => sendWebappFile(reply, 'styles.css', 'text/css; charset=utf-8'));
fastify.get('/webapp/app.js', async (request, reply) => sendWebappFile(reply, 'app.js', 'application/javascript; charset=utf-8'));

// fastify.register(require('fastify-autoload'), {
//   dir: path.join(__dirname, 'routes')
// });

// fastify.listen(PORT, DOMAIN);
if (shouldRunScheduler) {
  scheduler.matches(pg).main();
}

if (shouldRunBot) {
  bot.run(pg);
}

if (shouldRunHttp) {
  fastify.listen({
    port: Number(process.env.PORT || PORT),
    host: process.env.DOMAIN || DOMAIN,
  });
}

module.exports = { fastify };
