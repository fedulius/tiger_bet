module.exports = {
  userRegistry: (userId) => new (require('./UserRegistry'))(userId),
  keyboard: new (require('./KeyboardMaker'))(),
  bot: new (require('./Telegram'))(),
  mainRouter: (pg) => new (require('./MainRouter'))(pg)
};
