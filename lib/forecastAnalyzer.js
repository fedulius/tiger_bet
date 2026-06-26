function normalizeOutcomeLabel(labelRaw) {
  const label = String(labelRaw || '').trim().toUpperCase();

  if (label === '1' || label === 'П1') return 'П1';
  if (label === '2' || label === 'П2') return 'П2';
  if (label === 'X' || label === 'Х' || label === 'НИЧЬЯ') return 'Х';

  return null;
}

function normalizeToOutcome(raw) {
  const canonical = parseCanonicalMarket(raw);
  if (canonical && canonical.type === '1x2') return canonical.pick;
  return normalizeOutcomeLabel(raw);
}

function toNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  return Number(String(raw).replace(',', '.'));
}

function confidenceFromGap(gap) {
  if (gap >= 12) return 'высокая';
  if (gap >= 6) return 'средняя';
  return 'низкая';
}

function extractPercentSignals(html) {
  const text = String(html || '');
  const regex = /(П1|П2|Х|X|Ничья)\s*[:\-–—]?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/gi;
  const outcomes = new Map();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const outcome = normalizeToOutcome(match[1]);
    const percent = toNumber(match[2]);

    if (!outcome || Number.isNaN(percent)) continue;
    if (!outcomes.has(outcome) || outcomes.get(outcome) < percent) {
      outcomes.set(outcome, percent);
    }
  }

  return outcomes;
}

function extractOddsSignals(html) {
  const text = String(html || '');
  const regex = /(П1|П2|Х|X|Ничья)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d{1,3})?)/gi;
  const odds = new Map();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const outcome = normalizeToOutcome(match[1]);
    const odd = toNumber(match[2]);

    if (!outcome || Number.isNaN(odd) || odd <= 1 || odd > 20) continue;
    if (!odds.has(outcome) || odds.get(outcome) > odd) {
      odds.set(outcome, odd);
    }
  }

  return odds;
}

function pickTop(map) {
  let topKey = null;
  let topValue = -Infinity;
  let secondValue = -Infinity;

  for (const [key, value] of map.entries()) {
    if (value > topValue) {
      secondValue = topValue;
      topValue = value;
      topKey = key;
      continue;
    }

    if (value > secondValue) {
      secondValue = value;
    }
  }

  return { topKey, topValue, secondValue };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function parseTeamsFromTitle(html, fallbackMatchName = '') {
  const titleMatch = String(html || '').match(/<title[^>]*>(.*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : fallbackMatchName;
  const source = titleText || fallbackMatchName || '';

  const leftPart = source.split(':')[0];
  const split = leftPart.split(/\s+[—-]\s+/);
  if (split.length >= 2) {
    return [split[0].trim(), split[1].trim()];
  }

  return [];
}

function confidenceFromPercent(percent) {
  if (percent >= 60) return 'высокая';
  if (percent >= 50) return 'средняя';
  return 'низкая';
}

function extractEditorialForecast(html, { matchName = '' } = {}) {
  const { mainForecastZone, editorChoiceZone, articleZone } = extractRecommendationZones(html);

  const editorChoiceText = editorChoiceZone
    ? editorChoiceZone.replace(/^выбор редакции\s*/i, '').trim()
    : '';

  let mainBlockText = '';
  if (mainForecastZone) {
    const colonIdx = mainForecastZone.indexOf(':');
    const after = colonIdx >= 0 ? mainForecastZone.slice(colonIdx + 1) : mainForecastZone.replace(/основной прогноз/i, '');
    mainBlockText = after.replace(/\s+/g, ' ').trim();
  }

  const headlineMatch = articleZone.match(/Прогноз на матч\s*([\s\S]{5,260}?)(?:Основной прогноз|Прогноз на тотал|Поставь на исход|Выбор редакции|$)/i);
  const headlineText = headlineMatch ? headlineMatch[1].replace(/\s+/g, ' ').trim() : '';

  if (!editorChoiceText && !mainBlockText && !headlineText) {
    return null;
  }

  const mainSentences = mainBlockText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const firstMainSentence = mainSentences[0] || '';

  const mainThoughtRaw =
    editorChoiceText ||
    headlineText ||
    firstMainSentence ||
    mainBlockText;

  const mainThought = mainThoughtRaw
    .replace(/^[🎯📊🎮✅☑️▪️\-–—\s]+/u, '')
    .replace(/\s+\d+\s+\d+$/u, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();

  const coeffSource = `${editorChoiceText} ${headlineText} ${mainBlockText}`;
  const coeff = toNumber(coeffSource.match(/(?:кэф(?:ом)?|коэффициент(?:ом)?)\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)/i)?.[1]);
  const probabilityPercent = Number.isFinite(coeff) && coeff > 1
    ? Math.round((1 / coeff) * 100)
    : 0;

  const rationale = mainSentences.slice(1, 3).join(' ').trim();

  return {
    matchName,
    mainThought,
    rationale,
    bestOutcome: mainThought,
    coeff,
    probabilityPercent,
    confidence: confidenceFromPercent(probabilityPercent),
    source: 'editorial-main-forecast',
    explanationLines: [
      '1) Нашел на странице блок с ключом «Основной прогноз».',
      `2) Главная мысль: ${mainThought.slice(0, 140)}${mainThought.length > 140 ? '...' : ''}`,
      `3) Фрагмент обоснования: ${(firstMainSentence || mainBlockText || 'обоснование не выделено').slice(0, 140)}.`,
      `4) Вероятность оценена из коэффициента ${Number.isFinite(coeff) ? coeff : 'н/д'}.`,
    ],
  };
}

function analyzeForecastFromHtml(html, { matchName = '' } = {}) {
  const { mainForecastZone, editorChoiceZone, articleZone } = extractRecommendationZones(html);
  const zoneText = [mainForecastZone, editorChoiceZone, articleZone].filter(Boolean).join(' ');

  const percentSignals = extractPercentSignals(zoneText);

  if (percentSignals.size > 0) {
    const { topKey, topValue, secondValue } = pickTop(percentSignals);
    const gap = Number.isFinite(secondValue) ? topValue - secondValue : topValue;

    return {
      matchName,
      bestOutcome: topKey,
      probabilityPercent: Math.round(topValue),
      confidence: confidenceFromGap(gap),
      source: 'percent-signals',
    };
  }

  const oddsSignals = extractOddsSignals(zoneText);

  if (oddsSignals.size > 0) {
    const implied = new Map();
    let total = 0;

    for (const [outcome, odd] of oddsSignals.entries()) {
      const probability = 1 / odd;
      implied.set(outcome, probability);
      total += probability;
    }

    const normalized = new Map();
    for (const [outcome, probability] of implied.entries()) {
      normalized.set(outcome, (probability / total) * 100);
    }

    const { topKey, topValue, secondValue } = pickTop(normalized);
    const gap = Number.isFinite(secondValue) ? topValue - secondValue : topValue;

    return {
      matchName,
      bestOutcome: topKey,
      probabilityPercent: Math.round(topValue),
      confidence: confidenceFromGap(gap),
      source: 'odds-implied',
    };
  }

  return {
    matchName,
    bestOutcome: 'нет сигнала',
    probabilityPercent: 0,
    confidence: 'низкая',
    source: 'no-signal',
  };
}

function normalizeExplanationLines(analysis = {}) {
  const prepared = Array.isArray(analysis.explanationLines)
    ? analysis.explanationLines
      .map((row) => String(row || '').trim())
      .filter(Boolean)
    : [];

  const defaults = analysis.source === 'no-signal'
    ? [
      '1) На странице матча не найдены стабильные сигналы П1/Х/П2.',
      '2) Коэффициенты или проценты могут быть временно недоступны.',
      '3) Для надежности лучше перепроверить матч ближе к старту.',
      '4) Альтернатива: выбрать другой матч с более полными данными.',
    ]
    : [
      `1) Главная мысль прогноза: ${analysis.mainThought || analysis.bestOutcome || 'н/д'}.`,
      `2) Оценка вероятности: ${Number.isFinite(analysis.probabilityPercent) ? analysis.probabilityPercent : 0}%.`,
      `3) Уровень уверенности: ${analysis.confidence || 'низкая'}.`,
      `4) Источник расчета: ${analysis.source || 'unknown'}.`,
    ];

  const lines = prepared.length > 0 ? prepared : defaults;

  while (lines.length < 4) {
    lines.push(defaults[lines.length] || defaults[defaults.length - 1]);
  }

  return lines.slice(0, 6);
}

function buildBriefForecastText({ team, leagueName, url }, analysis) {
  const link = url ? `https://stavka.tv${url}` : '—';
  const explanationLines = normalizeExplanationLines(analysis);

  if (analysis.source === 'no-signal') {
    return [
      `Матч: ${team}`,
      `Лига: ${leagueName}`,
      '',
      'Краткий анализ: недостаточно сигналов на странице матча.',
      'Уверенность: низкая.',
      `Основание: ${analysis.source}.`,
      'Объяснение:',
      ...explanationLines,
      `Источник: ${link}`,
    ].join('\n');
  }

  return [
    `Матч: ${team}`,
    `Лига: ${leagueName}`,
    '',
    `Краткий анализ: ${analysis.mainThought || `вероятнее исход ${analysis.bestOutcome}`} (${analysis.probabilityPercent}%).`,
    `Уверенность: ${analysis.confidence}.`,
    `Основание: ${analysis.source}.`,
    'Объяснение:',
    ...explanationLines,
    `Источник: ${link}`,
  ].join('\n');
}

const ARTICLE_JUNK_PATTERNS = [
  /Показать еще/gi,
  /Смотреть всю линию/gi,
  /Принять участие/gi,
  /Статистика отсутствует/gi,
  /Бесплатный конкурс прогнозистов/gi,
  /Повторить/gi,
  /Сегодня в\s+\d{1,2}:\d{2}\s+по\s+МСК/gi,
];

function extractRecommendationZones(html, { matchName = '' } = {}) {
  const plainText = htmlToPlainText(html);

  let mainForecastZone = '';
  let editorChoiceZone = '';
  let articleZone = '';

  const mainIdx = plainText.search(/основной прогноз/i);
  if (mainIdx >= 0) {
    const tail = plainText.slice(mainIdx, mainIdx + 1400);
    const stop = tail.search(/Прогноз на тотал:|Поставь на исход|Выбор редакции|Автор прогноза|Прогноз редакции/i);
    mainForecastZone = (stop >= 0 ? tail.slice(0, stop) : tail).replace(/\s+/g, ' ').trim();
  }

  const editorIdx = plainText.search(/выбор редакции/i);
  if (editorIdx >= 0) {
    const tail = plainText.slice(editorIdx, editorIdx + 600);
    const stop = tail.search(/Автор прогноза|Прогноз редакции|Основной прогноз/i);
    editorChoiceZone = (stop >= 0 ? tail.slice(0, stop) : tail).replace(/\s+/g, ' ').trim();
  }

  const articleIdx = plainText.search(/прогноз[ы]? на матч/i);
  if (articleIdx >= 0) {
    const tail = plainText.slice(articleIdx, articleIdx + 4000);
    const stop = tail.search(/Телефон редакции|Почта редакции|Адрес:|Все прогнозы на матч|Бесплатный конкурс прогнозистов|©\s*\d{4}/i);
    let zone = stop >= 0 ? tail.slice(0, stop) : tail;
    for (const pattern of ARTICLE_JUNK_PATTERNS) {
      zone = zone.replace(pattern, ' ');
    }
    articleZone = zone.replace(/\s+/g, ' ').trim();
  }

  return { mainForecastZone, editorChoiceZone, articleZone };
}

function normalizeMarketText(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, ' ');
}

function buildMarketKey(market) {
  if (!market || !market.type) return null;
  switch (market.type) {
    case '1x2': return `1x2:${market.pick}`;
    case 'double-chance': return `double-chance:${market.pick}`;
    case 'total-over': return `total-over:${market.value}`;
    case 'total-under': return `total-under:${market.value}`;
    case 'btts': return `btts:${market.pick}`;
    case 'handicap': return `handicap:${market.team}:${market.value}`;
    case 'indiv-total-over': return `indiv-total-over:${market.team}:${market.value}`;
    case 'indiv-total-under': return `indiv-total-under:${market.team}:${market.value}`;
    default: return null;
  }
}

function formatCanonicalForecast(market) {
  if (!market || !market.type) return null;
  switch (market.type) {
    case '1x2': return market.pick || null;
    case 'double-chance': return market.pick || null;
    case 'total-over': return `Тотал больше ${market.value}`;
    case 'total-under': return `Тотал меньше ${market.value}`;
    case 'btts': return `Обе забьют — ${market.pick}`;
    case 'handicap': return `Фора ${market.team} (${market.value})`;
    case 'indiv-total-over': return `Индивидуальный тотал ${market.team} больше ${market.value}`;
    case 'indiv-total-under': return `Индивидуальный тотал ${market.team} меньше ${market.value}`;
    default: return null;
  }
}

function parseCanonicalMarket(raw) {
  const label = normalizeMarketText(raw);

  // Guard: unclosed parentheses indicate a broken line-table fragment
  if ((label.match(/\(/g) || []).length !== (label.match(/\)/g) || []).length) return null;
  // Guard: line-table rows start with a leading number before a market keyword
  if (/^\d+\s+(ФОРА|ТБ|ТМ|ИТБ|ИТМ)/.test(label)) return null;

  // 1X2
  if (label === 'П1' || label === '1') return { type: '1x2', pick: 'П1' };
  if (label === 'П2' || label === '2') return { type: '1x2', pick: 'П2' };
  if (label === 'Х' || label === 'X' || label === 'НИЧЬЯ') return { type: '1x2', pick: 'Х' };

  // 1X2 — verbose aliases
  if (label === 'ПОБЕДА ХОЗЯЕВ') return { type: '1x2', pick: 'П1' };
  if (label === 'ПОБЕДА ГОСТЕЙ') return { type: '1x2', pick: 'П2' };

  // Double chance — tolerate Latin X and Cyrillic Х interchangeably
  const latNorm = label.replace(/X/g, 'Х');
  if (latNorm === '1Х') return { type: 'double-chance', pick: '1Х' };
  if (latNorm === 'Х2') return { type: 'double-chance', pick: 'Х2' };
  if (label === '12') return { type: 'double-chance', pick: '12' };

  // Double chance — unambiguous "won't lose" aliases
  if (label === 'ХОЗЯЕВА НЕ ПРОИГРАЮТ') return { type: 'double-chance', pick: '1Х' };
  if (label === 'ГОСТИ НЕ ПРОИГРАЮТ') return { type: 'double-chance', pick: 'Х2' };

  // Totals — ТБ/ТМ with optional parentheses: ТБ(2.5) or ТБ 2.5
  let m = label.match(/^ТБ\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'total-over', value: toNumber(m[1]) };
  m = label.match(/^ТМ\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'total-under', value: toNumber(m[1]) };

  // Totals — text form
  m = label.match(/^ТОТАЛ БОЛЬШЕ (\d+(?:[.,]\d+)?)$/);
  if (m) return { type: 'total-over', value: toNumber(m[1]) };
  m = label.match(/^ТОТАЛ МЕНЬШЕ (\d+(?:[.,]\d+)?)$/);
  if (m) return { type: 'total-under', value: toNumber(m[1]) };

  // Both to score
  if (label === 'ОЗ') return { type: 'btts', pick: 'да' };
  if (label === 'ОБЕ ЗАБЬЮТ' || label === 'ОЗ ДА') return { type: 'btts', pick: 'да' };
  if (label === 'ОБЕ НЕ ЗАБЬЮТ' || label === 'ОЗ НЕТ') return { type: 'btts', pick: 'нет' };
  m = label.match(/^ОЗ\s*\(?\s*(ДА|НЕТ)\s*\)?$/);
  if (m) return { type: 'btts', pick: m[1] === 'ДА' ? 'да' : 'нет' };

  // Handicap — Ф1/Ф2 short and text forms
  m = label.match(/^Ф([12])\s*\(?\s*([+-]?\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'handicap', team: parseInt(m[1], 10), value: toNumber(m[2]) };
  m = label.match(/^ФОРА ([12])\s*\(?\s*([+-]?\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'handicap', team: parseInt(m[1], 10), value: toNumber(m[2]) };

  // Individual totals — ИТБ/ИТМ short and text forms
  m = label.match(/^ИТБ([12])\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'indiv-total-over', team: parseInt(m[1], 10), value: toNumber(m[2]) };
  m = label.match(/^ИТМ([12])\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?$/);
  if (m) return { type: 'indiv-total-under', team: parseInt(m[1], 10), value: toNumber(m[2]) };
  m = label.match(/^ИНДИВИДУАЛЬНЫЙ ТОТАЛ ([12]) БОЛЬШЕ (\d+(?:[.,]\d+)?)$/);
  if (m) return { type: 'indiv-total-over', team: parseInt(m[1], 10), value: toNumber(m[2]) };
  m = label.match(/^ИНДИВИДУАЛЬНЫЙ ТОТАЛ ([12]) МЕНЬШЕ (\d+(?:[.,]\d+)?)$/);
  if (m) return { type: 'indiv-total-under', team: parseInt(m[1], 10), value: toNumber(m[2]) };

  return null;
}

function buildBetCandidate(rawForecast, market, coeff, sourceZone, sourcePriority, description, evidenceSnippet) {
  const coeffNum = toNumber(coeff);
  return {
    rawForecast,
    canonicalForecast: market ? formatCanonicalForecast(market) : null,
    marketKey: market ? buildMarketKey(market) : null,
    marketType: (market && market.type) ? market.type : null,
    coeff: (Number.isFinite(coeffNum) && coeffNum > 0) ? coeffNum : null,
    sourceZone,
    sourcePriority,
    description,
    evidenceSnippet,
  };
}

function extractSingleCoeffFromText(text) {
  const keywordRe = /(?:кэф(?:ом)?|коэффициент(?:ом)?)\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)/gi;
  const keywordHits = [];
  let m;
  while ((m = keywordRe.exec(text)) !== null) {
    const v = toNumber(m[1]);
    if (Number.isFinite(v) && v > 1 && v <= 20) keywordHits.push(v);
  }
  if (keywordHits.length > 0) {
    const unique = [...new Set(keywordHits)];
    return unique.length === 1 ? unique[0] : null;
  }

  const plainRe = /\b(\d{1,2}[.,]\d{1,3})\b/g;
  const plainHits = [];
  while ((m = plainRe.exec(text)) !== null) {
    const v = toNumber(m[1]);
    if (Number.isFinite(v) && v > 1 && v <= 20) plainHits.push(v);
  }
  const unique = [...new Set(plainHits)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;
  return null;
}

function sentenceContainsForecast(sentenceLower, lowerForecast) {
  if (sentenceLower.includes(lowerForecast)) return true;
  // Russian morphology fallback: strip last 2 chars of long words to match inflected forms
  const words = lowerForecast.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => {
    const stem = w.length > 4 ? w.slice(0, w.length - 2) : w;
    return sentenceLower.includes(stem);
  });
}

const ZONE_MULTI_WORD_PATTERNS = [
  /обе не забьют/gi,
  /обе забьют/gi,
  /победа хозяев/gi,
  /победа гостей/gi,
  /хозяева не проиграют/gi,
  /гости не проиграют/gi,
  /индивидуальный тотал [12] (?:больше|меньше) \d+(?:[.,]\d+)?/gi,
  /тотал (?:больше|меньше) \d+(?:[.,]\d+)?/gi,
  /тб\s*\(?\s*\d+(?:[.,]\d+)?\s*\)?/gi,
  /тм\s*\(?\s*\d+(?:[.,]\d+)?\s*\)?/gi,
  /итб[12]\s*\(?\s*\d+(?:[.,]\d+)?\s*\)?/gi,
  /итм[12]\s*\(?\s*\d+(?:[.,]\d+)?\s*\)?/gi,
  /фора [12]\s*\(?\s*[+-]?\d+(?:[.,]\d+)?\s*\)?/gi,
  /ф[12]\s*\(?\s*[+-]?\d+(?:[.,]\d+)?\s*\)?/gi,
  /оз\s*\(?\s*(?:да|нет)\s*\)?/gi,
];

const ZONE_SHORT_LABELS = ['П1', 'П2', '1Х', 'Х2', '1X', 'X2', '12', 'Х', 'X', 'ничья', 'ОЗ'];
const NON_ALNUM_RE = /[^а-яёА-ЯЁa-zA-Z0-9]/;

function extractBetCandidatesFromZone(zoneText, sourceZone, sourcePriority) {
  const text = String(zoneText || '');
  if (!text.trim()) return [];

  const mentions = [];

  for (const re of ZONE_MULTI_WORD_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      mentions.push({ raw: m[0].trim(), index: m.index });
    }
  }

  for (const label of ZONE_SHORT_LABELS) {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = m.index > 0 ? text[m.index - 1] : ' ';
      const after = m.index + m[0].length < text.length ? text[m.index + m[0].length] : ' ';
      if (NON_ALNUM_RE.test(before) && NON_ALNUM_RE.test(after)) {
        mentions.push({ raw: m[0], index: m.index });
      }
    }
  }

  mentions.sort((a, b) => a.index - b.index);

  const seenKeys = new Set();
  const candidates = [];

  for (const { raw, index } of mentions) {
    const market = parseCanonicalMarket(raw);
    if (!market) continue;
    const key = buildMarketKey(market);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const coeff = resolveLocalCoeffNearForecast(raw, text);
    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + raw.length + 40);
    const evidenceSnippet = text.slice(start, end).trim();
    candidates.push(buildBetCandidate(raw, market, coeff, sourceZone, sourcePriority, null, evidenceSnippet));
  }

  return candidates;
}

function resolveLocalCoeffNearForecast(rawForecast, zoneText, evidenceSnippet = '') {
  const text = String(zoneText || '');
  const forecast = String(rawForecast || '').trim();
  if (!forecast || !text) return null;

  const sentences = text.split(/(?<=[.!?])\s+/);
  const lowerForecast = forecast.toLowerCase();
  const idx = sentences.findIndex((s) => sentenceContainsForecast(s.toLowerCase(), lowerForecast));

  if (idx === -1) {
    return evidenceSnippet ? extractSingleCoeffFromText(String(evidenceSnippet)) : null;
  }

  const sameSentenceResult = extractSingleCoeffFromText(sentences[idx]);
  if (sameSentenceResult !== null) return sameSentenceResult;

  // Narrow neighboring window: at most one sentence on each side
  const lo = Math.max(0, idx - 1);
  const hi = Math.min(sentences.length - 1, idx + 1);
  const windowText = sentences.slice(lo, hi + 1).join(' ');
  return extractSingleCoeffFromText(windowText);
}

function collectCandidatesAcrossZones({ mainForecastZone, editorChoiceZone, articleZone }) {
  const zones = [
    [mainForecastZone, 'mainForecastZone', 1],
    [editorChoiceZone, 'editorChoiceZone', 1],
    [articleZone, 'articleZone', 2],
  ];

  const all = [];
  for (const [zone, zoneName, priority] of zones) {
    if (zone) {
      all.push(...extractBetCandidatesFromZone(zone, zoneName, priority));
    }
  }

  const best = new Map();
  for (const candidate of all) {
    const key = candidate.marketKey;
    if (!key) continue;
    if (!best.has(key)) {
      best.set(key, candidate);
      continue;
    }
    const existing = best.get(key);
    if (candidate.sourcePriority < existing.sourcePriority) {
      best.set(key, candidate);
      continue;
    }
    if (candidate.sourcePriority === existing.sourcePriority) {
      if (existing.coeff === null && candidate.coeff !== null) {
        best.set(key, candidate);
      }
    }
  }

  return [...best.values()];
}

const DESCRIPTION_JUNK_PATTERNS = [
  /Показать еще/i,
  /Смотреть всю линию/i,
  /Принять участие/i,
  /Статистика отсутствует/i,
  /Повторить/i,
  /Сегодня в\s+\d{1,2}:\d{2}\s+по\s+МСК/i,
  /Телефон редакции/i,
  /Почта редакции/i,
  /Адрес:/i,
];

function sanitizeCandidateDescription(desc) {
  let text = String(desc || '');
  for (const pattern of DESCRIPTION_JUNK_PATTERNS) {
    text = text.replace(pattern, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

function scoreBetCandidate(candidate = {}) {
  let score = 0;

  if (candidate.marketKey) score += 3;
  if (candidate.marketType) score += 3;
  if (Number.isFinite(candidate.coeff) && candidate.coeff > 0) score += 3;

  const rawDesc = String(candidate.description || '').trim();
  const desc = sanitizeCandidateDescription(rawDesc);
  const hasJunk = rawDesc && DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(rawDesc));
  if (hasJunk) {
    score -= 3;
  } else if (desc) {
    score += 1;
  } else if (rawDesc) {
    score -= 5;
  }

  if (candidate.sourceZone === 'mainForecastZone') score += 2;
  else if (candidate.sourceZone === 'editorChoiceZone') score += 1;
  else if (candidate.sourceZone === 'articleZone') score += 0;

  return score;
}

function isCandidateAcceptable(candidate = {}) {
  if (!candidate.marketKey) return false;
  if (!candidate.marketType) return false;
  if (!Number.isFinite(candidate.coeff) || candidate.coeff <= 0) return false;
  return true;
}

module.exports = {
  analyzeForecastFromHtml,
  buildBriefForecastText,
  normalizeExplanationLines,
  extractEditorialForecast,
  extractRecommendationZones,
  parseCanonicalMarket,
  normalizeMarketText,
  buildMarketKey,
  formatCanonicalForecast,
  buildBetCandidate,
  resolveLocalCoeffNearForecast,
  extractBetCandidatesFromZone,
  collectCandidatesAcrossZones,
  sanitizeCandidateDescription,
  scoreBetCandidate,
  isCandidateAcceptable,
};
