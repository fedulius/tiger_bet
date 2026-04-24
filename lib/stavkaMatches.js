const request = require('request');
const cheerio = require('cheerio');
const endpoint = require('./categoryEndpoint');

function requestCategoryPage(categoryId) {
  return new Promise((resolve, reject) => {
    const categoryEndpoint = endpoint[categoryId];

    if (!categoryEndpoint) {
      reject(new Error(`Unknown categoryId: ${categoryId}`));
      return;
    }

    request.get({
      headers: {'content-type': 'text/html;charset=utf-8'},
      url: `https://stavka.tv/matches/${categoryEndpoint}`,
    }, (error, response, body) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(body);
    });
  });
}

function parseLeaguesAndMatches(html) {
  const $ = cheerio.load(html);
  const leagues = [];

  $('section.MatchesTable').each((i, el) => {
    const country = $(el).find('.title-country').first().text().trim();
    const league = $(el).find('.title-link').first().text().trim();
    const link = $(el).find('.title-link').first();

    const matches = [];

    $(el).find('.match-row').each((j, match) => {
      const $match = $(match);

      const statusEl = $match.find('.event-status').first();
      const dateEl = $match.find('.event-date').first();
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

      const teamNames = $match
        .find('.team-name')
        .map((k, el1) => $(el1).text().trim())
        .get();

      const href = $match.find('a.match-link').attr('href');

      if (teamNames.length >= 2 && href) {
        matches.push({
          team: `${teamNames[0]} - ${teamNames[1]}`,
          link: href,
          time: statusEl.text().trim(),
          date: dateEl.text().trim(),
        });
      }
    });

    if (!league || matches.length === 0) {
      return;
    }

    leagues.push({
      league: country ? `${country}: ${league}` : league,
      url: link.attr('href') || '',
      matches,
    });
  });

  return leagues;
}

async function getLeaguesByCategory(categoryId) {
  const html = await requestCategoryPage(categoryId);
  return parseLeaguesAndMatches(html);
}

module.exports = {
  getLeaguesByCategory,
};
