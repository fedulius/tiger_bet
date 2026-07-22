'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRecommendedPickWriterPrompts,
  writeRecommendedPick,
} = require('../../webapp/services/recommendedPickWriterService');

function writerInput(overrides = {}) {
  return {
    analyst_snapshot: Object.freeze({
      match_ref: 42,
      match_assessment: 'Хозяева создают больше моментов в последних матчах.',
      market_estimates: [{
        market_key: 'one_x_two:home',
        estimated_probability: 0.58,
        confidence: 72,
        rationale: 'Домашняя команда стабильнее в атаке.',
        evidence: [{ path: 'sstats_data.secret', value: 'raw SStats', interpretation: 'не передавать' }],
      }],
      uncertainty: 'Составы могут измениться перед началом.',
      data_quality: { overall_coverage: 0.8 },
      sstats_data: { raw: 'never send' },
    }),
    selected_option: Object.freeze({
      match_ref: 42,
      option_ref: 'home-win',
      market_key: 'one_x_two:home',
      label: 'Победа хозяев',
      odds_decimal: 2.1,
      implied_probability: 0.476,
      estimated_probability: 0.58,
    }),
    selector_metadata: Object.freeze({
      selection_confidence: 76,
      selection_quality: 'strong',
      warning: null,
      selector_version: 'recommended-pick-value-selector-v1',
    }),
    ...overrides,
  };
}

function writerOutput(overrides = {}) {
  return {
    headline: 'Победа хозяев выглядит обоснованно',
    brief: 'Хозяева создают больше моментов, а домашняя команда стабильнее в атаке.',
    risk_note: 'Составы могут измениться перед началом.',
    writer_version: 'recommended-pick-writer-v1',
    ...overrides,
  };
}

test('writer prompt contains only fixed selected facts and never leaks raw SStats or an option list', () => {
  const prompts = buildRecommendedPickWriterPrompts(writerInput({
    option_list: [{ label: 'Победа гостей', odds_decimal: 9.9 }],
    raw_sstats: { secret: 'never send' },
  }));

  assert.match(prompts.userPrompt, /Победа хозяев/);
  assert.match(prompts.userPrompt, /2\.1/);
  assert.doesNotMatch(prompts.userPrompt, /raw SStats|never send|Победа гостей|9\.9|option_list|raw_sstats|sstats_data/i);
  assert.match(prompts.systemPrompt, /only the passed frozen facts/i);
  assert.match(prompts.systemPrompt, /do not output.*probability/i);
});

test('writer accepts concise Russian text for the fixed selected option only', async () => {
  const result = await writeRecommendedPick(writerInput(), {
    provider: async () => ({ text: JSON.stringify(writerOutput()) }),
  });

  assert.deepEqual(result.writer_output, writerOutput());
  assert.equal(Object.isFrozen(result.writer_output), true);
  assert.equal(result.trace.prompt_version, 'recommended-pick-writer-v1');
});

test('writer rejects text that states a different fixed market or odds', async () => {
  let calls = 0;
  const result = await writeRecommendedPick(writerInput(), {
    provider: async () => {
      calls += 1;
      return { text: JSON.stringify(calls === 1
        ? writerOutput({ headline: 'Рынок: Победа гостей', brief: 'Коэффициент 1,80 выглядит интересным.' })
        : writerOutput({ headline: 'Рынок: Победа хозяев', brief: 'Коэффициент 2,10 сочетается с устойчивой атакой хозяев.' })) };
    },
  });

  assert.equal(calls, 2);
  assert.match(result.trace.validation_errors[0], /different selected market|different selected odds/);
  assert.deepEqual(result.writer_output, writerOutput({ headline: 'Рынок: Победа хозяев', brief: 'Коэффициент 2,10 сочетается с устойчивой атакой хозяев.' }));
});

test('writer retries once with the concrete validation error', async () => {
  const calls = [];
  const result = await writeRecommendedPick(writerInput(), {
    provider: async (request) => {
      calls.push(request);
      return { text: JSON.stringify(calls.length === 1 ? writerOutput({ writer_version: 'wrong' }) : writerOutput()) };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].userPrompt, /Previous response was rejected: writer_version must be recommended-pick-writer-v1/);
  assert.deepEqual(result.writer_output, writerOutput());
});

test('writer returns no output after two invalid responses and never uses a fallback', async () => {
  let calls = 0;
  const result = await writeRecommendedPick(writerInput(), {
    provider: async () => {
      calls += 1;
      return { text: calls === 1 ? 'not json' : JSON.stringify(writerOutput({ brief: 'English only text.' })) };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.writer_output, null);
  assert.equal(result.reason, 'writer_output_invalid');
  assert.equal(result.fallback, undefined);
  assert.equal(result.trace.validation_errors.length, 2);
});
