module.exports = {
  matches: (pg) => new (require('./Matches'))(pg),
  aiRecommendationBriefs: (pg) => new (require('./AiRecommendationBriefs'))(pg),
}