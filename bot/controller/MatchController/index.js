const Controller = require('../Controller');

class MatchController extends Controller {

  constructor({pg, lib}) {
    super(lib);

  }

  matchAction(msg) {
    this.sendBotMessage(msg, 'match');
  }
}

module.exports = MatchController;