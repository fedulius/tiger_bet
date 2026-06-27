'use strict';

const aiBriefBatchService = require('../webapp/services/aiBriefBatchService');
const stavkaApi = require('../lib/stavkaApi');

class AiRecommendationBriefs {
  constructor(pg) {
    this.pg = pg;
  }

  async runOnce(options = {}) {
    const matches = await stavkaApi.fetchAllMatches();
    return aiBriefBatchService.runAiBriefBatch({
      pg: this.pg,
      matches: matches || [],
      popularBetsLoader: stavkaApi.fetchPopularBets,
      matchDetailLoader: stavkaApi.fetchMatchDetail,
      riskBetsSelector: stavkaApi.selectRiskBets,
      ...options,
    });
  }
}

module.exports = AiRecommendationBriefs;
