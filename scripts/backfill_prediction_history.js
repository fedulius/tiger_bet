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
    else if (arg === '--limit') {
      const raw = argv[++i];
      args.limit = Number(raw);
      if (!Number.isInteger(args.limit) || args.limit <= 0) {
        throw new Error(`Invalid --limit: ${raw}`);
      }
    } else if (arg === '--match-analysis-id') {
      const raw = argv[++i];
      args.matchAnalysisId = Number(raw);
      if (!Number.isInteger(args.matchAnalysisId) || args.matchAnalysisId <= 0) {
        throw new Error(`Invalid --match-analysis-id: ${raw}`);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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
