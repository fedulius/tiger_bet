#!/usr/bin/env node
'use strict';

const pg = require('../DataBase').postgres;
const { backfillPredictionHistory } = require('../webapp/services/predictionHistoryBackfillService');

function parseArgs(argv) {
  const args = { dryRun: true, limit: 100, matchAnalysisId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--limit') args.limit = Number(argv[++i] || args.limit);
    else if (arg === '--match-analysis-id') args.matchAnalysisId = Number(argv[++i] || 0) || null;
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const result = await backfillPredictionHistory(pg, args);
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
