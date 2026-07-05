'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PROMPT_VERSION,
  buildUserPrompt,
  generateAiBrief,
  loadPromptPack,
  validateAiBriefOutput,
  normalizeAiBriefOutput,
} = require('../../webapp/services/aiBriefGenerator');

// --- Fixtures ---

const SOURCE_PAYLOAD_FULL = {
  match_id: 1001,
  match_slug: '27-06-2026-spain-uruguay',
  sport_slug: 'soccer',
  source_mode: 'full',
  source_url: 'https://stavka.tv/matches/27-06-2026-spain-uruguay',
  top_bets: [
    { type: 'one_x_two', outcome: 'w1', count: 120, rate: 1.72, percent: 40, label: 'Победа хозяев' },
  ],
  risk_bets: [],
  primary_signal: { type: 'one_x_two', outcome: 'w1', count: 120, rate: 1.72, percent: 40, label: 'Победа хозяев' },
  summary_snippet: 'Испания является фаворитом этого матча.',
  source_hash: 'abc123',
};

const SOURCE_PAYLOAD_LIGHT = {
  ...SOURCE_PAYLOAD_FULL,
  source_mode: 'light',
  summary_snippet: null,
};

const SOURCE_PAYLOAD_SKIP = {
  source_mode: 'skip',
  skip_reason: 'insufficient_data',
  source_hash: null,
};

const VALID_OUTPUT = {
  headline: 'Испания — явный фаворит',
  brief: 'Большинство ставок идёт на победу Испании с коэффициентом 1.72.',
  risk_note: 'Уругвай может удивить в контратаках.',
};

function makeProvider(text, opts = {}) {
  return async () => ({
    text,
    prompt_tokens: opts.prompt_tokens || null,
    completion_tokens: opts.completion_tokens || null,
  });
}

function makeThrowingProvider(message) {
  return async () => { throw new Error(message); };
}

function writePromptPack(dir, overrides = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'system-prompt.md'), overrides.systemPrompt || 'SYSTEM PROMPT', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'user-prompt-template.md'),
    overrides.userPromptTemplate || 'Payload:\n{{SOURCE_PAYLOAD_JSON}}\nEnd.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'output-schema.json'),
    overrides.outputSchema || JSON.stringify({ type: 'object', required: ['headline', 'brief', 'risk_note'] }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'few-shots.json'),
    overrides.fewShots || JSON.stringify([{ id: 'shot-1' }]),
    'utf8',
  );
  return dir;
}

function makePromptPackDir(overrides = {}) {
  return writePromptPack(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-brief-prompt-pack-')), overrides);
}

// --- generateAiBrief: skip cases ---

test('generateAiBrief: returns skipped when source_mode is skip', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_SKIP,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.skip_reason, 'insufficient_data');
});

test('generateAiBrief: returns skipped when sourcePayload is null', async () => {
  const result = await generateAiBrief({
    sourcePayload: null,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
  });

  assert.equal(result.status, 'skipped');
  assert.ok(result.skip_reason, 'should have a skip_reason');
});

test('generateAiBrief: skip_reason defaults to source_skipped when no skip_reason in payload', async () => {
  const result = await generateAiBrief({
    sourcePayload: { source_mode: 'skip' },
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.skip_reason, 'source_skipped');
});

// --- generateAiBrief: failed cases ---

test('generateAiBrief: returns failed when no provider', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: null,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'no_provider');
});

test('generateAiBrief: returns failed when provider is not a function', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: { generate: async () => {} },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'no_provider');
});

test('generateAiBrief: returns failed when prompt pack directory is missing', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: path.join(os.tmpdir(), 'missing-ai-brief-pack-does-not-exist'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'prompt_pack_unavailable');
});

test('generateAiBrief: returns failed when prompt pack has invalid json file', async () => {
  const promptPackDir = makePromptPackDir({ outputSchema: '{not json' });
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'prompt_pack_invalid_json');
});

test('generateAiBrief: returns failed when provider throws', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeThrowingProvider('timeout'),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'timeout');
});

test('generateAiBrief: returns failed when provider returns null', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: async () => null,
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'provider_returned_null');
});

test('generateAiBrief: returns failed when provider returns invalid JSON text', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider('not valid json at all'),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'invalid_json_output');
});

test('generateAiBrief: returns failed when provider returns empty text', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(''),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'invalid_json_output');
});

test('generateAiBrief: returns failed when output missing headline', async () => {
  const bad = { brief: 'Some brief', risk_note: null };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'missing_headline');
});

test('generateAiBrief: returns failed when output missing brief', async () => {
  const bad = { headline: 'Some headline', risk_note: null };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'missing_brief');
});

test('generateAiBrief: returns failed when headline exceeds max length', async () => {
  const bad = { headline: 'A'.repeat(201), brief: 'Some brief', risk_note: null };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'headline_too_long');
});

test('generateAiBrief: returns failed when brief exceeds max length', async () => {
  const bad = { headline: 'Some headline', brief: 'B'.repeat(2001), risk_note: null };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'brief_too_long');
});

test('generateAiBrief: returns failed when risk_note exceeds max length', async () => {
  const bad = { headline: 'Some headline', brief: 'Some brief', risk_note: 'R'.repeat(501) };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'risk_note_too_long');
});

// --- generateAiBrief: ready cases ---

test('generateAiBrief: returns ready with normalized output on valid response', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.output, {
    headline: VALID_OUTPUT.headline,
    brief: VALID_OUTPUT.brief,
    risk_note: VALID_OUTPUT.risk_note,
    recommended_bets: [],
  });
  assert.equal(result.model_name, 'gpt-4o-mini');
  assert.equal(result.prompt_version, 'v1');
});

test('generateAiBrief: defaults prompt version when omitted', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_LIGHT,
    modelName: 'claude-haiku-4-5-20251001',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.prompt_version, DEFAULT_PROMPT_VERSION);
});

test('generateAiBrief: passes modelName and promptVersion to result', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_LIGHT,
    modelName: 'claude-haiku-4-5-20251001',
    promptVersion: 'v2',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.model_name, 'claude-haiku-4-5-20251001');
  assert.equal(result.prompt_version, 'v2');
});

test('generateAiBrief: returns token counts from provider', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT), { prompt_tokens: 250, completion_tokens: 80 }),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.prompt_tokens, 250);
  assert.equal(result.completion_tokens, 80);
});

test('generateAiBrief: null token counts when provider omits them', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.prompt_tokens, null);
  assert.equal(result.completion_tokens, null);
});

test('generateAiBrief: ready when risk_note is null', async () => {
  const output = { headline: 'Headline', brief: 'Brief text', risk_note: null };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(output)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.output.risk_note, null);
});

test('generateAiBrief: ready when risk_note is absent from output', async () => {
  const output = { headline: 'Headline', brief: 'Brief text' };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(output)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.output.risk_note, null);
});

test('generateAiBrief: extracts JSON embedded in surrounding text', async () => {
  const embedded = 'Here is your output:\n' + JSON.stringify(VALID_OUTPUT) + '\nDone.';
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(embedded),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.output.headline, VALID_OUTPUT.headline);
});

test('generateAiBrief: provider receives prompt pack payload', async () => {
  let received = null;
  const promptPackDir = makePromptPackDir({
    systemPrompt: 'SYSTEM FROM TEST',
    userPromptTemplate: 'PAYLOAD:\n{{SOURCE_PAYLOAD_JSON}}\nEND',
    outputSchema: JSON.stringify({ type: 'object', title: 'TestSchema' }),
    fewShots: JSON.stringify([{ id: 'few-shot-a' }]),
  });
  const provider = async (args) => {
    received = args;
    return { text: JSON.stringify(VALID_OUTPUT) };
  };

  await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v2',
    provider,
    promptPackDir,
  });

  assert.ok(received, 'provider should be called');
  assert.equal(received.sourcePayload, SOURCE_PAYLOAD_FULL);
  assert.equal(received.modelName, 'gpt-4o-mini');
  assert.equal(received.promptVersion, 'v2');
  assert.equal(received.systemPrompt, 'SYSTEM FROM TEST');
  assert.deepEqual(received.outputSchema, { type: 'object', title: 'TestSchema' });
  assert.deepEqual(received.fewShots, [{ id: 'few-shot-a' }]);
  assert.match(received.userPrompt, /"match_id": 1001/);
  assert.match(received.userPrompt, /^PAYLOAD:/);
  assert.match(received.userPrompt, /END$/);
});

// --- loadPromptPack / buildUserPrompt ---

test('loadPromptPack: loads and parses prompt pack files', () => {
  const promptPackDir = makePromptPackDir({
    systemPrompt: 'SYSTEM X',
    userPromptTemplate: 'USER {{SOURCE_PAYLOAD_JSON}}',
    outputSchema: JSON.stringify({ type: 'object', properties: { headline: { type: 'string' } } }),
    fewShots: JSON.stringify([{ id: 'shot-x' }]),
  });

  const pack = loadPromptPack({ promptPackDir });

  assert.equal(pack.systemPrompt, 'SYSTEM X');
  assert.equal(pack.userPromptTemplate, 'USER {{SOURCE_PAYLOAD_JSON}}');
  assert.deepEqual(pack.outputSchema, { type: 'object', properties: { headline: { type: 'string' } } });
  assert.deepEqual(pack.fewShots, [{ id: 'shot-x' }]);
});

test('buildUserPrompt: injects formatted payload into template', () => {
  const result = buildUserPrompt({
    template: 'START\n{{SOURCE_PAYLOAD_JSON}}\nEND',
    sourcePayload: { match_id: 1001, nested: { value: true } },
  });

  assert.match(result, /^START/);
  assert.match(result, /"match_id": 1001/);
  assert.match(result, /"nested": \{/);
  assert.match(result, /END$/);
});

// --- validateAiBriefOutput ---

test('validateAiBriefOutput: returns invalid for null', () => {
  const result = validateAiBriefOutput(null);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not_an_object');
});

test('validateAiBriefOutput: returns invalid for non-object', () => {
  assert.equal(validateAiBriefOutput('string').valid, false);
  assert.equal(validateAiBriefOutput(42).valid, false);
  assert.equal(validateAiBriefOutput([]).valid, false);
});

test('validateAiBriefOutput: returns invalid for empty headline', () => {
  const result = validateAiBriefOutput({ headline: '', brief: 'Some brief', risk_note: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing_headline');
});

test('validateAiBriefOutput: returns invalid for whitespace-only headline', () => {
  const result = validateAiBriefOutput({ headline: '   ', brief: 'Some brief', risk_note: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing_headline');
});

test('validateAiBriefOutput: returns invalid for missing brief', () => {
  const result = validateAiBriefOutput({ headline: 'Headline', risk_note: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing_brief');
});

test('validateAiBriefOutput: returns invalid for headline too long', () => {
  const result = validateAiBriefOutput({ headline: 'A'.repeat(201), brief: 'Brief', risk_note: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'headline_too_long');
});

test('validateAiBriefOutput: accepts headline at max length', () => {
  const result = validateAiBriefOutput({ headline: 'A'.repeat(200), brief: 'Brief', risk_note: null });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: returns invalid for brief too long', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B'.repeat(2001), risk_note: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'brief_too_long');
});

test('validateAiBriefOutput: accepts brief at max length', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B'.repeat(2000), risk_note: null });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: returns invalid for risk_note too long', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: 'R'.repeat(501) });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'risk_note_too_long');
});

test('validateAiBriefOutput: accepts risk_note at max length', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: 'R'.repeat(500) });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: returns invalid when risk_note is non-string non-null', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: 42 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_risk_note_type');
});

test('validateAiBriefOutput: valid for complete correct object', () => {
  const result = validateAiBriefOutput(VALID_OUTPUT);
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: valid when risk_note is null', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: valid when risk_note is absent', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B' });
  assert.equal(result.valid, true);
});

// --- normalizeAiBriefOutput ---

test('normalizeAiBriefOutput: trims whitespace from headline and brief', () => {
  const result = normalizeAiBriefOutput({ headline: '  Title  ', brief: '  Body  ', risk_note: null });
  assert.equal(result.headline, 'Title');
  assert.equal(result.brief, 'Body');
});

test('normalizeAiBriefOutput: trims whitespace from risk_note', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: '  Note  ' });
  assert.equal(result.risk_note, 'Note');
});

test('normalizeAiBriefOutput: coerces undefined risk_note to null', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B' });
  assert.equal(result.risk_note, null);
});

test('normalizeAiBriefOutput: coerces empty-string risk_note to null', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: '' });
  assert.equal(result.risk_note, null);
});

test('normalizeAiBriefOutput: coerces whitespace-only risk_note to null', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: '   ' });
  assert.equal(result.risk_note, null);
});

test('normalizeAiBriefOutput: preserves non-empty risk_note', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: 'Real note' });
  assert.equal(result.risk_note, 'Real note');
});

test('normalizeAiBriefOutput: result has exactly the expected keys', () => {
  const result = normalizeAiBriefOutput(VALID_OUTPUT);
  assert.deepEqual(Object.keys(result).sort(), ['brief', 'headline', 'recommended_bets', 'risk_note']);
});

// --- recommended_bets: validateAiBriefOutput ---

test('validateAiBriefOutput: valid when recommended_bets is absent', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: valid when recommended_bets is empty array', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [] });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: valid when recommended_bets has a complete item', () => {
  const bets = [{ type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, reason: 'Фаворит матча.' }];
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: bets });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: valid when recommended_bets item includes confidence', () => {
  const bets = [{ type: 'total', outcome: 'over', label: 'Тотал больше 2.5', rate: 1.85, reason: 'Обе команды атакуют.', confidence: 0.75 }];
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: bets });
  assert.equal(result.valid, true);
});

test('validateAiBriefOutput: invalid when recommended_bets is not an array', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: 'not-array' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bets_type');
});

test('validateAiBriefOutput: invalid when recommended_bets item is not an object', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: ['bad'] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item is an array', () => {
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [[]] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item missing type', () => {
  const bet = { outcome: 'w1', label: 'L', rate: 1.5, reason: 'R' };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item missing outcome', () => {
  const bet = { type: 'one_x_two', label: 'L', rate: 1.5, reason: 'R' };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item missing label', () => {
  const bet = { type: 'one_x_two', outcome: 'w1', rate: 1.5, reason: 'R' };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item rate is not a number', () => {
  const bet = { type: 'one_x_two', outcome: 'w1', label: 'L', rate: '1.5', reason: 'R' };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item missing reason', () => {
  const bet = { type: 'one_x_two', outcome: 'w1', label: 'L', rate: 1.5 };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

test('validateAiBriefOutput: invalid when recommended_bets item confidence is not a number', () => {
  const bet = { type: 'one_x_two', outcome: 'w1', label: 'L', rate: 1.5, reason: 'R', confidence: 'high' };
  const result = validateAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: [bet] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_recommended_bet_item');
});

// --- recommended_bets: generateAiBrief round-trip ---

test('generateAiBrief: ready output includes recommended_bets from LLM response', async () => {
  const outputWithBets = {
    ...VALID_OUTPUT,
    recommended_bets: [
      { type: 'one_x_two', outcome: 'w1', label: 'Победа хозяев', rate: 1.72, reason: 'Фаворит матча.' },
    ],
  };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(outputWithBets)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.output.recommended_bets.length, 1);
  assert.equal(result.output.recommended_bets[0].outcome, 'w1');
  assert.equal(result.output.recommended_bets[0].rate, 1.72);
});

test('generateAiBrief: ready output defaults recommended_bets to empty array when absent', async () => {
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(VALID_OUTPUT)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.output.recommended_bets, []);
});

test('generateAiBrief: fails when recommended_bets is not an array', async () => {
  const bad = { ...VALID_OUTPUT, recommended_bets: 'not-array' };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'invalid_recommended_bets_type');
});

test('generateAiBrief: fails when a recommended_bet item has wrong shape', async () => {
  const bad = { ...VALID_OUTPUT, recommended_bets: [{ type: 'one_x_two', outcome: 'w1' }] };
  const result = await generateAiBrief({
    sourcePayload: SOURCE_PAYLOAD_FULL,
    modelName: 'gpt-4o-mini',
    promptVersion: 'v1',
    provider: makeProvider(JSON.stringify(bad)),
    promptPackDir: makePromptPackDir(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'invalid_recommended_bet_item');
});

// --- recommended_bets: normalizeAiBriefOutput ---

test('normalizeAiBriefOutput: defaults recommended_bets to empty array when absent', () => {
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null });
  assert.deepEqual(result.recommended_bets, []);
});

test('normalizeAiBriefOutput: passes through recommended_bets array', () => {
  const bets = [{ type: 'total', outcome: 'over', label: 'ТБ 2.5', rate: 1.85, reason: 'Обе атакуют.' }];
  const result = normalizeAiBriefOutput({ headline: 'H', brief: 'B', risk_note: null, recommended_bets: bets });
  assert.deepEqual(result.recommended_bets, bets);
});
