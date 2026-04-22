module.exports = {
  userRegistry: (userId) => new (require('./UserRegistry'))(userId),
  keyboard: new (require('./KeyboardMaker'))(),
  bot: new (require('./Telegram'))(),
  callbackStore: new (require('./CallbackStore'))(),
  forecastProvider: new (require('../../lib/aiForecastProvider'))(),
  mainRouter: (pg) => new (require('./MainRouter'))(pg)
};
