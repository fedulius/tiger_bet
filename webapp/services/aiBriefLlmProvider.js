'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

function readEnvLikeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const map = {};
    for (const raw of content.split('\n')) {
      const row = raw.trim();
      if (!row || row.startsWith('#')) continue;
      const idx = row.indexOf('=');
      if (idx <= 0) continue;
      const key = row.slice(0, idx).trim();
      const value = row.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, '');
      map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function resolveKey(name) {
  if (process.env[name]) return process.env[name];
  const cwdEnv = readEnvLikeFile(path.join(process.cwd(), '.env'));
  if (cwdEnv[name]) return cwdEnv[name];
  return null;
}

function resolveProviderConfig() {
  const openrouterKey = resolveKey('OPENROUTER_API_KEY');
  if (openrouterKey) {
    return {
      apiKey: openrouterKey,
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: resolveKey('OPENROUTER_MODEL') || 'openai/gpt-4o-mini',
    };
  }

  const openaiKey = resolveKey('OPENAI_API_KEY');
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      model: resolveKey('OPENAI_MODEL') || 'gpt-4o-mini',
    };
  }

  return null;
}

function buildMessages({ systemPrompt, userPrompt, fewShots }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (Array.isArray(fewShots)) {
    for (const shot of fewShots) {
      if (shot && typeof shot.role === 'string' && typeof shot.content === 'string') {
        messages.push({ role: shot.role, content: shot.content });
      }
    }
  }

  messages.push({ role: 'user', content: userPrompt });
  return messages;
}

async function defaultHttpClient({ url, apiKey, body }) {
  const bodyJson = JSON.stringify(body);
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyJson),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          reject(new Error(`response_parse_error: ${data.slice(0, 200)}`));
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${parsed.error?.message || parsed.message || data.slice(0, 200)}`));
        } else {
          resolve(parsed);
        }
      });
    });

    req.on('error', reject);
    req.write(bodyJson);
    req.end();
  });
}

function createAiBriefLlmProvider(httpClient = defaultHttpClient) {
  return async function({ systemPrompt, userPrompt, modelName, fewShots, responseFormat }) {
    const config = resolveProviderConfig();
    if (!config) throw new Error('no_llm_provider_key');

    const resolvedModel = modelName || config.model;
    const messages = buildMessages({ systemPrompt, userPrompt, fewShots });
    const response = await httpClient({
      url: config.baseUrl,
      apiKey: config.apiKey,
      body: {
        model: resolvedModel,
        messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      },
    });

    return {
      text: response.choices?.[0]?.message?.content ?? null,
      prompt_tokens: response.usage?.prompt_tokens ?? null,
      completion_tokens: response.usage?.completion_tokens ?? null,
    };
  };
}

const aiBriefLlmProvider = createAiBriefLlmProvider();

module.exports = { aiBriefLlmProvider, createAiBriefLlmProvider, resolveProviderConfig, buildMessages, readEnvLikeFile, resolveKey };
