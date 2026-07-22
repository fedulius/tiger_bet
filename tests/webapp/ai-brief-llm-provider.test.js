'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  aiBriefLlmProvider,
  createAiBriefLlmProvider,
  resolveProviderConfig,
  buildMessages,
  readEnvLikeFile,
  resolveKey,
} = require('../../webapp/services/aiBriefLlmProvider');

// Saves and restores a set of env vars around a (possibly async) fn
async function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL'];
const CLEAN_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, undefined]));

// --- resolveProviderConfig ---

test('resolveProviderConfig: returns null when no keys set', () =>
  withTmpCwd(() =>
    withEnv(CLEAN_ENV, () => {
      assert.strictEqual(resolveProviderConfig(), null);
    }),
  ));

test('resolveProviderConfig: returns openrouter config when OPENROUTER_API_KEY is set', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-key-123' }, () => {
    const config = resolveProviderConfig();
    assert.strictEqual(config.apiKey, 'or-key-123');
    assert.match(config.baseUrl, /openrouter\.ai/);
    assert.strictEqual(config.model, 'openai/gpt-4o-mini');
  }));

test('resolveProviderConfig: respects OPENROUTER_MODEL override', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-key', OPENROUTER_MODEL: 'mistralai/mistral-7b' }, () => {
    const config = resolveProviderConfig();
    assert.strictEqual(config.model, 'mistralai/mistral-7b');
  }));

test('resolveProviderConfig: prefers openrouter over openai when both keys present', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-key', OPENAI_API_KEY: 'oa-key' }, () => {
    const config = resolveProviderConfig();
    assert.strictEqual(config.apiKey, 'or-key');
    assert.match(config.baseUrl, /openrouter\.ai/);
  }));

test('resolveProviderConfig: falls back to openai when only OPENAI_API_KEY is set', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-testkey' }, () => {
    const config = resolveProviderConfig();
    assert.strictEqual(config.apiKey, 'sk-testkey');
    assert.match(config.baseUrl, /api\.openai\.com/);
    assert.strictEqual(config.model, 'gpt-4o-mini');
  }));

test('resolveProviderConfig: respects OPENAI_MODEL override', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-testkey', OPENAI_MODEL: 'gpt-4o' }, () => {
    const config = resolveProviderConfig();
    assert.strictEqual(config.model, 'gpt-4o');
  }));

// --- buildMessages ---

test('buildMessages: builds system + user without few-shots', () => {
  const messages = buildMessages({ systemPrompt: 'SYS', userPrompt: 'USR', fewShots: [] });
  assert.deepEqual(messages, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USR' },
  ]);
});

test('buildMessages: injects few-shot messages with role+content', () => {
  const fewShots = [
    { role: 'user', content: 'Example input' },
    { role: 'assistant', content: 'Example output' },
  ];
  const messages = buildMessages({ systemPrompt: 'SYS', userPrompt: 'USR', fewShots });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[1], fewShots[0]);
  assert.deepEqual(messages[2], fewShots[1]);
  assert.deepEqual(messages[3], { role: 'user', content: 'USR' });
});

test('buildMessages: skips few-shots without role or content', () => {
  const fewShots = [
    { id: 'shot-1' },
    { role: 'user' },
    { content: 'no role' },
    null,
  ];
  const messages = buildMessages({ systemPrompt: 'SYS', userPrompt: 'USR', fewShots });
  assert.equal(messages.length, 2);
});

test('buildMessages: handles null/undefined fewShots gracefully', () => {
  for (const fewShots of [null, undefined]) {
    const messages = buildMessages({ systemPrompt: 'SYS', userPrompt: 'USR', fewShots });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
  }
});

// --- createAiBriefLlmProvider (request shaping + response parsing) ---

test('createAiBriefLlmProvider: throws when no env key configured', () =>
  withTmpCwd(() =>
    withEnv(CLEAN_ENV, async () => {
      const provider = createAiBriefLlmProvider(async () => { throw new Error('should not call http'); });
      await assert.rejects(
        () => provider({ systemPrompt: 'S', userPrompt: 'U', modelName: null, fewShots: [] }),
        (err) => {
          assert.match(err.message, /no_llm_provider_key/);
          return true;
        },
      );
    }),
  ));

test('createAiBriefLlmProvider: shapes request with correct model and messages', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-key', OPENROUTER_MODEL: 'openai/gpt-4o-mini' }, async () => {
    let capturedCall = null;
    const fakeHttp = async (call) => {
      capturedCall = call;
      return { choices: [{ message: { content: '{"headline":"H","brief":"B"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    };

    const provider = createAiBriefLlmProvider(fakeHttp);
    await provider({ systemPrompt: 'SYS', userPrompt: 'USR', modelName: null, fewShots: [] });

    assert.ok(capturedCall, 'http client should be called');
    assert.match(capturedCall.url, /openrouter\.ai/);
    assert.strictEqual(capturedCall.apiKey, 'or-key');
    assert.strictEqual(capturedCall.body.model, 'openai/gpt-4o-mini');
    assert.deepEqual(capturedCall.body.messages, [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  }));

test('createAiBriefLlmProvider: includes response_format only when supplied', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-key' }, async () => {
    const calls = [];
    const provider = createAiBriefLlmProvider(async (call) => {
      calls.push(call);
      return { choices: [{ message: { content: '{}' } }], usage: {} };
    });
    const responseFormat = { type: 'json_schema', json_schema: { name: 'pick', strict: true, schema: { type: 'object' } } };

    await provider({ systemPrompt: 'S', userPrompt: 'U', fewShots: [] });
    await provider({ systemPrompt: 'S', userPrompt: 'U', fewShots: [], responseFormat });

    assert.equal(Object.hasOwn(calls[0].body, 'response_format'), false);
    assert.deepEqual(calls[1].body.response_format, responseFormat);
  }));

test('createAiBriefLlmProvider: modelName overrides config default', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-key' }, async () => {
    let capturedModel = null;
    const fakeHttp = async ({ body }) => {
      capturedModel = body.model;
      return { choices: [{ message: { content: 'text' } }], usage: {} };
    };

    const provider = createAiBriefLlmProvider(fakeHttp);
    await provider({ systemPrompt: 'S', userPrompt: 'U', modelName: 'gpt-4o', fewShots: [] });

    assert.strictEqual(capturedModel, 'gpt-4o');
  }));

test('createAiBriefLlmProvider: returns text and token counts from response', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-key' }, async () => {
    const fakeHttp = async () => ({
      choices: [{ message: { content: 'response text' } }],
      usage: { prompt_tokens: 42, completion_tokens: 17 },
    });

    const provider = createAiBriefLlmProvider(fakeHttp);
    const result = await provider({ systemPrompt: 'S', userPrompt: 'U', modelName: null, fewShots: [] });

    assert.strictEqual(result.text, 'response text');
    assert.strictEqual(result.prompt_tokens, 42);
    assert.strictEqual(result.completion_tokens, 17);
  }));

test('createAiBriefLlmProvider: returns null tokens when usage is absent', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-key' }, async () => {
    const fakeHttp = async () => ({ choices: [{ message: { content: 'text' } }] });

    const provider = createAiBriefLlmProvider(fakeHttp);
    const result = await provider({ systemPrompt: 'S', userPrompt: 'U', modelName: null, fewShots: [] });

    assert.strictEqual(result.prompt_tokens, null);
    assert.strictEqual(result.completion_tokens, null);
  }));

test('createAiBriefLlmProvider: propagates http client errors', () =>
  withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: 'sk-key' }, async () => {
    const fakeHttp = async () => { throw new Error('network_timeout'); };

    const provider = createAiBriefLlmProvider(fakeHttp);
    await assert.rejects(
      () => provider({ systemPrompt: 'S', userPrompt: 'U', modelName: null, fewShots: [] }),
      (err) => {
        assert.match(err.message, /network_timeout/);
        return true;
      },
    );
  }));

test('createAiBriefLlmProvider: uses openrouter url when OPENROUTER_API_KEY set', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-k', OPENAI_API_KEY: 'oa-k' }, async () => {
    let capturedUrl = null;
    const fakeHttp = async ({ url }) => {
      capturedUrl = url;
      return { choices: [{ message: { content: '' } }], usage: {} };
    };

    const provider = createAiBriefLlmProvider(fakeHttp);
    await provider({ systemPrompt: 'S', userPrompt: 'U', modelName: null, fewShots: [] });

    assert.match(capturedUrl, /openrouter\.ai/, 'should route to openrouter when OPENROUTER_API_KEY is set');
  }));

// --- aiBriefLlmProvider export is a function ---

test('aiBriefLlmProvider: exported singleton is a function', () => {
  assert.strictEqual(typeof aiBriefLlmProvider, 'function');
});

// --- readEnvLikeFile ---

test('readEnvLikeFile: parses key=value pairs from a file', () => {
  const tmp = path.join(os.tmpdir(), `ai-brief-test-${process.pid}.env`);
  fs.writeFileSync(tmp, 'FOO=bar\nBAZ=qux\n', 'utf-8');
  try {
    const map = readEnvLikeFile(tmp);
    assert.strictEqual(map.FOO, 'bar');
    assert.strictEqual(map.BAZ, 'qux');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('readEnvLikeFile: strips surrounding quotes from values', () => {
  const tmp = path.join(os.tmpdir(), `ai-brief-test-${process.pid}.env`);
  fs.writeFileSync(tmp, "KEY1='val1'\nKEY2=\"val2\"\n", 'utf-8');
  try {
    const map = readEnvLikeFile(tmp);
    assert.strictEqual(map.KEY1, 'val1');
    assert.strictEqual(map.KEY2, 'val2');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('readEnvLikeFile: skips blank lines and comments', () => {
  const tmp = path.join(os.tmpdir(), `ai-brief-test-${process.pid}.env`);
  fs.writeFileSync(tmp, '# comment\n\nACTUAL=yes\n', 'utf-8');
  try {
    const map = readEnvLikeFile(tmp);
    assert.strictEqual(Object.keys(map).length, 1);
    assert.strictEqual(map.ACTUAL, 'yes');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('readEnvLikeFile: returns empty object for missing file', () => {
  const map = readEnvLikeFile('/tmp/__nonexistent_ai_brief_test__.env');
  assert.deepEqual(map, {});
});

// --- cwd .env fallback via withDotEnv ---

// Runs fn with process.cwd() pointing to a fresh empty temp dir (no .env).
async function withTmpCwd(fn) {
  const origCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-brief-test-cwd-'));
  try {
    process.chdir(tmp);
    return await fn();
  } finally {
    process.chdir(origCwd);
    try { fs.rmdirSync(tmp); } catch {}
  }
}

// Saves, replaces, and restores process.cwd()/.env around an async fn.
async function withDotEnv(content, fn) {
  const dotEnvPath = path.join(process.cwd(), '.env');
  let original;
  let existed = false;
  try {
    original = fs.readFileSync(dotEnvPath, 'utf-8');
    existed = true;
  } catch {
    existed = false;
  }
  fs.writeFileSync(dotEnvPath, content, 'utf-8');
  try {
    return await fn();
  } finally {
    if (existed) {
      fs.writeFileSync(dotEnvPath, original, 'utf-8');
    } else {
      try { fs.unlinkSync(dotEnvPath); } catch {}
    }
  }
}

test('resolveProviderConfig: reads OPENROUTER_API_KEY from cwd .env when not in process.env', () =>
  withEnv(CLEAN_ENV, () =>
    withDotEnv('OPENROUTER_API_KEY=dotenv-or-key\n', () => {
      const config = resolveProviderConfig();
      assert.ok(config, 'config should not be null');
      assert.strictEqual(config.apiKey, 'dotenv-or-key');
      assert.match(config.baseUrl, /openrouter\.ai/);
    }),
  ));

test('resolveProviderConfig: reads OPENAI_API_KEY from cwd .env when not in process.env', () =>
  withEnv(CLEAN_ENV, () =>
    withDotEnv('OPENAI_API_KEY=dotenv-sk-key\n', () => {
      const config = resolveProviderConfig();
      assert.ok(config, 'config should not be null');
      assert.strictEqual(config.apiKey, 'dotenv-sk-key');
      assert.match(config.baseUrl, /api\.openai\.com/);
    }),
  ));

test('resolveProviderConfig: process.env takes priority over cwd .env', () =>
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'env-key' }, () =>
    withDotEnv('OPENROUTER_API_KEY=dotenv-key\n', () => {
      const config = resolveProviderConfig();
      assert.strictEqual(config.apiKey, 'env-key');
    }),
  ));

test('resolveProviderConfig: reads OPENROUTER_MODEL from cwd .env', () =>
  withEnv(CLEAN_ENV, () =>
    withDotEnv('OPENROUTER_API_KEY=dotenv-or-key\nOPENROUTER_MODEL=mistralai/mistral-7b\n', () => {
      const config = resolveProviderConfig();
      assert.strictEqual(config.model, 'mistralai/mistral-7b');
    }),
  ));

test('resolveProviderConfig: returns null when no keys in env or cwd .env', () =>
  withEnv(CLEAN_ENV, () =>
    withDotEnv('UNRELATED_KEY=something\n', () => {
      const config = resolveProviderConfig();
      assert.strictEqual(config, null);
    }),
  ));
