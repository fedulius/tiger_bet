module.exports = {
  userRegistry: (userId) => new (require('./UserRegistry'))(userId),
  keyboard: new (require('./KeyboardMaker'))(),
  bot: new (require('./Telegram'))(),
  callbackStore: new (require('./CallbackStore'))(),
  forecastProvider: new (require('../../lib/stavkaForecast'))(),
  mainRouter: (pg) => new (require('./MainRouter'))(pg)
};
