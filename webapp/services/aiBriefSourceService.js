'use strict';

const crypto = require('crypto');
const stavkaApi = require('../../lib/stavkaApi');

const STAVKA_MATCH_URL_BASE = 'https://stavka.tv/matches';
const MIN_USABLE_BETS = 2;
const MIN_BET_COUNT = 5;

function buildSkipHash({ skip_reason, match_slug = null }) {
  const canonical = JSON.stringify({ source_mode: 'skip', skip_reason, match_slug: match_slug || null });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function buildAiBriefSourcePayload({
  match,
  popularBetsLoader,
  matchDetailLoader,
  riskBetsSelector,
}) {
  if (!match || !match.slug) {
    return { source_mode: 'skip', skip_reason: 'no_match', source_hash: buildSkipHash({ skip_reason: 'no_match' }) };
  }

  if (typeof popularBetsLoader !== 'function') {
    return { source_mode: 'skip', skip_reason: 'no_loader', source_hash: buildSkipHash({ skip_reason: 'no_loader', match_slug: match.slug }) };
  }

  const [popularBetsData, matchDetailData] = await Promise.all([
    popularBetsLoader(match.slug),
    typeof matchDetailLoader === 'function' ? matchDetailLoader(match.slug) : Promise.resolve(null),
  ]);

  const groupedBets = stavkaApi.groupBetsByType(popularBetsData);
  const usableBets = groupedBets.filter(b => (b.count || 0) >= MIN_BET_COUNT);

  if (usableBets.length < MIN_USABLE_BETS) {
    return { source_mode: 'skip', skip_reason: 'insufficient_data', source_hash: buildSkipHash({ skip_reason: 'insufficient_data', match_slug: match.slug }) };
  }

  const riskBets = typeof riskBetsSelector === 'function'
    ? riskBetsSelector(popularBetsData)
    : stavkaApi.selectRiskBets(popularBetsData);

  const summarySnippet = matchDetailData
    ? stavkaApi.extractSummarySnippet(matchDetailData.predictionSummary) || null
    : null;

  const sourceMode = (summarySnippet && summarySnippet.length > 20) ? 'full' : 'light';

  const topBets = groupedBets.slice(0, 5).map(b => ({
    type: b.type,
    outcome: b.outcome,
    count: b.count,
    rate: b.rate,
    percent: b.percent != null ? b.percent : null,
    label: b.label,
  }));

  const normalizedRiskBets = riskBets.map(b => ({
    type: b.type,
    outcome: b.outcome,
    rate: b.rate,
    count: b.count,
    percent: b.percent != null ? b.percent : null,
    label: b.label,
    risk_order: b.risk_order,
    risk_label: b.risk_label,
    risk_name: b.risk_name,
  }));

  const primarySignal = topBets.length > 0 ? {
    type: topBets[0].type,
    outcome: topBets[0].outcome,
    count: topBets[0].count,
    rate: topBets[0].rate,
    percent: topBets[0].percent,
    label: topBets[0].label,
  } : null;

  const sourceUrl = STAVKA_MATCH_URL_BASE + '/' + match.slug;

  const hashInput = buildCanonicalHashInput({
    match_slug: match.slug,
    source_mode: sourceMode,
    top_bets: topBets,
    primary_signal: primarySignal,
    summary_snippet: summarySnippet,
  });

  const sourceHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  return {
    match_id: match.id,
    match_slug: match.slug,
    sport_slug: match.sportSlug || null,
    source_mode: sourceMode,
    source_url: sourceUrl,
    top_bets: topBets,
    risk_bets: normalizedRiskBets,
    primary_signal: primarySignal,
    summary_snippet: summarySnippet,
    source_hash: sourceHash,
  };
}

function buildCanonicalHashInput({ match_slug, source_mode, top_bets, primary_signal, summary_snippet }) {
  const canonical = {
    match_slug: match_slug,
    source_mode: source_mode,
    primary_signal: primary_signal ? {
      type: primary_signal.type,
      outcome: primary_signal.outcome,
      count: primary_signal.count,
      rate: primary_signal.rate,
    } : null,
    top_bets: (top_bets || []).map(b => ({
      type: b.type,
      outcome: b.outcome,
      count: b.count,
      rate: b.rate,
    })),
    summary_snippet: summary_snippet || null,
  };

  return JSON.stringify(canonical);
}

module.exports = {
  buildAiBriefSourcePayload,
  buildCanonicalHashInput,
};
