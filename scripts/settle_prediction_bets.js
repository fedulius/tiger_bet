#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const pg = require('../DataBase').postgres;
const { settlePredictionBets, parseArgs } = require('../webapp/services/predictionSettlementService');

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const result = await settlePredictionBets(pg, args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
