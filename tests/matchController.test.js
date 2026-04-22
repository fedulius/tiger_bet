const test = require('node:test');
const assert = require('node:assert/strict');

const MatchController = require('../bot/controller/MatchController');

function buildController({ matchPayload }) {
  const sent = { text: null, backCallback: null };

  const controller = new MatchController({
    pg: {},
    lib: {
      bot: {},
      keyboard: { generateKeyboard: () => [] },
      callbackStore: {
        get: () => matchPayload,
      },
      forecastProvider: {
        getMatchForecast: async () => ({
          bestOutcome: 'П1',
          probabilityPercent: 57,
          confidence: 'средняя',
          source: 'percent-signals',
        }),
      },
    },
  });

  controller.sendScreenWithBack = (msg, text, items, backCallback) => {
    sent.text = text;
    sent.backCallback = backCallback;
  };

  controller.sendBotMessage = () => {};

  return { controller, sent };
}

test('forecastAction sends short analysis when match is selected', async () => {
  const { controller, sent } = buildController({
    matchPayload: {
      type: 'match',
      team: 'Team A - Team B',
      leagueName: 'Test League',
      url: '/match-url',
      leagueToken: 'abc123',
    },
  });

  await controller.forecastAction({ chat: { id: 1 } }, 'token');

  assert.match(sent.text, /Краткий анализ:/);
  assert.match(sent.text, /57%/);
  assert.equal(sent.backCallback, 'match_league_abc123');
});
