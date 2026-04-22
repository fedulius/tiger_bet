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
  const regex = /(П1|П2|Х|X|Ничья|1|2)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/gi;
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
  const regex = /(П1|П2|Х|X|Ничья|1|2)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d{1,3})?)/gi;
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

function buildBriefForecastText({ team, leagueName, url }, analysis) {
  const link = url ? `https://stavka.tv${url}` : '—';

  if (analysis.source === 'no-signal') {
    return [
      `Матч: ${team}`,
      `Лига: ${leagueName}`,
      '',
      'Краткий анализ: недостаточно сигналов на странице матча.',
      'Рекомендация: проверить матч позже или выбрать другой матч.',
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
    `Источник: ${link}`,
  ].join('\n');
}

module.exports = {
  analyzeForecastFromHtml,
  buildBriefForecastText,
};
