const fs = require('fs');
const path = require('path');
const request = require('request');
const {
  analyzeForecastFromHtml,
  normalizeExplanationLines,
  extractEditorialForecast,
} = require('./forecastAnalyzer');

function readEnvLikeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = content.split('\n');
    const map = {};

    for (const raw of rows) {
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

function confidenceFromPercent(percent) {
  if (percent >= 60) return 'высокая';
  if (percent >= 50) return 'средняя';
  return 'низкая';
}

class AIForecastProvider {
  async getMatchForecast({ team, url }) {
    const html = await this.#requestMatchPage(url);

    const editorial = extractEditorialForecast(html, { matchName: team });
    if (editorial && editorial.mainThought) {
      return {
        ...editorial,
        explanationLines: normalizeExplanationLines(editorial),
      };
    }

    const heuristic = analyzeForecastFromHtml(html, { matchName: team });

    const aiResult = await this.#requestAI({ team, url, html, heuristic });
    if (!aiResult) {
      return {
        ...heuristic,
        explanationLines: normalizeExplanationLines(heuristic),
      };
    }

    const probabilityPercent = Number(aiResult.probabilityPercent);

    const normalized = {
      bestOutcome: aiResult.bestOutcome || heuristic.bestOutcome,
      probabilityPercent: Number.isFinite(probabilityPercent)
        ? Math.max(0, Math.min(100, Math.round(probabilityPercent)))
        : heuristic.probabilityPercent,
      confidence: aiResult.confidence || confidenceFromPercent(probabilityPercent),
      source: 'ai-llm',
      explanationLines: normalizeExplanationLines({
        ...heuristic,
        ...aiResult,
        source: 'ai-llm',
      }),
    };

    return normalized;
  }

  async #requestAI({ team, url, html, heuristic }) {
    const openRouterKey = resolveKey('OPENROUTER_API_KEY');
    const openAIKey = resolveKey('OPENAI_API_KEY');

    if (!openRouterKey && !openAIKey) {
      return null;
    }

    const compactHtml = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);

    const payload = {
      match: team,
      url,
      heuristic,
      page_excerpt: compactHtml,
    };

    const instruction = [
      'Ты аналитик спортивных прогнозов для Telegram.',
      'Верни ТОЛЬКО JSON-объект без markdown.',
      'Формат JSON:',
      '{"bestOutcome":"П1|Х|П2","probabilityPercent":number,"confidence":"низкая|средняя|высокая","explanationLines":["...","...","...","..."]}',
      'explanationLines: от 4 до 6 коротких строк на русском.',
      'Не выдумывай факты, используй только переданные сигналы.',
    ].join('\n');

    try {
      if (openRouterKey) {
        const model = resolveKey('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: instruction },
              { role: 'user', content: JSON.stringify(payload) },
            ],
          }),
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        return parseJsonFromText(content);
      }

      const model = resolveKey('OPENAI_MODEL') || 'gpt-4o-mini';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAIKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: instruction },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      return parseJsonFromText(content);
    } catch {
      return null;
    }
  }

  #requestMatchPage(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('Match url is required'));
        return;
      }

      request.get({
        headers: { 'content-type': 'text/html;charset=utf-8' },
        url: `https://stavka.tv${url}`,
      }, (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(body);
      });
    });
  }
}

module.exports = AIForecastProvider;
