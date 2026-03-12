const ControllerRegister = require('./ControllerRegister');
const UserRegistry = new (require('./UserRegistry'))();

class MainRouter {
  static instance = null;
  
  constructor(pg) {
    this.pg = pg;
    this.ur = UserRegistry;

    if (MainRouter.instance) {
      return MainRouter.instance;
    }
    MainRouter.instance = this;
  }
  
  performCommandByData({message, data}) {
    const dataCommand = data.toLowerCase();
    if (dataCommand === 'empty') {
      return;
    }
    const dataSplit = dataCommand.split('_');

    this.#callController(dataSplit, message);
  }
  
  #callController(dataSplit, message) {
    if (dataSplit.length < 2) {
      throw 'data command is too short - use _ to split command data';
    }

    const controllerName = dataSplit.shift();
    const actionName = dataSplit.shift();
    
    dataSplit.unshift(message);
    
    this.logger(message, controllerName, actionName);

    new ControllerRegister(this.pg).getController(controllerName).getAction(actionName, dataSplit);
  }

  logger(message, controllerName, actionName) {
    if (message.chat.id === 337412226) {
      this.ur.getUser(message.chat.id).cancelLogger();
    }

    if (!this.ur.getUser(message.chat.id).getLoggerStatus()) {
      return;
    }
    
    this.pg.connection(`
      SELECT *
      FROM public.user_logger($1, $2, $3, $4, $5, $6::jsonb)
    `, [
      message.chat.id,
      message.chat.first_name,
      message.chat.username,
      controllerName,
      actionName,
      message
    ]);
  }
}

module.exports = MainRouter;