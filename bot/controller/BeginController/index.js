const Controller = require('../Controller');
const DAL = require('./DAL');
const InlineController = require('./inline');

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

    this.sendAndDeleteBotMessage(msg, `Выбери категорию.`, inline)
  }
}

module.exports = BeginController;