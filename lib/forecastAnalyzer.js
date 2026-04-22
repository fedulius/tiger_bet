function normalizeOutcomeLabel(labelRaw) {
  const label = String(labelRaw || '').trim().toUpperCase();

  if (label === '1' || label === 'П1') return 'П1';
  if (label === '2' || label === 'П2') return 'П2';
  if (label === 'X' || label === 'Х' || label === 'НИЧЬЯ') return 'Х';

  return null;
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
  const regex = /(П1|П2|Х|X|Ничья)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/gi;
  const outcomes = new Map();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const outcome = normalizeOutcomeLabel(match[1]);
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
    const outcome = normalizeOutcomeLabel(match[1]);
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

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const plainText = htmlToPlainText(html);
  if (!plainText) return null;

  const blockMatch = plainText.match(/Прогноз на матч[\s\S]{0,250}?:\s*([\s\S]{5,260}?)(?:Основной прогноз:|Прогноз на тотал:|Поставь на исход|$)/i);
  if (!blockMatch) {
    return null;
  }

  const editorialText = blockMatch[1].trim();
  if (!editorialText) return null;

  const teams = parseTeamsFromTitle(html, matchName);
  const lower = editorialText.toLowerCase();

  let bestOutcome = null;
  if (/нич|x|х/.test(lower)) {
    bestOutcome = 'Х';
  }

  if (!bestOutcome && teams[0] && lower.includes(teams[0].toLowerCase())) {
    bestOutcome = 'П1';
  }

  if (!bestOutcome && teams[1] && lower.includes(teams[1].toLowerCase())) {
    bestOutcome = 'П2';
  }

  if (!bestOutcome) {
    bestOutcome = normalizeOutcomeLabel(editorialText.match(/(П1|П2|Х|X|Ничья)/i)?.[1]) || 'нет сигнала';
  }

  const coeff = toNumber(editorialText.match(/коэффициент\s*(\d{1,2}(?:[.,]\d+)?)/i)?.[1]);
  const probabilityPercent = Number.isFinite(coeff) && coeff > 1
    ? Math.round((1 / coeff) * 100)
    : 0;

  return {
    matchName,
    bestOutcome,
    probabilityPercent,
    confidence: confidenceFromPercent(probabilityPercent),
    source: 'editorial-main-forecast',
    explanationLines: [
      `1) Взял основной прогноз редакции со страницы матча.`,
      `2) Формулировка: ${editorialText.slice(0, 120)}${editorialText.length > 120 ? '...' : ''}`,
      `3) Преобразовал выбор в исход ${bestOutcome}.`,
      `4) Вероятность оценена из коэффициента ${Number.isFinite(coeff) ? coeff : 'н/д'}.`,
    ],
  };
}

function analyzeForecastFromHtml(html, { matchName = '' } = {}) {
  const percentSignals = extractPercentSignals(html);

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

  const oddsSignals = extractOddsSignals(html);

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
      `1) Основной кандидат по исходу: ${analysis.bestOutcome || 'н/д'}.`,
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
    `Краткий анализ: вероятнее исход ${analysis.bestOutcome} (${analysis.probabilityPercent}%).`,
    `Уверенность: ${analysis.confidence}.`,
    `Основание: ${analysis.source}.`,
    'Объяснение:',
    ...explanationLines,
    `Источник: ${link}`,
  ].join('\n');
}

module.exports = {
  analyzeForecastFromHtml,
  buildBriefForecastText,
  normalizeExplanationLines,
  extractEditorialForecast,
};
