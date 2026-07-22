'use strict';

const { aiBriefLlmProvider } = require('./aiBriefLlmProvider');

const WRITER_VERSION = 'recommended-pick-writer-v1';
const OUTPUT_FIELDS = new Set(['headline', 'brief', 'risk_note', 'writer_version']);
const MAX_TRACE_LENGTH = 3000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function boundedTrace(value, maxLength = MAX_TRACE_LENGTH) {
  if (value == null) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxLength ? value : { truncated: true, preview: serialized.slice(0, maxLength) };
  } catch {
    return { truncated: true, preview: String(value).slice(0, maxLength) };
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value.trim();
}

function buildWriterFacts(input) {
  if (!isPlainObject(input)) throw new Error('writer input must be an object');
  const snapshot = input.analyst_snapshot;
  const option = input.selected_option;
  const metadata = input.selector_metadata;
  if (!isPlainObject(snapshot) || !isPlainObject(option) || !isPlainObject(metadata)) throw new Error('writer input requires analyst_snapshot, selected_option, and selector_metadata objects');
  if (!Number.isInteger(snapshot.match_ref) || snapshot.match_ref !== option.match_ref) throw new Error('selected_option must belong to analyst_snapshot match_ref');
  const marketKey = requiredString(option.market_key, 'selected_option market_key');
  const estimate = Array.isArray(snapshot.market_estimates) && snapshot.market_estimates.find((item) => isPlainObject(item) && item.market_key === marketKey);
  if (!estimate || !Number.isFinite(estimate.estimated_probability)) throw new Error('selected_option market_key must resolve to an analyst estimate');
  if (!Number.isFinite(option.estimated_probability) || option.estimated_probability !== estimate.estimated_probability) throw new Error('selected_option estimated_probability must exactly equal analyst estimate');
  if (!Number.isFinite(option.odds_decimal) || option.odds_decimal <= 1) throw new Error('selected_option odds_decimal must be greater than one');
  if (!Number.isFinite(option.implied_probability) || option.implied_probability < 0 || option.implied_probability > 1) throw new Error('selected_option implied_probability must be valid');
  const facts = {
    selected_option: {
      label: requiredString(option.label, 'selected_option label'),
      market_key: marketKey,
      odds_decimal: option.odds_decimal,
      implied_probability: option.implied_probability,
      estimated_probability: option.estimated_probability,
    },
    analyst_context: {
      match_assessment: requiredString(snapshot.match_assessment, 'analyst_snapshot match_assessment'),
      rationale: requiredString(estimate.rationale, 'analyst estimate rationale'),
      uncertainty: snapshot.uncertainty == null ? null : requiredString(snapshot.uncertainty, 'analyst_snapshot uncertainty'),
    },
    selector_metadata: {
      selection_confidence: metadata.selection_confidence,
      selection_quality: metadata.selection_quality,
      warning: metadata.warning == null ? null : requiredString(metadata.warning, 'selector_metadata warning'),
    },
  };
  return deepFreeze(facts);
}

function buildResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: WRITER_VERSION,
      strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        required: [...OUTPUT_FIELDS],
        properties: {
          headline: { type: 'string', minLength: 8, maxLength: 120 },
          brief: { type: 'string', minLength: 20, maxLength: 500 },
          risk_note: { type: 'string', minLength: 10, maxLength: 300 },
          writer_version: { type: 'string', const: WRITER_VERSION },
        },
      },
    },
  };
}

function buildRecommendedPickWriterPrompts(input) {
  const facts = buildWriterFacts(input);
  return {
    responseFormat: buildResponseFormat(),
    facts,
    systemPrompt: [
      'You are the Tiger Bet recommendation writer. You are not an analyst or selector.',
      'Use only the passed frozen facts. Do not choose, compare, replace, or invent an option, market, odds, evidence, selection, or probability.',
      'Write concise user-facing Russian only. Base the explanation only on the supplied facts.',
      'Do not output probability values, evidence, selection process, or any fields beyond the exact JSON schema.',
      'If mentioning a market or odds, repeat only the fixed selected option label and exact odds.',
      'Return JSON only.',
    ].join('\n'),
    userPrompt: `Prompt version: ${WRITER_VERSION}\nWrite the text for this already fixed selection.\n\nFrozen facts:\n${JSON.stringify(facts)}`,
  };
}

function textError(value, name, minLength, maxLength) {
  if (typeof value !== 'string' || !value.trim()) return `${name} must be a nonempty string`;
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) return `${name} must be ${minLength} to ${maxLength} characters`;
  if (!/[А-Яа-яЁё]/.test(text) || /[A-Za-z]/.test(text)) return `${name} must be user-facing Russian text`;
  if (/\b(?:вероятност\w*|probabilit\w*|evidence|доказательств\w*|выбор\w*|селекц\w*)\b/i.test(text)) return `${name} must not mention probability, evidence, or selection`;
  return null;
}

function statedOdds(text) {
  const matches = String(text).matchAll(/(?:коэффициент|кэф|odds?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi);
  return [...matches].map((match) => Number(match[1].replace(',', '.'))).filter(Number.isFinite);
}

function validateWriterOutput(output, facts) {
  if (!isPlainObject(output)) return { error: 'response must be a JSON object' };
  const keys = Object.keys(output);
  const extra = keys.find((key) => !OUTPUT_FIELDS.has(key));
  if (extra) return { error: `unexpected field: ${extra}` };
  const missing = [...OUTPUT_FIELDS].find((key) => !Object.hasOwn(output, key));
  if (missing) return { error: `missing required field: ${missing}` };
  for (const [name, min, max] of [['headline', 8, 120], ['brief', 20, 500], ['risk_note', 10, 300]]) {
    const error = textError(output[name], name, min, max);
    if (error) return { error };
  }
  if (output.writer_version !== WRITER_VERSION) return { error: `writer_version must be ${WRITER_VERSION}` };
  const combined = `${output.headline}\n${output.brief}\n${output.risk_note}`;
  const mentionedOdds = statedOdds(combined);
  if (mentionedOdds.some((odds) => Math.abs(odds - facts.selected_option.odds_decimal) > 0.0001)) return { error: 'text must not state different selected odds' };
  if (/(?:рынок|ставка|исход)\s*[:—-]?/i.test(combined) && !combined.includes(facts.selected_option.label)) return { error: 'text must not state a different selected market' };
  return { writer_output: output };
}

async function writeRecommendedPick(input, { provider = aiBriefLlmProvider, modelName } = {}) {
  const prompts = buildRecommendedPickWriterPrompts(input);
  const invoke = async (userPrompt) => {
    try {
      const response = await provider({ systemPrompt: prompts.systemPrompt, userPrompt, modelName, fewShots: [], responseFormat: prompts.responseFormat });
      return { raw: parseJsonObject(response?.text), providerError: null };
    } catch (error) {
      return { raw: null, providerError: `provider error: ${String(error?.message || error).slice(0, 300)}` };
    }
  };
  const first = await invoke(prompts.userPrompt);
  let validation = first.providerError ? { error: first.providerError } : validateWriterOutput(first.raw, prompts.facts);
  const errors = validation.error ? [validation.error] : [];
  let retry = null;
  if (!validation.writer_output) {
    retry = await invoke(`${prompts.userPrompt}\n\nPrevious response was rejected: ${validation.error}. Return a corrected JSON object with no extra fields.`);
    validation = retry.providerError ? { error: retry.providerError } : validateWriterOutput(retry.raw, prompts.facts);
    if (validation.error) errors.push(validation.error);
  }
  const trace = { prompt_version: WRITER_VERSION, first_output: boundedTrace(first.raw), retry_output: boundedTrace(retry?.raw), validation_errors: errors.map((error) => String(error).slice(0, 300)) };
  if (!validation.writer_output) return { writer_output: null, reason: 'writer_output_invalid', trace };
  return { writer_output: deepFreeze(validation.writer_output), trace };
}

module.exports = {
  WRITER_VERSION,
  buildRecommendedPickWriterPrompts,
  validateWriterOutput,
  writeRecommendedPick,
  __private: { boundedTrace, buildResponseFormat, buildWriterFacts, deepFreeze, parseJsonObject, statedOdds },
};
