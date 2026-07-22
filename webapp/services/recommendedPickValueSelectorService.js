'use strict';

const { aiBriefLlmProvider } = require('./aiBriefLlmProvider');

const SELECTOR_VERSION = 'recommended-pick-value-selector-v1';
const OUTPUT_FIELDS = new Set(['match_ref', 'option_ref', 'selection_confidence', 'selection_quality', 'warning', 'selector_version']);
const OPTION_FIELDS = ['match_ref', 'option_ref', 'market_key', 'label', 'odds_decimal', 'implied_probability'];
const MAX_MATCHES = 6;
const MAX_OPTIONS_PER_MATCH = 4;
const LOW_CONFIDENCE_THRESHOLD = 50;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function boundedTrace(value, maxLength = 3000) {
  if (value == null) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxLength ? value : { truncated: true, preview: serialized.slice(0, maxLength) };
  } catch {
    return { truncated: true, preview: String(value).slice(0, maxLength) };
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isValidMarketEstimate(value) {
  return isPlainObject(value)
    && typeof value.market_key === 'string'
    && Number.isFinite(value.estimated_probability)
    && value.estimated_probability >= 0
    && value.estimated_probability <= 1;
}

function normalizeSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) throw new Error('analyst snapshots must be an array');
  const selected = [];
  const seen = new Set();
  for (const snapshot of snapshots) {
    if (!isPlainObject(snapshot) || !Number.isInteger(snapshot.match_ref) || !Array.isArray(snapshot.market_estimates)) continue;
    if (seen.has(snapshot.match_ref)) continue;
    seen.add(snapshot.match_ref);
    const marketEstimates = snapshot.market_estimates
      .filter(isValidMarketEstimate)
      .map(({ market_key, estimated_probability, confidence }) => ({ market_key, estimated_probability, ...(Number.isInteger(confidence) ? { confidence } : {}) }));
    if (marketEstimates.length) selected.push({ match_ref: snapshot.match_ref, market_estimates: marketEstimates });
    if (selected.length === MAX_MATCHES) break;
  }
  return selected;
}

function normalizeOption(option) {
  if (!isPlainObject(option)
    || !Number.isInteger(option.match_ref)
    || typeof option.option_ref !== 'string' || !option.option_ref
    || typeof option.market_key !== 'string' || !option.market_key
    || typeof option.label !== 'string' || !option.label
    || !Number.isFinite(option.odds_decimal) || option.odds_decimal <= 1
    || !Number.isFinite(option.implied_probability) || option.implied_probability < 0 || option.implied_probability > 1) return null;
  return Object.fromEntries(OPTION_FIELDS.map((key) => [key, option[key]]));
}

function buildOptionWhitelist(snapshots, options) {
  if (!Array.isArray(options)) throw new Error('options must be an array');
  const allowed = new Map(normalizeSnapshots(snapshots).map((snapshot) => [snapshot.match_ref, new Set(snapshot.market_estimates.map((estimate) => estimate.market_key))]));
  const counts = new Map();
  const result = [];
  for (const source of options) {
    const option = normalizeOption(source);
    if (!option || !allowed.get(option.match_ref)?.has(option.market_key)) continue;
    const count = counts.get(option.match_ref) || 0;
    if (count >= MAX_OPTIONS_PER_MATCH) continue;
    result.push(option);
    counts.set(option.match_ref, count + 1);
  }
  return result;
}

function buildResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: SELECTOR_VERSION,
      strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        required: [...OUTPUT_FIELDS],
        properties: {
          match_ref: { type: 'integer' },
          option_ref: { type: 'string', minLength: 1 },
          selection_confidence: { type: 'integer', minimum: 0, maximum: 100 },
          selection_quality: { type: 'string', enum: ['strong', 'fallback'] },
          warning: { type: ['string', 'null'] },
          selector_version: { type: 'string', const: SELECTOR_VERSION },
        },
      },
    },
  };
}

function buildValueSelectorPrompts(snapshots, options) {
  const analystSnapshots = normalizeSnapshots(snapshots);
  const whitelist = buildOptionWhitelist(analystSnapshots, options);
  return {
    responseFormat: buildResponseFormat(),
    analystSnapshots,
    whitelist,
    systemPrompt: [
      'You are the Tiger Bet value selector, not a sports analyst.',
      'Choose only one option from the supplied whitelist by comparing its server-supplied implied_probability with the corresponding immutable analyst estimated_probability.',
      'You cannot invent sports facts, write evidence, rationale, headlines, briefs, or market analysis, and cannot modify analyst probability.',
      'No provider odds IDs: do not use or request them. Return only the exact JSON schema.',
      'Use strong only when confidence is not low and warning is null. Use fallback only with a concrete nonempty warning.',
    ].join('\n'),
    userPrompt: `Prompt version: ${SELECTOR_VERSION}\nSelect at most one value option. No selection is preferable to an unsupported choice.\n\nAnalyst snapshots:\n${JSON.stringify(analystSnapshots)}\n\nOption whitelist:\n${JSON.stringify(whitelist)}`,
  };
}

function validateSelection(selection, analystSnapshots, whitelist) {
  if (!isPlainObject(selection)) return { error: 'response must be a JSON object' };
  const keys = Object.keys(selection);
  const extra = keys.find((key) => !OUTPUT_FIELDS.has(key));
  if (extra) return { error: `unexpected field: ${extra}` };
  const missing = [...OUTPUT_FIELDS].find((key) => !Object.hasOwn(selection, key));
  if (missing) return { error: `missing required field: ${missing}` };
  if (!Number.isInteger(selection.match_ref)) return { error: 'match_ref must be an integer' };
  if (typeof selection.option_ref !== 'string' || !selection.option_ref) return { error: 'option_ref must be a nonempty string' };
  if (!Number.isInteger(selection.selection_confidence) || selection.selection_confidence < 0 || selection.selection_confidence > 100) return { error: 'selection_confidence must be an integer from 0 to 100' };
  if (!['strong', 'fallback'].includes(selection.selection_quality)) return { error: 'selection_quality must be strong or fallback' };
  if (selection.selector_version !== SELECTOR_VERSION) return { error: `selector_version must be ${SELECTOR_VERSION}` };
  if (selection.selection_quality === 'strong' && selection.warning !== null) return { error: 'strong selection requires warning to be null' };
  if (selection.selection_quality === 'fallback' && (typeof selection.warning !== 'string' || !selection.warning.trim())) return { error: 'fallback selection requires a nonempty warning' };
  if (selection.selection_quality === 'strong' && selection.selection_confidence < LOW_CONFIDENCE_THRESHOLD) return { error: 'low confidence selection cannot be strong' };
  if (selection.warning !== null && (typeof selection.warning !== 'string' || !selection.warning.trim())) return { error: 'warning must be null or a nonempty string' };
  const option = whitelist.find((item) => item.option_ref === selection.option_ref);
  if (!option) return { error: 'option_ref must resolve to an option in the whitelist' };
  if (option.match_ref !== selection.match_ref) return { error: 'option_ref must belong to match_ref' };
  const snapshot = analystSnapshots.find((item) => item.match_ref === selection.match_ref);
  const estimate = snapshot?.market_estimates.find((item) => item.market_key === option.market_key);
  if (!estimate) return { error: 'option market_key must have a corresponding analyst market_estimate' };
  if (estimate.estimated_probability <= option.implied_probability) return { error: 'selected option must have analyst estimated_probability above implied_probability' };
  return { selection };
}

async function selectRecommendedPickValue(snapshots, options, { provider = aiBriefLlmProvider, modelName } = {}) {
  const prompts = buildValueSelectorPrompts(snapshots, options);
  const invoke = async (userPrompt) => {
    try {
      const response = await provider({ systemPrompt: prompts.systemPrompt, userPrompt, modelName, fewShots: [], responseFormat: prompts.responseFormat });
      return { raw: parseJsonObject(response?.text), providerError: null };
    } catch (error) {
      return { raw: null, providerError: `provider error: ${String(error?.message || error).slice(0, 300)}` };
    }
  };
  const first = await invoke(prompts.userPrompt);
  let validation = first.providerError ? { error: first.providerError } : validateSelection(first.raw, prompts.analystSnapshots, prompts.whitelist);
  const errors = validation.error ? [validation.error] : [];
  let retry = null;
  if (!validation.selection) {
    retry = await invoke(`${prompts.userPrompt}\n\nPrevious response was rejected: ${validation.error}. Return a corrected JSON object with no extra fields.`);
    validation = retry.providerError ? { error: retry.providerError } : validateSelection(retry.raw, prompts.analystSnapshots, prompts.whitelist);
    if (validation.error) errors.push(validation.error);
  }
  const trace = { prompt_version: SELECTOR_VERSION, first_output: boundedTrace(first.raw), retry_output: boundedTrace(retry?.raw), validation_errors: errors.map((error) => String(error).slice(0, 300)) };
  if (!validation.selection) return { selection: null, reason: 'value_selection_invalid', trace };
  return { selection: deepFreeze(validation.selection), trace };
}

module.exports = {
  SELECTOR_VERSION,
  buildOptionWhitelist,
  buildValueSelectorPrompts,
  selectRecommendedPickValue,
  validateSelection,
  __private: { boundedTrace, buildResponseFormat, deepFreeze, normalizeOption, normalizeSnapshots, parseJsonObject },
};
