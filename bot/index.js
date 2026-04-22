const lib = require('./lib');
const messageList = require('./helper/messageList');

module.exports = {
  sendTextMessage: (chatId, messageText) => {
    lib.bot.sendMessage(chatId, messageText);
  },
  run: (db) => {
    const webAppUrl = process.env.WEBAPP_URL;
    if (webAppUrl && /^https:\/\//i.test(webAppUrl)) {
      lib.bot.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Tiger Bet WebApp',
          web_app: { url: webAppUrl },
        },
      }).catch((error) => {
        console.log('setChatMenuButton error:', error?.message || error);
      });
    }

    lib.bot.onText(/\/start/, message => {
      console.log(message);
      let data = 'begin_greet';
      message.message_id = 0;
      lib.mainRouter(db).performCommandByData({message, data});
    });

    lib.bot.on('callback_query', query => {
      let message = query.message;
      let data = query.data;

      lib.mainRouter(db).performCommandByData({message, data});
    });

    lib.bot.on('message', message => {
      let data = messageList[message.text];

      if (data) {
        let previousMessageId = message.message_id - 1;
        message.message_id = 0;
        lib.bot.deleteMessage(message.chat.id, previousMessageId);
        lib.mainRouter(db).performCommandByData({message, data});
        return;
      }

      if (message.successful_payment) {
        lib.payment(db).providePayment(message);
        let data = `begin_greet_${false}`;
        lib.mainRouter(db).performCommandByData({message, data});
      }

      if (message.text !== '/start') {
        return;
      }
    });

    // lib.bot.on('pre_checkout_query', answ => {
    //   lib.bot.answerPreCheckoutQuery(answ.id, true);
    // });
  },

}