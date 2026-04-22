const test = require('node:test');
const assert = require('node:assert/strict');

process.env.RUN_HTTP = '0';
process.env.RUN_SCHEDULER = '0';
process.env.RUN_BOT = '0';

const { fastify } = require('../../index');

test('GET /webapp returns 200 and html', async () => {
  await fastify.ready();

  const response = await fastify.inject({
    method: 'GET',
    url: '/webapp',
  });

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type'] || ''), /text\/html/);
});

test.after(async () => {
  await fastify.close();
});
