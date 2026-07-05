'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pg = require('../DataBase').postgres;
const { runDailyPicks } = require('../scheduler/DailyPicks');
const { generateAiBrief } = require('../webapp/services/aiBriefGenerator');
const { aiBriefLlmProvider } = require('../webapp/services/aiBriefLlmProvider');

async function main() {
  try {
    const summary = await runDailyPicks(pg, {
      generator: generateAiBrief,
      generatorProvider: aiBriefLlmProvider,
      modelName: process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      promptVersion: 'daily-picks-v1',
    });
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
