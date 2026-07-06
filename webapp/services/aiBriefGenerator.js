'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_HEADLINE_LENGTH = 200;
const MAX_BRIEF_LENGTH = 2000;
const MAX_RISK_NOTE_LENGTH = 500;
const DEFAULT_PROMPT_PACK_DIR = path.resolve(__dirname, '../../docs/ai-briefs/prompt-pack');
const DEFAULT_PROMPT_VERSION = 'ai-brief-v1';

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateAiBriefOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, reason: 'not_an_object' };
  }

  if (typeof output.headline !== 'string' || !output.headline.trim()) {
    return { valid: false, reason: 'missing_headline' };
  }

  if (typeof output.brief !== 'string' || !output.brief.trim()) {
    return { valid: false, reason: 'missing_brief' };
  }

  if (output.risk_note !== null && output.risk_note !== undefined && typeof output.risk_note !== 'string') {
    return { valid: false, reason: 'invalid_risk_note_type' };
  }

  if (output.headline.length > MAX_HEADLINE_LENGTH) {
    return { valid: false, reason: 'headline_too_long' };
  }

  if (output.brief.length > MAX_BRIEF_LENGTH) {
    return { valid: false, reason: 'brief_too_long' };
  }

  if (typeof output.risk_note === 'string' && output.risk_note.length > MAX_RISK_NOTE_LENGTH) {
    return { valid: false, reason: 'risk_note_too_long' };
  }

  if (output.recommended_bets !== undefined && output.recommended_bets !== null) {
    if (!Array.isArray(output.recommended_bets)) {
      return { valid: false, reason: 'invalid_recommended_bets_type' };
    }
    for (const bet of output.recommended_bets) {
      if (!bet || typeof bet !== 'object' || Array.isArray(bet)) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.type !== 'string' || !bet.type.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.outcome !== 'string' || !bet.outcome.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (bet.label != null && typeof bet.label !== 'string') {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.rate !== 'number') {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.reason !== 'string' || !bet.reason.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (bet.risk_label != null && !['low', 'medium', 'high'].includes(bet.risk_label)) {
        return { valid: false, reason: 'invalid_risk_label' };
      }
      // risk_label is optional — will be normalized to 'low' default
    }
  }

  return { valid: true };
}

function normalizeAiBriefOutput(output) {
  const riskNote = output.risk_note != null ? String(output.risk_note).trim() : null;
  const bets = Array.isArray(output.recommended_bets) ? output.recommended_bets.map((b) => {
    let label = b.label || '';
    // Safety-net: translate codes to readable text
    if (!label || /^(w1|w2|x)$/i.test(label.trim())) {
      const code = label.trim().toLowerCase() || (b.outcome || '').toLowerCase();
      const type = (b.type || '').toLowerCase();
      if (code === 'w1') label = 'Победа хозяев';
      else if (code === 'w2') label = 'Победа гостей';
      else if (code === 'x') label = 'Ничья';
      else if (type.includes('total') && type.includes('over')) label = 'Тотал больше';
      else if (type.includes('total') && type.includes('under')) label = 'Тотал меньше';
      else if (type.includes('both') || type.includes('btts')) label = 'Обе забьют';
      else if (!label) label = b.outcome || b.type || 'Ставка';
    }
    return {
      ...b,
      label,
      risk_label: b.risk_label || 'low',
    };
  }) : [];
  return {
    headline: String(output.headline || '').trim(),
    brief: String(output.brief || '').trim(),
    risk_note: riskNote || null,
    recommended_bets: bets,
  };
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function loadPromptPack({ promptPackDir = DEFAULT_PROMPT_PACK_DIR } = {}) {
  const systemPromptPath = path.join(promptPackDir, 'system-prompt.md');
  const userPromptTemplatePath = path.join(promptPackDir, 'user-prompt-template.md');
  const outputSchemaPath = path.join(promptPackDir, 'output-schema.json');
  const fewShotsPath = path.join(promptPackDir, 'few-shots.json');

  try {
    return {
      systemPrompt: readTextFile(systemPromptPath),
      userPromptTemplate: readTextFile(userPromptTemplatePath),
      outputSchema: JSON.parse(readTextFile(outputSchemaPath)),
      fewShots: JSON.parse(readTextFile(fewShotsPath)),
    };
  } catch (err) {
    const error = new Error(err && err.message ? err.message : 'prompt_pack_unavailable');
    error.code = err instanceof SyntaxError ? 'prompt_pack_invalid_json' : 'prompt_pack_unavailable';
    throw error;
  }
}

function buildUserPrompt({ template, sourcePayload }) {
  const payloadJson = JSON.stringify(sourcePayload, null, 2);
  return String(template || '').replace('{{SOURCE_PAYLOAD_JSON}}', payloadJson);
}

async function generateAiBrief({ sourcePayload, modelName, promptVersion, provider, promptPackDir }) {
  if (!sourcePayload || sourcePayload.source_mode === 'skip') {
    return {
      status: 'skipped',
      skip_reason: (sourcePayload && sourcePayload.skip_reason) || 'source_skipped',
    };
  }

  if (typeof provider !== 'function') {
    return {
      status: 'failed',
      error: 'no_provider',
    };
  }

  let promptPack;
  try {
    promptPack = loadPromptPack({ promptPackDir });
  } catch (err) {
    return {
      status: 'failed',
      error: err && err.code ? err.code : 'prompt_pack_unavailable',
    };
  }

  let providerResult;
  const resolvedPromptVersion = promptVersion || DEFAULT_PROMPT_VERSION;
  try {
    providerResult = await provider({
      sourcePayload,
      modelName,
      promptVersion: resolvedPromptVersion,
      systemPrompt: promptPack.systemPrompt,
      userPrompt: buildUserPrompt({
        template: promptPack.userPromptTemplate,
        sourcePayload,
      }),
      outputSchema: promptPack.outputSchema,
      fewShots: promptPack.fewShots,
    });
  } catch (err) {
    return {
      status: 'failed',
      error: err && err.message ? err.message : 'provider_error',
    };
  }

  if (!providerResult) {
    return {
      status: 'failed',
      error: 'provider_returned_null',
    };
  }

  const rawText = typeof providerResult === 'string' ? providerResult : (providerResult.text || null);
  const parsed = parseJsonFromText(rawText);

  if (!parsed) {
    return {
      status: 'failed',
      error: 'invalid_json_output',
    };
  }

  const validation = validateAiBriefOutput(parsed);
  if (!validation.valid) {
    return {
      status: 'failed',
      error: validation.reason,
    };
  }

  const normalized = normalizeAiBriefOutput(parsed);

  return {
    status: 'ready',
    output: normalized,
    model_name: modelName || null,
    prompt_version: resolvedPromptVersion,
    prompt_tokens: providerResult.prompt_tokens != null ? providerResult.prompt_tokens : null,
    completion_tokens: providerResult.completion_tokens != null ? providerResult.completion_tokens : null,
  };
}

module.exports = {
  DEFAULT_PROMPT_PACK_DIR,
  DEFAULT_PROMPT_VERSION,
  buildUserPrompt,
  generateAiBrief,
  loadPromptPack,
  normalizeAiBriefOutput,
  validateAiBriefOutput,
};
