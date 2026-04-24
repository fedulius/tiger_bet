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
}

module.exports = BeginController;