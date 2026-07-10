const Controller = require('../Controller');
const DAL = require('./DAL');
const { getWebAppUrl } = require('../../../server/runtimeConfig');

class BeginController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    this.dal = new DAL({pg});
  }

  async greetAction(msg) {
    await this.userCheck(msg);

    const webAppUrl = getWebAppUrl(process.env);
    const inline = [[
      {
        text: 'Показать web-app',
        web_app: { url: webAppUrl },
      },
    ]];

    this.sendAndDeleteBotMessage(msg, 'Откройте приложение в WebApp.', inline)
  }

  async userCheck(msg) {
    const obj = msg.from;
    return await this.dal.getUser(obj.id, obj.username, obj.first_name, obj.language_code)
      .then(res => {
      return res[0].user_sync;
      }).catch(err => {
        console.error(`Ошибка при проверке пользователя: ${err}`)
      });
  }

}

module.exports = BeginController;
