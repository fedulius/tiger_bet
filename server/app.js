const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const plugin = require('fastify-plugin');

const { registerRecommendationsRoutes } = require('../webapp/api/recommendations');
const { registerFavoritesRoutes } = require('../webapp/api/favorites');
const { registerHistoryRoutes } = require('../webapp/api/history');
const { registerMatchDetailsRoutes } = require('../webapp/api/matchDetails');

function resolveContentType(fileName = '') {
  if (fileName.endsWith('.html')) return 'text/html; charset=utf-8';
  if (fileName.endsWith('.css')) return 'text/css; charset=utf-8';
  if (fileName.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8';
  if (fileName.endsWith('.svg')) return 'image/svg+xml';
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.ico')) return 'image/x-icon';
  if (fileName.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function sendFileFromBase(reply, baseDir, fileName) {
  const targetPath = path.normalize(path.join(baseDir, fileName));

  if (!targetPath.startsWith(baseDir)) {
    return reply.status(400).send('Bad Request');
  }

  try {
    const content = fs.readFileSync(targetPath);
    return reply.type(resolveContentType(targetPath)).send(content);
  } catch {
    return reply.status(404).send('Not Found');
  }
}

function buildApp({
  pg,
  bot,
  httpsOptions = null,
  webappFrontendMode = 'legacy',
  reactDistDir = path.join(__dirname, '..', 'webapp-react', 'dist'),
} = {}) {
  const fastify = new Fastify({
    logger: true,
    ...(httpsOptions ? { https: httpsOptions } : {}),
  });

  const webappLegacyDir = path.join(__dirname, '..', 'webapp', 'public');
  const reactIndexPath = path.join(reactDistDir, 'index.html');
  const reactModeAvailable = webappFrontendMode === 'react' && fs.existsSync(reactIndexPath);

  if (webappFrontendMode === 'react' && !reactModeAvailable) {
    fastify.log.warn({ reactDistDir }, 'WEBAPP_FRONTEND_MODE=react requested, but dist/index.html missing. Falling back to legacy frontend.');
  }

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

  fastify.get('/health', async () => ({ ok: true }));

  if (reactModeAvailable) {
    fastify.get('/webapp', async (request, reply) => sendFileFromBase(reply, reactDistDir, 'index.html'));
    fastify.get('/webapp/', async (request, reply) => sendFileFromBase(reply, reactDistDir, 'index.html'));
    fastify.get('/webapp/match.html', async (request, reply) => sendFileFromBase(reply, reactDistDir, 'index.html'));
    fastify.get('/webapp/*', async (request, reply) => {
      const rawPath = String(request.params['*'] || '').replace(/^\/+/, '');

      if (!rawPath) {
        return sendFileFromBase(reply, reactDistDir, 'index.html');
      }

      const served = sendFileFromBase(reply, reactDistDir, rawPath);
      if (served.statusCode !== 404) {
        return served;
      }

      if (path.extname(rawPath)) {
        return served;
      }

      return sendFileFromBase(reply, reactDistDir, 'index.html');
    });
  } else {
    fastify.get('/webapp', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'index.html'));
    fastify.get('/webapp/', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'index.html'));
    fastify.get('/webapp/match', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'match.html'));
    fastify.get('/webapp/match.html', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'match.html'));
    fastify.get('/webapp/styles.css', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'styles.css'));
    fastify.get('/webapp/app.js', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'app.js'));
    fastify.get('/webapp/match.js', async (request, reply) => sendFileFromBase(reply, webappLegacyDir, 'match.js'));
  }

  registerRecommendationsRoutes(fastify);
  registerFavoritesRoutes(fastify);
  registerHistoryRoutes(fastify);
  registerMatchDetailsRoutes(fastify);

  return fastify;
}

module.exports = {
  buildApp,
};
