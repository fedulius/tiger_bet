const bot = require('./bot');
const scheduler = require('./scheduler');
const pg = require('./DataBase').postgres;
const { buildApp } = require('./server/app');
const { getHttpsOptions, getListenConfig } = require('./server/runtimeConfig');

const shouldRunHttp = process.env.RUN_HTTP !== '0';
const shouldRunScheduler = process.env.RUN_SCHEDULER !== '0';
const shouldRunBot = process.env.RUN_BOT !== '0';

const httpsOptions = getHttpsOptions();
const listenConfig = getListenConfig();

const fastify = buildApp({ pg, bot, httpsOptions });

if (shouldRunScheduler) {
  scheduler.matches(pg).main();
}

if (shouldRunBot) {
  bot.run(pg);
}

if (shouldRunHttp) {
  fastify.listen(listenConfig);
}

module.exports = { fastify };
