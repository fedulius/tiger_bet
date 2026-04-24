const request = require('request');
const endpoint = require('../lib/categoryEndpoint');
const cheerio = require('cheerio');

class Matches {

  constructor(pg) {
    this.pg = pg;
  }

  async main() {
    const categoriesList = await this.#getSportCategories();

    for (const category of categoriesList) {
      const html = await this.#requestPrediction(category.prediction_category_id);
      console.log(this.#leagueParser(html));
    }


  }

  #leagueParser(html) {
    const $ = cheerio.load(html);

    const leagues = [];

    $("section.MatchesTable.MatchesTable--football").each((i, el) => {
      const country = $(el).find('.title-country').text().trim();
      const league = $(el).find('.title-link').text().trim();
      const link = $(el).find('.title-link');

      const teams = [];

      $(el).find('.match-row').each((j, match) => {
        const $match = $(match);

        const statusEl = $match.find('.event-status').first();
        const statusText = statusEl.text().trim().toLowerCase();
        const statusClass = statusEl.attr('class') || '';

        const isPast =
          statusClass.includes('event-status--past') ||
          statusText.includes('завершен') ||
          statusText.includes('завершён');

        const isCanceled =
          statusText.includes('отменен') ||
          statusText.includes('отменён');

        if (isPast || isCanceled) {
          return;
        }

        const teamNames = $(match)
          .find('.team-name')
          .map((i, el1) => $(el1).text().trim())
          .get();

        const href = $(match).find('a.match-link').attr('href');

        if (teamNames.length >= 2) {
          teams.push({
            team: `${teamNames[0]} - ${teamNames[1]}`,
            link: href
          });
        }
      });

      if (teams.length === 0) {
        return;
      }


      leagues.push({
        league: `${country}: ${league}`,
        team: teams,
        url: link.attr("href"),
      });
    });

    console.log(leagues);

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

  async #getSportCategories() {
    return await this.pg.connection(`
    SELECT *
    FROM public.prediction_category
    `)
  }

}

module.exports = Matches;