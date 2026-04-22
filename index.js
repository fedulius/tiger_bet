const bot = require('./bot');
const scheduler = require('./scheduler');
const pg = require('./DataBase').postgres;
const { buildApp } = require('./server/app');

const PORT = 8084;
const DOMAIN = '178.236.244.53';

const shouldRunHttp = process.env.RUN_HTTP !== '0';
const shouldRunScheduler = process.env.RUN_SCHEDULER !== '0';
const shouldRunBot = process.env.RUN_BOT !== '0';

const fastify = buildApp({ pg, bot });

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
