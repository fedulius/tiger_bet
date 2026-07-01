const Controller = require('../Controller');
const {getLeaguesByCategory} = require('../../../lib/stavkaMatches');

function normalizeExplanationLines(analysis) {
  const prepared = Array.isArray(analysis.explanationLines)
    ? analysis.explanationLines.map(function (r) { return String(r || '').trim(); }).filter(Boolean)
    : [];
  var defaults = analysis.source === 'no-signal'
    ? ['Недостаточно сигналов на странице матча.', 'Коэффициенты могут быть недоступны.', 'Перепроверьте матч ближе к старту.', 'Выберите другой матч.']
    : ['Главная мысль: ' + (analysis.mainThought || analysis.bestOutcome || 'н/д') + '.', 'Вероятность: ' + (Number.isFinite(analysis.probabilityPercent) ? analysis.probabilityPercent : 0) + '%.', 'Уверенность: ' + (analysis.confidence || 'низкая') + '.', 'Источник: ' + (analysis.source || 'unknown') + '.'];
  var lines = prepared.length > 0 ? prepared : defaults;
  while (lines.length < 4) lines.push(defaults[lines.length] || defaults[defaults.length - 1]);
  return lines.slice(0, 6);
}

function buildBriefForecastText(payload, analysis) {
  var link = payload.url ? 'https://stavka.tv' + payload.url : '—';
  var explanationLines = normalizeExplanationLines(analysis);
  if (analysis.source === 'no-signal') {
    return ['Матч: ' + payload.team, 'Лига: ' + payload.leagueName, '', 'Недостаточно сигналов.', 'Источник: ' + link].join('\n');
  }
  return ['Матч: ' + payload.team, 'Лига: ' + payload.leagueName, '', 'Анализ: ' + (analysis.mainThought || analysis.bestOutcome || 'н/д') + ' (' + (analysis.probabilityPercent || 0) + '%).', 'Уверенность: ' + (analysis.confidence || 'низкая') + '.', 'Источник: ' + link].join('\n');
}

class MatchController extends Controller {

  constructor({pg, lib}) {
    super(lib);
    this.pg = pg;
    this.callbackStore = lib.callbackStore;
    this.forecastProvider = lib.forecastProvider;
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

      // Показываем экран матчей + унифицированная кнопка "Назад" на экран лиг.
      this.sendScreenWithBack(
        msg,
        `Лига: ${league.league}\nВыберите матч.`,
        matchesInline,
        `league_category_${leaguePayload.categoryId}`,
        false,
        1
      );
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

    let analysis;

    try {
      analysis = await this.forecastProvider.getMatchForecast({
        team: matchPayload.team,
        url: matchPayload.url,
      });
    } catch (error) {
      console.log(error);
      analysis = {
        source: 'no-signal',
      };
    }

    const response = buildBriefForecastText(matchPayload, analysis);

    // Показываем экран прогноза + унифицированная кнопка "Назад" на список матчей.
    this.sendScreenWithBack(
      msg,
      response,
      [],
      `match_league_${matchPayload.leagueToken}`,
      false,
      1
    );
  }
}

module.exports = MatchController;
