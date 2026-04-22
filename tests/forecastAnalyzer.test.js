const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeForecastFromHtml } = require('../lib/forecastAnalyzer');

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
