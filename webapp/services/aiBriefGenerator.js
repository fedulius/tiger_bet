'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_HEADLINE_LENGTH = 200;
const MAX_BRIEF_LENGTH = 4000;
const MAX_RISK_NOTE_LENGTH = 500;
const DEFAULT_PROMPT_PACK_DIR = path.resolve(__dirname, '../../docs/ai-briefs/prompt-pack');
const DEFAULT_PROMPT_VERSION = 'ai-brief-v1';
const { assembleAiBrief } = require('./aiBriefAssembler');
const { validateRecommendedBets } = require('./recommendedBetQualityGate');

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

  const allowedTopLevelKeys = new Set(['headline', 'brief', 'risk_note', 'recommended_bets', 'bet_explanations']);
  for (const key of Object.keys(output)) {
    if (!allowedTopLevelKeys.has(key)) {
      return { valid: false, reason: 'unexpected_output_property' };
    }
  }

  if (typeof output.headline !== 'string' || !output.headline.trim()) {
    return { valid: false, reason: 'missing_headline' };
  }
  if (output.headline.trim().length < 8) {
    return { valid: false, reason: 'headline_too_short' };
  }

  if (typeof output.brief !== 'string' || !output.brief.trim()) {
    return { valid: false, reason: 'missing_brief' };
  }
  if (output.brief.trim().length < 40) {
    return { valid: false, reason: 'brief_too_short' };
  }

  if (!Object.prototype.hasOwnProperty.call(output, 'risk_note')) {
    return { valid: false, reason: 'missing_risk_note' };
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

  const hasRecommendedBets = output.recommended_bets !== undefined && output.recommended_bets !== null;
  const hasBetExplanations = output.bet_explanations !== undefined && output.bet_explanations !== null;
  if (!hasRecommendedBets && !hasBetExplanations) {
    return { valid: false, reason: 'missing_recommended_bets' };
  }

  if (hasBetExplanations) {
    if (!Array.isArray(output.bet_explanations)) {
      return { valid: false, reason: 'invalid_bet_explanations_type' };
    }
    if (output.bet_explanations.length > 3) {
      return { valid: false, reason: 'too_many_bet_explanations' };
    }
    for (const item of output.bet_explanations) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { valid: false, reason: 'invalid_bet_explanation_item' };
      const allowedExplanationKeys = new Set(['market_key', 'reason']);
      for (const key of Object.keys(item)) {
        if (!allowedExplanationKeys.has(key)) return { valid: false, reason: 'unexpected_bet_explanation_property' };
      }
      if (typeof item.market_key !== 'string' || !item.market_key.trim()) return { valid: false, reason: 'invalid_bet_explanation_item' };
      if (typeof item.reason !== 'string' || !item.reason.trim()) return { valid: false, reason: 'invalid_bet_explanation_item' };
    }
  }

  if (hasRecommendedBets) {
    if (!Array.isArray(output.recommended_bets)) {
      return { valid: false, reason: 'invalid_recommended_bets_type' };
    }
    if (output.recommended_bets.length > 3) {
      return { valid: false, reason: 'too_many_recommended_bets' };
    }
    for (const bet of output.recommended_bets) {
      if (!bet || typeof bet !== 'object' || Array.isArray(bet)) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }

      const allowedBetKeys = new Set(['type', 'outcome', 'label', 'rate', 'reason', 'risk_label', 'confidence']);
      for (const key of Object.keys(bet)) {
        if (!allowedBetKeys.has(key)) {
          return { valid: false, reason: 'unexpected_recommended_bet_property' };
        }
      }

      if (typeof bet.type !== 'string' || !bet.type.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.outcome !== 'string' || !bet.outcome.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.label !== 'string' || !bet.label.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (isTechnicalBetLabel(bet.label)) {
        return { valid: false, reason: 'technical_recommended_bet_label' };
      }
      if (typeof bet.rate !== 'number') {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (typeof bet.reason !== 'string' || !bet.reason.trim()) {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
      if (!['low', 'medium', 'high'].includes(bet.risk_label)) {
        return { valid: false, reason: 'invalid_risk_label' };
      }
      if (bet.confidence != null && typeof bet.confidence !== 'number') {
        return { valid: false, reason: 'invalid_recommended_bet_item' };
      }
    }
  }

  return { valid: true };
}

function isTechnicalBetLabel(label) {
  const normalized = String(label || '').trim();
  const lower = normalized.toLowerCase();
  if (['w1', 'w2', 'x', '1x', 'x2', '12'].includes(lower)) return true;
  return /^(over|under|correct_score|handicap|total|winner|match_result|match_qualify|double_chance)[_:\-0-9a-z]+$/i.test(normalized);
}

function readablePayloadLabel(bet) {
  const label = String(bet && bet.label ? bet.label : '').trim();
  const type = String(bet && bet.type ? bet.type : '').toLowerCase();
  const outcome = String(bet && bet.outcome ? bet.outcome : '').toLowerCase();
  if (type === 'double_chance') {
    if (outcome === 'x1' || outcome === '1x' || label.toLowerCase() === '1x') return 'Двойной шанс: 1X';
    if (outcome === 'x2' || outcome === '2x' || label.toLowerCase() === 'x2') return 'Двойной шанс: X2';
    if (outcome === '12' || label === '12') return 'Двойной шанс: 12';
  }
  return label;
}

function normalizeAiBriefOutput(output, sourcePayload) {
  // Sanitize text: remove replacement characters and normalize unicode
  function sanitizeText(text) {
    if (!text) return text;
    return String(text)
      .replace(/\uFFFD/g, '') // remove replacement characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // remove control chars
      .normalize('NFC');
  }

  const riskNote = output.risk_note != null ? sanitizeText(output.risk_note).trim() : null;
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
      type: b.type,
      outcome: b.outcome,
      label,
      rate: b.rate,
      reason: b.reason,
      risk_label: b.risk_label || 'low',
      ...(typeof b.confidence === 'number' ? { confidence: b.confidence } : {}),
    };
  }) : [];

  function betCategory(b) {
    const t = (b.type || '').toLowerCase();
    if (t === 'one_x_two' || t === 'match_qualify' || t === 'winner' || t === 'match_result' || t === 'double_chance') return 'winner';
    if (t.includes('total') || t.includes('totals')) return 'total';
    if (t.includes('both') || t.includes('btts') || t === 'both_to_score') return 'btts';
    if (t.includes('handicap')) return 'handicap';
    if (t === 'correct_score') return 'correct_score';
    if (t.includes('corner')) return 'corner';
    if (t.includes('yellow')) return 'yellow';
    return t;
  }

  // Enforce source-backed markets and unique semantic categories when source payload is available.
  if (sourcePayload) {
    const payloadBets = [
      ...(sourcePayload.top_bets || []),
      ...(sourcePayload.risk_bets || []),
    ].filter(b => b && b.type && b.outcome && b.rate != null && b.label);

    function rateMatches(a, b) {
      const left = Number(a);
      const right = Number(b);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return Math.abs(left - right) < 0.001;
    }

    function findPayloadMatch(bet) {
      return payloadBets.find(pb => pb.type === bet.type && pb.outcome === bet.outcome && rateMatches(pb.rate, bet.rate)) || null;
    }

    function replacementFor(existingCats) {
      return payloadBets.find(pb => !existingCats.has(betCategory(pb))) || null;
    }

    for (let i = bets.length - 1; i >= 0; i--) {
      const current = bets[i];
      const exactPayloadMatch = findPayloadMatch(current);
      const unsupported = !exactPayloadMatch;
      const templateExactScore = current.type === 'correct_score' && unsupported;
      const otherCats = new Set(bets.filter((_, j) => j !== i).map(betCategory));
      const duplicateCategory = otherCats.has(betCategory(current));

      if (!unsupported && !duplicateCategory && !templateExactScore) {
        bets[i] = {
          ...current,
          label: readablePayloadLabel(exactPayloadMatch),
          risk_label: exactPayloadMatch.risk_label || current.risk_label,
        };
        continue;
      }

      const alt = replacementFor(otherCats);
      if (alt) {
        bets[i] = {
          type: alt.type,
          outcome: alt.outcome,
          label: readablePayloadLabel(alt),
          rate: alt.rate,
          reason: alt.reason || 'Альтернативный рынок из входного payload: ставка заменена, чтобы не показывать неподтверждённый или взаимоисключающий исход.',
          risk_label: alt.risk_label || current.risk_label,
          ...(typeof current.confidence === 'number' ? { confidence: current.confidence } : {}),
        };
      } else {
        bets.splice(i, 1);
      }
    }
  }

  // Keep semantic risk labels. Prefer the deterministic source `risk_bets`
  // labels when the LLM returned the same concrete market/outcome.
  if (bets.length > 0) {
    const allowed = new Set(['low', 'medium', 'high']);
    const fallbackOrder = ['low', 'medium', 'high'];
    const used = new Set();
    for (let i = 0; i < bets.length; i++) {
      const sourceRiskBet = sourcePayload && Array.isArray(sourcePayload.risk_bets)
        ? sourcePayload.risk_bets.find((pb) => pb && pb.type === bets[i].type && pb.outcome === bets[i].outcome)
        : null;
      let label = allowed.has(sourceRiskBet && sourceRiskBet.risk_label)
        ? sourceRiskBet.risk_label
        : (allowed.has(bets[i].risk_label) ? bets[i].risk_label : null);
      if (!label || used.has(label)) {
        label = fallbackOrder.find((x) => !used.has(x)) || 'medium';
      }
      bets[i].risk_label = label;
      used.add(label);
    }
  }

  return {
    headline: sanitizeText(output.headline || '').trim(),
    brief: sanitizeText(output.brief || '').trim(),
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

  let normalized;
  if (Array.isArray(parsed.bet_explanations) && sourcePayload.market_fit && Array.isArray(sourcePayload.market_fit.selected_bets)) {
    normalized = assembleAiBrief({ llmOutput: parsed, selectedBets: sourcePayload.market_fit.selected_bets });
    const gate = validateRecommendedBets({
      recommendedBets: normalized.recommended_bets,
      marketCatalog: sourcePayload.market_catalog,
      marketFit: sourcePayload.market_fit,
    });
    if (!gate.valid) {
      return {
        status: 'failed',
        error: gate.reason,
      };
    }
  } else {
    normalized = normalizeAiBriefOutput(parsed, sourcePayload);
  }

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
