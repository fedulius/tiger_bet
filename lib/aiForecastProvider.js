const fs = require('fs');
const path = require('path');
const request = require('request');

// Inlined from forecastAnalyzer (deleted)
function htmlToPlainText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function decodeHtmlEntities(t) { return String(t||'').replace(/&quot;|&#34;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&laquo;/gi,'«').replace(/&raquo;/gi,'»').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&'); }
function extractRecommendationZones(html) {
  var pt = decodeHtmlEntities(htmlToPlainText(html));
  var m = {}, e = {}, a = '';
  var mi = pt.search(/основной прогноз/i); if (mi >= 0) { var t = pt.slice(mi, mi+1400); var s = t.search(/Прогноз на тотал:|Поставь на исход|Выбор редакции|Автор прогноза/i); m = (s>=0?t.slice(0,s):t).replace(/\s+/g,' ').trim(); }
  var ei = pt.search(/выбор редакции/i); if (ei >= 0) { var t2 = pt.slice(ei, ei+600); var s2 = t2.search(/Автор прогноза|Основной прогноз/i); e = (s2>=0?t2.slice(0,s2):t2).replace(/\s+/g,' ').trim(); }
  var ai = pt.search(/прогноз[ы]? на матч/i); if (ai >= 0) { var t3 = pt.slice(ai, ai+4000); var s3 = t3.search(/Телефон редакции|Почта редакции|Все прогнозы на матч|©\s*\d{4}/i); a = (s3>=0?t3.slice(0,s3):t3).replace(/\s+/g,' ').trim(); }
  return { mainForecastZone: m, editorChoiceZone: e, articleZone: a };
}
function extractEditorialForecast(html, opts) {
  var z = extractRecommendationZones(html); var mn = (opts&&opts.matchName)||'';
  var et = z.editorChoiceZone?z.editorChoiceZone.replace(/^выбор редакции\s*/i,'').trim():'';
  var mt=''; if(z.mainForecastZone){var ci=z.mainForecastZone.indexOf(':');mt=(ci>=0?z.mainForecastZone.slice(ci+1):z.mainForecastZone.replace(/основной прогноз/i,'')).replace(/\s+/g,' ').trim();}
  var hl=z.articleZone.match(/Прогноз на матч\s*([\s\S]{5,260}?)(?:Основной прогноз|Поставь на исход|Выбор редакции|$)/i);
  var ht=hl?hl[1].replace(/\s+/g,' ').trim():'';
  if(!et&&!mt&&!ht)return null;
  var ms=mt.split(/(?<=[.!?])\s+/).map(function(s){return s.trim();}).filter(Boolean);
  var raw=et||ht||ms[0]||mt;
  var main=raw.replace(/^[🎯📊🎮✅☑️▪️\-–—\s]+/u,'').replace(/\s+\d+\s+\d+$/u,'').replace(/\s+/g,' ').replace(/\.+$/g,'').trim();
  var cs=et+' '+ht+' '+mt; var c=Number((cs.match(/(?:кэф(?:ом)?|коэффициент(?:ом)?)\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)/i)||[])[1]||'NaN');
  var pp=Number.isFinite(c)&&c>1?Math.round((1/c)*100):0;
  return {matchName:mn,mainThought:main,rationale:ms.slice(1,3).join(' ').trim(),bestOutcome:main,coeff:c,probabilityPercent:pp,confidence:pp>=60?'высокая':pp>=50?'средняя':'низкая',source:'editorial-main-forecast'};
}
function normalizeExplanationLines(a) {
  a=a||{};
  var p=Array.isArray(a.explanationLines)?a.explanationLines.map(function(r){return String(r||'').trim();}).filter(Boolean):[];
  var d=a.source==='no-signal'?['Недостаточно сигналов.','Коэффициенты недоступны.','Перепроверьте матч.','Выберите другой матч.']:['Мысль: '+(a.mainThought||a.bestOutcome||'н/д')+'.','Вероятность: '+(Number.isFinite(a.probabilityPercent)?a.probabilityPercent:0)+'%.','Уверенность: '+(a.confidence||'низкая')+'.','Источник: '+(a.source||'unknown')+'.'];
  var l=p.length>0?p:d; while(l.length<4)l.push(d[l.length]||d[d.length-1]); return l.slice(0,6);
}
function confidenceFromPercent(percent) { if(percent>=60)return'высокая'; if(percent>=50)return'средняя'; return'низкая'; }
function analyzeForecastFromHtml(html, opts) {
  var z=extractRecommendationZones(html); var mn=(opts&&opts.matchName)||'';
  var zt=[z.mainForecastZone,z.editorChoiceZone,z.articleZone].filter(Boolean).join(' ');
  var pr=/\b(П1|П2|Х|X|Ничья)\s*[:\u2011\u2013\u2014]?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/gi; var om={}; var mt; while((mt=pr.exec(zt))!==null){var ok=mt[1].toUpperCase();if(ok==='X')ok='Х';if(ok==='1')ok='П1';if(ok==='2')ok='П2';var v=Number(mt[2].replace(',','.'));if(!Number.isNaN(v)){if(!om[ok]||om[ok]<v)om[ok]=v;}}
  if(Object.keys(om).length>0){var bk='',bv=-Infinity,sv=-Infinity; for(var k in om){if(om[k]>bv){sv=bv;bv=om[k];bk=k;}else if(om[k]>sv){sv=om[k];}} var gap=Number.isFinite(sv)?bv-sv:bv; return{matchName:mn, bestOutcome:bk, probabilityPercent:Math.round(bv), confidence:gap>=12?'высокая':gap>=6?'средняя':'низкая', source:'percent-signals'};}
  var or2=/\b(П1|П2|Х|X|Ничья)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d{1,3})?)/gi; var om2={}; var mt2; while((mt2=or2.exec(zt))!==null){var ok2=mt2[1].toUpperCase();if(ok2==='X')ok2='Х';var ov=Number(mt2[2].replace(',','.'));if(!Number.isNaN(ov)&&ov>1&&ov<=20){if(!om2[ok2]||om2[ok2]>ov)om2[ok2]=ov;}}
  if(Object.keys(om2).length>0){var tot=0;var imp={};for(var k2 in om2){var p2=1/om2[k2];imp[k2]=p2;tot+=p2;}var norm={};for(var k3 in imp){norm[k3]=(imp[k3]/tot)*100;}var bk2='',bv2=-Infinity,sv2=-Infinity;for(var k4 in norm){if(norm[k4]>bv2){sv2=bv2;bv2=norm[k4];bk2=k4;}else if(norm[k4]>sv2){sv2=norm[k4];}}var gap2=Number.isFinite(sv2)?bv2-sv2:bv2;return{matchName:mn, bestOutcome:bk2, probabilityPercent:Math.round(bv2), confidence:gap2>=12?'высокая':gap2>=6?'средняя':'низкая', source:'odds-implied'};}
  return{matchName:mn, bestOutcome:'нет сигнала', probabilityPercent:0, confidence:'низкая', source:'no-signal'};
}

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
