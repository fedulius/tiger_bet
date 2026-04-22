const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeForecastFromHtml,
  buildBriefForecastText,
  extractEditorialForecast,
} = require('../lib/forecastAnalyzer');

test('analyzeForecastFromHtml picks highest percent signal as best outcome', () => {
  const html = `
    <div>
      <span>П1 41%</span>
      <span>Х 24%</span>
      <span>П2 35%</span>
    </div>
  `;

  const analysis = analyzeForecastFromHtml(html, { matchName: 'A - B' });

  assert.equal(analysis.bestOutcome, 'П1');
  assert.equal(analysis.probabilityPercent, 41);
  assert.equal(analysis.source, 'percent-signals');
});

test('analyzeForecastFromHtml falls back to odds when percent signals are absent', () => {
  const html = `
    <div>
      <span>П1 1.80</span>
      <span>Х 3.40</span>
      <span>П2 4.20</span>
    </div>
  `;

  const analysis = analyzeForecastFromHtml(html, { matchName: 'A - B' });

  assert.equal(analysis.bestOutcome, 'П1');
  assert.equal(analysis.source, 'odds-implied');
  assert.ok(analysis.probabilityPercent >= 45 && analysis.probabilityPercent <= 55);
});

test('analyzeForecastFromHtml returns no-signal result when html has no usable signals', () => {
  const html = '<div>Нет данных для прогноза</div>';

  const analysis = analyzeForecastFromHtml(html, { matchName: 'A - B' });

  assert.equal(analysis.bestOutcome, 'нет сигнала');
  assert.equal(analysis.source, 'no-signal');
  assert.equal(analysis.probabilityPercent, 0);
});

test('buildBriefForecastText keeps explanation in 4-6 lines', () => {
  const text = buildBriefForecastText(
    {
      team: 'Team A - Team B',
      leagueName: 'Test League',
      url: '/match-url',
    },
    {
      bestOutcome: 'П1',
      probabilityPercent: 62,
      confidence: 'средняя',
      source: 'ai-llm',
      explanationLines: [
        '1) Команда A стабильнее по последним матчам.',
        '2) У команды B слабее оборона на выезде.',
      ],
    }
  );

  const rows = text.split('\n');
  const idx = rows.findIndex((line) => line.startsWith('Объяснение:'));
  assert.ok(idx >= 0, 'Объяснение: section not found');

  const explanationRows = rows.slice(idx + 1, rows.length - 1).filter(Boolean);
  assert.ok(explanationRows.length >= 4 && explanationRows.length <= 6);
});

test('extractEditorialForecast returns main thought from editorial forecast block', () => {
  const html = `
    <html>
      <head><title>Бергс — Чилич: прогноз (кэф 1.94) 22 апреля 2026 | СТАВКА ТВ</title></head>
      <body>
        <div>
          ☑️ Прогноз на матч Зизу Бергс — Марин Чилич: победа Чилича за коэффициент 1.88
          Основной прогноз: Бергс произвел смешанное впечатление, но в разменах Чилич выглядит сильнее.
          Поэтому ставка на победу Чилича выглядит оправданной.
        </div>
      </body>
    </html>
  `;

  const result = extractEditorialForecast(html, { matchName: 'Зизу Бергс - Марин Чилич' });

  assert.match(result.mainThought, /побед/i);
  assert.match(result.mainThought, /Чилич/i);
  assert.equal(result.source, 'editorial-main-forecast');
  assert.equal(result.probabilityPercent, 53);
});

test('extractEditorialForecast keeps named winner for non П1/П2 markets (e.g. Dota2 team)', () => {
  const html = `
    <html>
      <head><title>Xtreme Gaming — Team Spirit: прогноз 22 апреля 2026 | СТАВКА ТВ</title></head>
      <body>
        <div>
          Прогноз на матч Xtreme Gaming — Team Spirit: победа Xtreme Gaming за коэффициент 1.95
          Основной прогноз: По пикам и текущей форме Xtreme Gaming выглядит стабильнее по лейту.
        </div>
      </body>
    </html>
  `;

  const result = extractEditorialForecast(html, { matchName: 'Xtreme Gaming - Team Spirit' });

  assert.match(result.mainThought, /Xtreme Gaming/i);
  assert.doesNotMatch(result.mainThought, /П1|П2|Х/i);
});
