const Controller = require('../Controller');
const {getLeaguesByCategory} = require('../../../lib/stavkaMatches');

class LeagueController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    this.pg = pg;
    this.callbackStore = lib.callbackStore;
  }

  async categoryAction(msg, categoryId) {
    try {
      const leagues = await getLeaguesByCategory(categoryId);

      if (!leagues.length) {
        this.sendBotMessage(msg, 'По этой категории лиги не найдены.');
        return;
      }

      const leagueInline = leagues.map((league, index) => {
        const token = this.callbackStore.put({
          type: 'league',
          categoryId: Number(categoryId),
          leagueIndex: index,
          leagueName: league.league,
        });

        return [league.league, `match_league_${token}`];
      });

      const inline = this.km.generateKeyboard(leagueInline, 1);

      this.sendAndDeleteBotMessage(msg, 'Выберите лигу.', inline, false);
    } catch (error) {
      console.log(error);
      this.sendBotMessage(msg, 'Не удалось получить список лиг.');
    }
  }
}

module.exports = LeagueController;
