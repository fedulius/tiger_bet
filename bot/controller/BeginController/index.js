const Controller = require('../Controller');

class BeginController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    // this.text = new Text({pg});
  }
  
  greetAction(msg) {
    console.log('sultan')

    this.sendBotMessage(msg, `Привет!
Я твой проводник в мир здоровой и быстрой еды  "По рецепту". Здесь ты сможешь  выбрать и заказать вкусные, полезные и питательные блюда, горячие и прохладные напитки.
Добро пожаловать и приятного аппетита!
«По рецепту» - готовим, то в чем уверены.`);
  }
}

module.exports = BeginController;