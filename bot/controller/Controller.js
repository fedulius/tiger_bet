const fs = require("fs");

class Controller {

  constructor({bot, keyboard}) {
    this.bot = bot;
    this.km = keyboard;
  }

  getAction(actionName, actionArgs = []) {
    console.log('actionName')
    actionName = actionName.toLowerCase();
    const methodName = `${actionName}Action`;

    if (!this[methodName]) {
      throw `there is no such action method as: ${methodName}`;
    }

    this[methodName].apply(this, actionArgs);
  }

  sendBotMessage(msg, text, style = false) {
    if (style) {
      this.bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML'
      });
    } else {
      this.bot.sendMessage(msg.chat.id, text);
    }
  }

  sendAndDeleteBotMessage(msg, text, inline, remove = true) {

    if (remove && msg.message_id !== 0) {
      this.#deletePreviousMessage(msg.chat.id, msg.message_id);
    }
    this.#sendBotMessageWithReply(msg.chat.id, text, inline);
  }

  async sendPhoto(msg, fileStream, text, inline) {
    this.#deletePreviousMessage(msg.chat.id, msg.message_id);

    await this.bot.sendPhoto(msg.chat.id, fileStream, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: inline
      }
    });
  }

  #sendBotMessageWithReply(chatId, text, inline) {
    this.bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: inline
      }
    });
  }

  #deletePreviousMessage(chatId, messageId) {
    if (messageId) {
      try {
        this.bot.deleteMessage(chatId, messageId);
      } catch (e) {
        console.log(`Cant find message to delete chat id: ${chatId} message id: ${messageId}`);
      }
    }
  }

  deleteMessages(chatId, messageArray) {
    if (!messageArray) {
      return;
    }

    for (let i = 0; i < messageArray.length; i++) {
      this.#deletePreviousMessage(chatId, messageArray[i]);
    }
  }
}

module.exports = Controller;