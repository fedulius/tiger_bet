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
      // Шаг 1: получаем актуальный список лиг по выбранной категории спорта.
      const leagues = await getLeaguesByCategory(categoryId);

      if (!leagues.length) {
        this.sendBotMessage(msg, 'По этой категории лиги не найдены.');
        return;
      }

      // Шаг 2: для каждой лиги создаем короткий callback token,
      // чтобы не превышать лимит callback_data в Telegram.
      const leagueInline = leagues.map((league, index) => {
        const token = this.callbackStore.put({
          type: 'league',
          categoryId: Number(categoryId),
          leagueIndex: index,
          leagueName: league.league,
        });

        return [league.league, `match_league_${token}`];
      });

      // Кнопка "Назад" со 2-го экрана возвращает на первый экран (категории).
      leagueInline.push(['⬅️ Назад', 'begin_greet']);

      const inline = this.km.generateKeyboard(leagueInline, 1);
      this.sendAndDeleteBotMessage(msg, 'Выберите лигу.', inline, false);
    } catch (error) {
      console.log(error);
      this.sendBotMessage(msg, 'Не удалось получить список лиг.');
    }
  }
}

module.exports = LeagueController;
