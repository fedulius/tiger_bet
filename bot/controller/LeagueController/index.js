const Controller = require('../Controller');


class LeagueController extends Controller {

  constructor({pg, lib}) {
    super(lib);
  }

  async categoryAction(msg, categoryId) {
    try {
      const html = await this.#requestPrediction(categoryId);
      const leagues = this.#leagueParser(html);

      const leagueInline = leagues.map(league => {
        let content = [];
        content.push(league.league, 'match_match');
        return content;
      });

      console.log(leagueInline)

      let inline = this.km.generateKeyboard(leagueInline);

      this.sendAndDeleteBotMessage(msg, 'Выберите лигу.', inline, false);
    } catch (error) {
      console.log(error);
      this.sendBotMessage(msg, 'Не удалось получить прогнозы.');
    }
  }


}

module.exports = LeagueController;
