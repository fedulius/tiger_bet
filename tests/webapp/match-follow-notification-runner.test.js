'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramSender } = require('../../scripts/run_match_follow_notifications');
const { processFollowedMatches } = require('../../webapp/services/matchFollowWorker');

test('Telegram sender posts sendMessage through injected fetch', async () => {
  const calls = [];
  const sender = createTelegramSender({
    token: 'bot-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    },
  });

  const result = await sender({ chatId: '123', text: 'Привет' });

  assert.deepEqual(result, { message_id: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/botbot-token/sendMessage');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { chat_id: '123', text: 'Привет' });
});

test('Telegram sender surfaces Bot API errors without a second network call', async () => {
  let calls = 0;
  const sender = createTelegramSender({
    token: 'bot-token',
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden' }) };
    },
  });

  await assert.rejects(() => sender({ chatId: '123', text: 'hello' }), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /Forbidden/);
    return true;
  });
  assert.equal(calls, 1);
});

test('match follow worker settles prediction bets when a followed match finishes', async () => {
  const queries = [];
  const pg = {
    connection: async (query, params) => {
      queries.push({ query, params });
      if (/assert/i.test(query) || /to_regclass/i.test(query)) return [{ available: true }];
      if (/FROM public\.v_match_follow_active_sstats_matches/i.test(query)) return [{ match_id: 42, sstats_match_id: '1586077' }];
      if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 8, is_live: false, is_finished: true, is_cancelled: false }];
      if (/FROM public\.match_event/i.test(query)) return [{ event_kind: 'started', is_live: true, is_finished: false, is_cancelled: false, score_home: 0, score_away: 0 }];
      if (/INSERT INTO public\.match_event/i.test(query)) return [{ match_event_id: 77 }];
      if (/INSERT INTO notification\.event/i.test(query)) return [];
      return [];
    },
  };
  const settlementCalls = [];

  const result = await processFollowedMatches({
    pg,
    fetcher: async () => ({ game: { id: 1586077, status: 8, statusName: 'Finished', homeResult: 1, awayResult: 2 } }),
    settlePredictionBetsForMatch: async ({ matchId, finalScore, sourcePayload }) => {
      settlementCalls.push({ matchId, finalScore, status: sourcePayload.game.status });
      return { processed: 2, settled: 2, pending: 0, not_supported: 0 };
    },
  });

  assert.equal(result.events_created, 1);
  assert.deepEqual(settlementCalls, [{
    matchId: 42,
    finalScore: { home_score: 1, away_score: 2 },
    status: 8,
  }]);
  assert.deepEqual(result.settlement, { processed: 2, settled: 2, pending: 0, not_supported: 0 });
});

test('match follow worker attempts early settlement for live matches', async () => {
  const pg = { connection: async (query) => {
    if (/assert/i.test(query) || /to_regclass/i.test(query)) return [{ available: true }];
    if (/FROM public\.v_match_follow_active_sstats_matches/i.test(query)) return [{ match_id: 42, sstats_match_id: '1586077' }];
    if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 3, is_live: true, is_finished: false, is_cancelled: false }];
    if (/FROM public\.match_event/i.test(query)) return [];
    if (/INSERT INTO public\.match_event/i.test(query)) return [];
    return [];
  } };
  const calls = [];
  await processFollowedMatches({ pg, fetcher: async () => ({ game: { id: 1586077, status: 3, homeResult: 2, awayResult: 1 } }), settlePredictionBetsForMatch: async (args) => { calls.push(args); return { processed: 1, settled: 1, pending: 0, not_supported: 0 }; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].early, true);
});

test('match follow worker settles pending prediction bets even when finish event already exists', async () => {
  const pg = {
    connection: async (query) => {
      if (/assert/i.test(query) || /to_regclass/i.test(query)) return [{ available: true }];
      if (/FROM public\.v_match_follow_active_sstats_matches/i.test(query)) return [{ match_id: 42, sstats_match_id: '1586077' }];
      if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 8, is_live: false, is_finished: true, is_cancelled: false }];
      if (/FROM public\.match_event/i.test(query)) return [{ event_kind: 'finished', is_live: false, is_finished: true, is_cancelled: false, score_home: 1, score_away: 2 }];
      return [];
    },
  };
  let settlementCalls = 0;

  const result = await processFollowedMatches({
    pg,
    fetcher: async () => ({ game: { id: 1586077, status: 8, statusName: 'Finished', homeResult: 1, awayResult: 2 } }),
    settlePredictionBetsForMatch: async () => {
      settlementCalls += 1;
      return { processed: 1, settled: 1, pending: 0, not_supported: 0 };
    },
  });

  assert.equal(result.events_created, 0);
  assert.equal(settlementCalls, 1);
  assert.deepEqual(result.settlement, { processed: 1, settled: 1, pending: 0, not_supported: 0 });
});
