'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pg = require('../DataBase').postgres;
const scheduler = require('../scheduler');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        process.stderr.write(`Invalid --limit value: "${raw}". Must be a non-negative integer.\n`);
        process.exit(1);
      }
      options.selectionOptions = { ...options.selectionOptions, limit: n };
    } else if (args[i] === '--run-type') {
      options.runType = args[++i];
    }
  }

  return options;
}

async function main(argv = process.argv) {
  const options = parseArgs(argv);
  try {
    const summary = await scheduler.aiRecommendationBriefs(pg).runOnce(options);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = main;
