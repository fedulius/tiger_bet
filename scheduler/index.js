module.exports = {
  matches: (pg) => new (require('./Matches'))(pg),
  dailyPicks: (pg) => new (require('./DailyPicks'))(pg),
  aiRecommendationBriefs: (pg) => new (require('./AiRecommendationBriefs'))(pg),
};
