const Controller = require('../Controller');
const DAL = require('./DAL');
const InlineController = require('./inline');
const { getWebAppUrl } = require('../../../server/runtimeConfig');

class BeginController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    this.dal = new DAL({pg});
    this.inline = new InlineController();
  }
  
  async greetAction(msg) {
    let result = await this.userCheck(msg);

    let categoryList = await this.dal.getCategories();
    let content = this.inline.main(categoryList);
    let inline = this.km.generateKeyboard(content);

    const webAppUrl = getWebAppUrl(process.env);
    inline.push([
      {
        text: '🧩 Открыть WebApp',
        web_app: { url: webAppUrl },
      },
    ]);

    this.sendAndDeleteBotMessage(msg, `Выберите вид спорта или откройте WebApp.`, inline)
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