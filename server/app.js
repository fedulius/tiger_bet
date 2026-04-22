const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const plugin = require('fastify-plugin');

function buildApp({ pg, bot } = {}) {
  const fastify = new Fastify({ logger: true });
  const webappPublicDir = path.join(__dirname, '..', 'webapp', 'public');

  fastify.register(require('@fastify/cors'), {
    origin: true,
  });

  fastify.register(plugin((fn, opts, done) => {
    fastify.decorate('bot', {
      bot,
      sendBotMessage: (chatId, messageText) => {
        if (bot && typeof bot.sendTextMessage === 'function') {
          bot.sendTextMessage(chatId, messageText);
        }
      },
    });
    done();
  }));

  fastify.register(plugin((fn, opts, done) => {
    fastify.decorate('pg', { pg });
    done();
  }));

  function sendWebappFile(reply, fileName, contentType) {
    const targetPath = path.normalize(path.join(webappPublicDir, fileName));

    if (!targetPath.startsWith(webappPublicDir)) {
      return reply.status(400).send('Bad Request');
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf-8');
      return reply.type(contentType).send(content);
    } catch {
      return reply.status(404).send('Not Found');
    }
  }

  fastify.get('/health', async () => ({ ok: true }));
  fastify.get('/webapp', async (request, reply) => sendWebappFile(reply, 'index.html', 'text/html; charset=utf-8'));
  fastify.get('/webapp/', async (request, reply) => sendWebappFile(reply, 'index.html', 'text/html; charset=utf-8'));
  fastify.get('/webapp/styles.css', async (request, reply) => sendWebappFile(reply, 'styles.css', 'text/css; charset=utf-8'));
  fastify.get('/webapp/app.js', async (request, reply) => sendWebappFile(reply, 'app.js', 'application/javascript; charset=utf-8'));

  return fastify;
}

module.exports = {
  buildApp,
};
