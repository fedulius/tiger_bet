const Controller = require('../Controller');
const request = require('request');
const endpoint = require('./categoryEndpoint');
const cheerio = require('cheerio');


class PredictController extends Controller {

  constructor({pg, lib}) {
    super(lib);
  }

  async categoryAction(msg, categoryId) {
    try {
      const html = await this.#requestPrediction(categoryId);
      const leagues = this.#leagueParser(html);
      const text = leagues.length ? leagues.join('\n') : 'Матчи не найдены.';

      this.sendBotMessage(msg, text);
    } catch (error) {
      console.log(error);
      this.sendBotMessage(msg, 'Не удалось получить прогнозы.');
    }
  }

  #leagueParser(html) {
    const $ = cheerio.load(html);

    const leagues = [];

    $("section.MatchesTable.MatchesTable--football").each((i, el) => {
      const country = $(el).find('.title-country').text().trim();
      const league = $(el).find('.title-link').text().trim();
      const link = $(el).find(".title-link");

      leagues.push({
        league: `${country}: ${league}`,
        url: link.attr("href")
      });
    });

    return leagues;
  }

  #requestPrediction(categoryId) {
    return new Promise((resolve, reject) => {
      const categoryEndpoint = endpoint[categoryId];
      if (!categoryEndpoint) {
        reject(new Error(`Unknown categoryId: ${categoryId}`));
        return;
      }

      request.get({
        headers: {'content-type': 'text/html;charset=utf-8'},
        url: `https://stavka.tv/matches/${categoryEndpoint}`,
      }, function(error, response, body) {
        if (error) {
          reject(error);
          return;
        }

        resolve(body);
      });
    });
  }

}

module.exports = PredictController;
