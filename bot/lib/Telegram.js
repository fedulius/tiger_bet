const token = '8790235188:AAFZWXc5Ta-yj9AiA9Z0UCSRDnDvlf_7gjk';

class Telegram {

  static instance = null;

  constructor() {
    if (Telegram.instance) {
      return Telegram.instance;
    }
    return Telegram.instance = new (require('node-telegram-bot-api'))(token, {polling: true});
  }
}

module.exports = Telegram;