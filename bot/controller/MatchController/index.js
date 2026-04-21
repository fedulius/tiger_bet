const Controller = require('../Controller');
const {getLeaguesByCategory} = require('../../../lib/stavkaMatches');

class MatchController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    this.pg = pg;
    this.callbackStore = lib.callbackStore;
  }

  async leagueAction(msg, token) {
    try {
      // Достаём контекст выбранной лиги из временного callback-store.
      const leaguePayload = this.callbackStore.get(token);

      if (!leaguePayload || leaguePayload.type !== 'league') {
        this.sendBotMessage(msg, 'Сессия выбора лиги устарела. Начните заново: /start');
        return;
      }

      // Повторно получаем список лиг, чтобы выдать актуальный список матчей.
      const leagues = await getLeaguesByCategory(leaguePayload.categoryId);
      const league = leagues[leaguePayload.leagueIndex];

      if (!league || !league.matches || !league.matches.length) {
        this.sendBotMessage(msg, 'В выбранной лиге пока нет доступных матчей.');
        return;
      }

      // Формируем кнопки матчей. На каждый матч — отдельный короткий token.
      const matchesInline = league.matches.map(match => {
        const matchToken = this.callbackStore.put({
          type: 'match',
          categoryId: leaguePayload.categoryId,
          leagueName: league.league,
          team: match.team,
          url: match.link,
          // Нужен для кнопки "Назад" с экрана прогноза на экран матчей.
          leagueToken: token,
        });

        return [match.team, `match_forecast_${matchToken}`];
      });

      // Кнопка "Назад" с экрана матчей возвращает на экран лиг.
      matchesInline.push(['⬅️ Назад', `league_category_${leaguePayload.categoryId}`]);

      const inline = this.km.generateKeyboard(matchesInline, 1);
      this.sendAndDeleteBotMessage(msg, `Лига: ${league.league}\nВыберите матч.`, inline, false);
    } catch (error) {
      console.log(error);
      this.sendBotMessage(msg, 'Не удалось получить список матчей.');
    }
  }

  async forecastAction(msg, token) {
    // Получаем контекст выбранного матча.
    const matchPayload = this.callbackStore.get(token);

    if (!matchPayload || matchPayload.type !== 'match') {
      this.sendBotMessage(msg, 'Сессия выбора матча устарела. Начните заново: /start');
      return;
    }

    const response = [
      `Матч: ${matchPayload.team}`,
      `Лига: ${matchPayload.leagueName}`,
      '',
      'Прогноз (MVP):',
      'Скоро здесь будет расчет вероятностей по сигналам матча.',
      `Источник: https://stavka.tv${matchPayload.url}`,
    ].join('\n');

    // Кнопка "Назад" с экрана прогноза возвращает на список матчей текущей лиги.
    const inline = this.km.generateKeyboard([
      ['⬅️ Назад', `match_league_${matchPayload.leagueToken}`],
    ], 1);

    this.sendAndDeleteBotMessage(msg, response, inline, false);
  }
}

module.exports = MatchController;
