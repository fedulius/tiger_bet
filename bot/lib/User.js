class User {
  
  #meta = {
    userId: 0,
    logger: true,
    userChatId: 0,
    state: {
      controller: '',
      action: '',
      data: {}
    }
  }

  constructor(userChatId) {
    this.#meta.userChatId = userChatId;
  }
  
  cancelLogger() {
    this.#meta.logger = false;
  }
  
  getLoggerStatus() {
    return this.#meta.logger;
  }
}

module.exports = User;