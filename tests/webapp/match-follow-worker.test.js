'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { processFollowedMatches } = require('../../webapp/services/matchFollowWorker');
const { createFakePg } = require('./testHelpers');

function enabled(value = 'true') {
  const previous = process.env.MATCH_FOLLOW_ENABLED;
  process.env.MATCH_FOLLOW_ENABLED = value;
  return () => { if (previous === undefined) delete process.env.MATCH_FOLLOW_ENABLED; else process.env.MATCH_FOLLOW_ENABLED = previous; };
}

const completeSchema = (query) => /to_regclass/i.test(query) ? [{ missing_tables: [] }] : [];

 test('worker is a no-op when feature flag is disabled', async () => {
  const restore = enabled('false');
  try {
    let calls = 0;
    const pg = { connection: async () => { calls += 1; return []; } };
    const summary = await processFollowedMatches({ pg, fetcher: async () => { throw new Error('must not fetch'); } });
    assert.equal(summary.reason, 'flag_disabled');
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('worker creates a match event for a score change', async () => {
  const restore = enabled();
  try {
    const inserts = [];
    const pg = createFakePg({ handler: async (query, params) => {
      if (/to_regclass/i.test(query)) return [{ missing_tables: [] }];
      if (/v_match_follow_active/i.test(query)) return [{ match_id: 10, sstats_match_id: '55' }];
      if (/FROM public\.match_event/i.test(query)) return [{ event_kind: 'started', score_home: 0, score_away: 0 }];
      if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 2, is_live: true, is_finished: false, is_cancelled: false }];
      if (/INSERT INTO public\.match_event/i.test(query)) { inserts.push(params); return [{ match_event_id: 99 }]; }
      return [];
    } });
    const summary = await processFollowedMatches({ pg, fetcher: async () => ({ game: { id: 55, status: { id: 3 }, score: { home: 1, away: 0 } } }) });
    assert.equal(summary.events_created, 1);
    assert.match(pg.calls.find((call) => /INSERT INTO public\.match_event/i.test(call.query)).query, /ON CONFLICT/i);
    assert.equal(inserts[0][2], 'score_changed');
  } finally { restore(); }
});

test('worker enqueues generic notification event and active follower delivery', async () => {
  const restore = enabled();
  try {
    const pg = createFakePg({ handler: async (query) => {
      if (/to_regclass/i.test(query)) return [{ missing_tables: [] }];
      if (/v_match_follow_active/i.test(query)) return [{ match_id: 10, sstats_match_id: '55' }];
      if (/FROM public\.match_event/i.test(query)) return [{ event_kind: 'started', score_home: 0, score_away: 0 }];
      if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 2, is_live: true, is_finished: false, is_cancelled: false }];
      if (/INSERT INTO public\.match_event/i.test(query)) return [{ match_event_id: 99 }];
      if (/INSERT INTO notification\.event/i.test(query)) return [{ notification_event_id: 100, notification_type_id: 1 }];
      if (/FROM public\.match_follow mf/i.test(query)) return [{ user_id: 7, recipient_address: 'tg-7', channel_id: 1, notification_template_id: 11, body_template: '⚽ Матч начался\\n\\n{{match_title}}\\n{{league_name}}\\n\\n', title_template: 'Старт' }];
      if (/FROM public\.match m/i.test(query)) return [{ home_team: 'Испания', away_team: 'Бельгия', sport_name: 'Футбол', tournament_name: 'Чемпионат мира' }];
      return [];
    } });
    await processFollowedMatches({ pg, fetcher: async () => ({ game: { id: 55, status: { id: 3 }, score: { home: 0, away: 0 } } }) });
    assert.ok(pg.calls.some(({ query }) => /INSERT INTO notification\.event/i.test(query)));
    const delivery = pg.calls.find(({ query }) => /INSERT INTO notification\.delivery/i.test(query));
    assert.ok(delivery);
    assert.equal(delivery.params[1], 7);
    assert.equal(JSON.parse(delivery.params[5]).text, '⚽ Матч начался\n\nИспания — Бельгия\nФутбол · Чемпионат мира');
  } finally { restore(); }
});

test('duplicate event conflict is tolerated', async () => {
  const restore = enabled();
  try {
    const pg = createFakePg({ handler: async (query) => {
      if (/to_regclass/i.test(query)) return [{ missing_tables: [] }];
      if (/v_match_follow_active/i.test(query)) return [{ match_id: 10, sstats_match_id: '55' }];
      if (/FROM public\.match_event/i.test(query)) return [{ event_kind: 'started', score_home: 0, score_away: 0 }];
      if (/FROM external\.public_match_status/i.test(query)) return [{ match_status_id: 2, is_live: true, is_finished: false, is_cancelled: false }];
      if (/INSERT INTO public\.match_event/i.test(query)) return [];
      return [];
    } });
    const summary = await processFollowedMatches({ pg, fetcher: async () => ({ game: { id: 55, status: { id: 3 }, score: { home: 1, away: 0 } } }) });
    assert.equal(summary.events_created, 0);
    assert.equal(summary.skipped, 1);
  } finally { restore(); }
});

test('missing status mapping is ignored', async () => {
  const restore = enabled();
  try {
    const pg = createFakePg({ handler: async (query) => {
      if (/to_regclass/i.test(query)) return [{ missing_tables: [] }];
      if (/v_match_follow_active/i.test(query)) return [{ match_id: 10, sstats_match_id: '55' }];
      if (/FROM external\.public_match_status/i.test(query)) return [];
      return [];
    } });
    const summary = await processFollowedMatches({ pg, fetcher: async () => ({ game: { id: 55, status: { id: 999 } } }) });
    assert.equal(summary.events_created, 0);
    assert.equal(summary.skipped, 1);
  } finally { restore(); }
});
