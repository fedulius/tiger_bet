const request = require('request');
const { analyzeForecastFromHtml } = require('./forecastAnalyzer');

class StavkaForecast {
  async getMatchForecast({ team, url }) {
    const html = await this.#requestMatchPage(url);
    return analyzeForecastFromHtml(html, { matchName: team });
  }

  #requestMatchPage(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('Match url is required'));
        return;
      }

      request.get({
        headers: { 'content-type': 'text/html;charset=utf-8' },
        url: `https://stavka.tv${url}`,
      }, (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(body);
      });
    });
  }
}

module.exports = StavkaForecast;
