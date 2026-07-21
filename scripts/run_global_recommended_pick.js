#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const pg = require('../DataBase').postgres;
const { runGlobalRecommendedPick } = require('../webapp/services/globalRecommendedPickService');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    force: args.has('--force'),
    help: args.has('--help') || args.has('-h'),
  };
}

function printHelp() {
  console.log('Usage: node scripts/run_global_recommended_pick.js [--dry-run] [--force]');
}

function compactResult(result) {
  const selected = result?.selected;
  return {
    ...result,
    selected: selected ? {
      match: `${selected.match?.teams?.home?.name || selected.match?.home_team || selected.match?.sstats_data?.home?.name || ''} — ${selected.match?.teams?.away?.name || selected.match?.away_team || selected.match?.sstats_data?.away?.name || ''}`,
      league: selected.match?.league?.name || selected.match?.league_label || selected.match?.sstats_data?.league || '',
      starts_at: selected.match?.matchDate || selected.match?.starts_at || selected.match?.sstats_data?.date || null,
      sstats_match_id: selected.match?.sstats_match_id || null,
      bet: selected.selectedBet?.label,
      market: selected.selectedBet?.market,
      odds: selected.selectedBet?.odds_decimal,
      risk: selected.selectedBet?.risk,
      quality: selected.quality,
      warnings: selected.warnings,
    } : null,
  };
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const result = await runGlobalRecommendedPick({ pg, dryRun: args.dryRun, force: args.force });
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    dry_run: args.dryRun,
    ...compactResult(result),
  }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(JSON.stringify({
    error: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  }, null, 2));
  process.exit(1);
});
