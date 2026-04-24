const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const plugin = require('fastify-plugin');

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

function resolveSafePath(baseDir, fileName) {
  const targetPath = path.normalize(path.join(baseDir, fileName));
  if (!targetPath.startsWith(baseDir)) {
    return null;
  }
  return targetPath;
}

function sendFileFromBase(reply, baseDir, fileName) {
  const targetPath = resolveSafePath(baseDir, fileName);
  if (!targetPath) {
    return reply.status(400).send('Bad Request');
  }

  try {
    const content = fs.readFileSync(targetPath);
    return reply.type(resolveContentType(targetPath)).send(content);
  } catch {
    return reply.status(404).send('Not Found');
  }
}

function buildMissingDistMessage(distDir) {
  return JSON.stringify({
    error: 'React build not found',
    message: `Expected ${distDir}/index.html. Run: cd webapp-react && npm install && npm run build`,
  });
}

function buildApp({
  pg,
  bot,
  httpsOptions = null,
  reactDistDir = path.join(__dirname, '..', 'webapp-react', 'dist'),
} = {}) {
  const fastify = new Fastify({
    logger: true,
    ...(httpsOptions ? { https: httpsOptions } : {}),
  });

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

  fastify.register(require('@fastify/autoload'), {
    dir: path.join(__dirname, '..', 'webapp', 'routes'),
    dirNameRoutePrefix: false,
  });

  function isReactDistReady() {
    return fs.existsSync(path.join(reactDistDir, 'index.html'));
  }

  function sendReactIndex(reply) {
    if (!isReactDistReady()) {
      return reply
        .status(503)
        .type('application/json; charset=utf-8')
        .send(buildMissingDistMessage(reactDistDir));
    }

    return sendFileFromBase(reply, reactDistDir, 'index.html');
  }

  fastify.get('/health', async () => ({ ok: true }));
  fastify.get('/webapp', async (request, reply) => sendReactIndex(reply));
  fastify.get('/webapp/', async (request, reply) => sendReactIndex(reply));
  fastify.get('/webapp/match.html', async (request, reply) => sendReactIndex(reply));

  fastify.get('/webapp/*', async (request, reply) => {
    if (!isReactDistReady()) {
      return reply
        .status(503)
        .type('application/json; charset=utf-8')
        .send(buildMissingDistMessage(reactDistDir));
    }

    const rawPath = String(request.params['*'] || '').replace(/^\/+/, '');

    if (!rawPath) {
      return sendFileFromBase(reply, reactDistDir, 'index.html');
    }

    const targetPath = resolveSafePath(reactDistDir, rawPath);
    if (targetPath && fs.existsSync(targetPath)) {
      return sendFileFromBase(reply, reactDistDir, rawPath);
    }

    if (!path.extname(rawPath)) {
      return sendFileFromBase(reply, reactDistDir, 'index.html');
    }

    return reply.status(404).send('Not Found');
  });

  return fastify;
}

module.exports = {
  buildApp,
};
