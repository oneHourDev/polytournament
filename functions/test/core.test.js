'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../lib/core');

// ── In-memory db adapter ─────────────────────────────────────────────────────
function makeDb(initial) {
  const store = JSON.parse(JSON.stringify(initial || {}));
  const getAt = (path) => path.split('/').reduce((o, k) => (o == null ? undefined : o[k]), store);
  const setAt = (path, val) => {
    const parts = path.split('/');
    let o = store;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  };
  return {
    store,
    async get(p) { const v = getAt(p); return v === undefined ? null : v; },
    async set(p, v) { setAt(p, v); },
    async update(p, v) { setAt(p, Object.assign({}, getAt(p) || {}, v)); },
  };
}

const REGISTRY = {
  tournaments: {
    t4: { order: 4, title: 'Tournament 4', players: ['OneHourPlayer', 'MorPet87'] },
    t5: { order: 5, title: 'Tournament 5', players: ['MorPet87', 'WestieWarrior', 'Hukul', 'OpenTheFckingStrait'] },
  },
};
const FIXED_NOW = () => 1700000000000;

// ── normalizeNick ────────────────────────────────────────────────────────────
test('normalizeNick trims and lowercases', () => {
  assert.equal(core.normalizeNick('  MorPet87 '), 'morpet87');
  assert.equal(core.normalizeNick(null), '');
});

// ── resolveLatestTournamentId ────────────────────────────────────────────────
test('latest-tournament resolves from explicit pointer', async () => {
  const db = makeDb(Object.assign({ latest_tournament: 't4' }, REGISTRY));
  assert.equal(await core.resolveLatestTournamentId(db), 't4');
});

test('latest-tournament falls back to highest order when pointer absent', async () => {
  const db = makeDb(REGISTRY);
  assert.equal(await core.resolveLatestTournamentId(db), 't5');
});

test('latest-tournament ignores _meta-style keys', async () => {
  const db = makeDb({ tournaments: Object.assign({ _meta: { x: 1 } }, REGISTRY.tournaments) });
  assert.equal(await core.resolveLatestTournamentId(db), 't5');
});

// ── sign-in matching ─────────────────────────────────────────────────────────
test('sign-in matches an expected player and records participant', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleSignIn(db, 'WestieWarrior', { now: FIXED_NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.tournament_id, 't5');
  const rec = db.store.tournaments.t5.participants.WestieWarrior;
  assert.deepEqual(rec, { nickname: 'WestieWarrior', status: 'signed_in', joined_at: 1700000000000, tournament_id: 't5' });
});

test('sign-in is case-insensitive and whitespace-trimmed', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleSignIn(db, '  morpet87 ', { now: FIXED_NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.nickname, 'MorPet87', 'canonical nickname from the roster is used, not the raw input');
  assert.ok(db.store.tournaments.t5.participants.MorPet87);
});

test('sign-in rejects an unknown nickname with a clear error (not silent)', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleSignIn(db, 'SomeRandomGuy', { now: FIXED_NOW });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, 'not_recognized');
  assert.match(r.body.message, /not on the player list/i);
  assert.equal(db.store.tournaments.t5.participants, undefined, 'no participant written on no-match');
});

test('sign-in with no nickname → missing_nickname', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleSignIn(db, '   ', { now: FIXED_NOW });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'missing_nickname');
});

test('sign-in with no tournament → no_tournament', async () => {
  const db = makeDb({});
  const r = await core.handleSignIn(db, 'MorPet87', { now: FIXED_NOW });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no_tournament');
});

// ── command dispatch / help ──────────────────────────────────────────────────
test('handleCommand routes /sign-in (case-insensitive)', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleCommand(db, '/SIGN-IN', 'Hukul', { now: FIXED_NOW });
  assert.equal(r.status, 200);
  assert.ok(db.store.tournaments.t5.participants.Hukul);
});

test('unknown command returns help payload listing commands', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleCommand(db, '/frobnicate', 'x', { now: FIXED_NOW });
  assert.equal(r.status, 400);
  assert.equal(r.body.help, true);
  const names = r.body.commands.map((c) => c.name);
  assert.ok(names.includes('/sign-in') && names.includes('/create-tournament'));
});

test('/create-tournament is advertised but not yet implemented', async () => {
  const db = makeDb(REGISTRY);
  const r = await core.handleCommand(db, '/create-tournament', 'x', { now: FIXED_NOW });
  assert.equal(r.status, 501);
  assert.equal(r.body.error, 'not_implemented');
});

// ── shared-secret auth ───────────────────────────────────────────────────────
test('checkSecret: correct / wrong / missing / unconfigured', () => {
  assert.equal(core.checkSecret('s3cret', 's3cret'), true);
  assert.equal(core.checkSecret('nope', 's3cret'), false);
  assert.equal(core.checkSecret(undefined, 's3cret'), false);
  assert.equal(core.checkSecret('anything', ''), false, 'unconfigured server rejects');
});

test('handleRequest rejects missing/invalid secret with 401', async () => {
  const db = makeDb(REGISTRY);
  const missing = await core.handleRequest({ headers: {}, body: { command: '/sign-in', nickname: 'MorPet87' }, expectedSecret: 'S', db });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'unauthorized');
  const bad = await core.handleRequest({ headers: { 'x-webhook-secret': 'WRONG' }, body: { command: '/sign-in', nickname: 'MorPet87' }, expectedSecret: 'S', db });
  assert.equal(bad.status, 401);
  assert.equal(db.store.tournaments.t5.participants, undefined, 'no write happens when unauthorized');
});

test('handleRequest with valid secret executes the command', async () => {
  const db = makeDb(REGISTRY);
  const ok = await core.handleRequest({ headers: { 'x-webhook-secret': 'S' }, body: { command: '/sign-in', nickname: 'Hukul' }, expectedSecret: 'S', db, opts: { now: FIXED_NOW } });
  assert.equal(ok.status, 200);
  assert.ok(db.store.tournaments.t5.participants.Hukul);
});

// ── score → announcement ─────────────────────────────────────────────────────
function scoreDoc(over) {
  return Object.assign({ result: '1:0', winner_nickname: 'MorPet87', loser_nickname: 'WestieWarrior', notified: false }, over);
}

test('score trigger fires exactly once for a new score', async () => {
  let posts = 0;
  let notifiedSet = false;
  const out = await core.handleScoreCreate({
    score: scoreDoc(),
    tournamentId: 't5',
    matchId: '0-1',
    tournament: { title: 'Tournament 5' },
    secret: 'S',
    postWebhook: async () => { posts++; },
    setNotified: async () => { notifiedSet = true; },
  });
  assert.equal(posts, 1);
  assert.equal(notifiedSet, true);
  assert.equal(out.notified, true);
});

test('notified flag prevents duplicate announcement (re-run/redeploy)', async () => {
  let posts = 0;
  const args = {
    score: scoreDoc({ notified: true }),
    tournamentId: 't5', matchId: '0-1', tournament: { title: 'Tournament 5' }, secret: 'S',
    postWebhook: async () => { posts++; },
    setNotified: async () => {},
  };
  const out = await core.handleScoreCreate(args);
  assert.equal(posts, 0);
  assert.equal(out.skipped, 'already_notified');
});

test('score without winner_nickname is skipped (no ambiguous computation)', async () => {
  let posts = 0;
  const out = await core.handleScoreCreate({
    score: scoreDoc({ winner_nickname: undefined }),
    tournamentId: 't5', matchId: '0-1', tournament: {}, secret: 'S',
    postWebhook: async () => { posts++; }, setNotified: async () => {},
  });
  assert.equal(posts, 0);
  assert.equal(out.skipped, 'no_winner');
});

test('notification payload carries nicknames only — no phone/PII fields', () => {
  const payload = core.buildScoreNotification({
    score: scoreDoc(), tournamentId: 't5', matchId: '0-1',
    tournament: { title: 'Tournament 5' }, now: () => '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(payload, {
    event: 'match_result',
    tournament_id: 't5',
    tournament_title: 'Tournament 5',
    match_id: '0-1',
    winner_nickname: 'MorPet87',
    loser_nickname: 'WestieWarrior',
    players: ['MorPet87', 'WestieWarrior'],
    result: '1:0',
    timestamp: '2026-01-01T00:00:00.000Z',
  });
  const json = JSON.stringify(payload).toLowerCase();
  assert.ok(!/phone|msisdn|whatsapp|\+\d{6}/.test(json), 'no phone/PII in payload');
});
