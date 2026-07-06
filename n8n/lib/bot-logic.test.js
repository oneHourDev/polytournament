'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const b = require('./bot-logic');

const REGISTRY = {
  t4: { order: 4, title: 'Tournament 4', players: ['OneHourPlayer', 'MorPet87'] },
  t5: { order: 5, title: 'Tournament 5', players: ['MorPet87', 'WestieWarrior', 'Hukul'] },
};
const NOW = () => 1700000000000;

test('normalizeNick trims and lowercases', () => {
  assert.equal(b.normalizeNick('  MorPet87 '), 'morpet87');
  assert.equal(b.normalizeNick(null), '');
});

test('pickLatestTid: pointer wins, else highest order, ignores _keys', () => {
  assert.equal(b.pickLatestTid('t4', REGISTRY), 't4');
  assert.equal(b.pickLatestTid(null, REGISTRY), 't5');
  assert.equal(b.pickLatestTid('', { _meta: {}, t4: REGISTRY.t4, t5: REGISTRY.t5 }), 't5');
});

test('matchRoster is case- and whitespace-insensitive, returns canonical', () => {
  assert.equal(b.matchRoster(['MorPet87', 'Hukul'], '  morpet87 '), 'MorPet87');
  assert.equal(b.matchRoster(['MorPet87'], 'ghost'), null);
});

test('addPlayerToList: appends a new nickname to the list', () => {
  const r = b.addPlayerToList(['MorPet87', 'Hukul'], 'WestieWarrior');
  assert.equal(r.ok, true);
  assert.equal(r.added, true);
  assert.equal(r.nickname, 'WestieWarrior');
  assert.deepEqual(r.players, ['MorPet87', 'Hukul', 'WestieWarrior']);
});

test('addPlayerToList: already present (case-insensitive) keeps existing spelling, no dup', () => {
  const r = b.addPlayerToList(['MorPet87', 'Hukul'], '  morpet87 ');
  assert.equal(r.ok, true);
  assert.equal(r.added, false);
  assert.equal(r.nickname, 'MorPet87');
  assert.deepEqual(r.players, ['MorPet87', 'Hukul']);
});

test('addPlayerToList: empty/whitespace nickname is rejected', () => {
  assert.equal(b.addPlayerToList(['A'], '   ').code, 'missing_nickname');
  assert.equal(b.addPlayerToList(['A'], null).code, 'missing_nickname');
});

test('addPlayerToList: missing/non-array players starts a fresh list', () => {
  const r = b.addPlayerToList(undefined, 'MorPet87');
  assert.equal(r.added, true);
  assert.deepEqual(r.players, ['MorPet87']);
});

test('routeCommand: /sign-in vs help', () => {
  assert.equal(b.routeCommand('/SIGN-IN').kind, 'sign-in');
  assert.match(b.routeCommand('/nope').message, /Unknown command/);
  assert.match(b.routeCommand('/create-tournament').message, /not available yet/);
});

test('normalizeIntent: known intents pass, dashes/case fold, junk → unknown', () => {
  assert.equal(b.normalizeIntent('sign-in'), 'sign_in');
  assert.equal(b.normalizeIntent('REPORT_WIN'), 'report_win');
  assert.equal(b.normalizeIntent(' start tournament '), 'start_tournament');
  assert.equal(b.normalizeIntent('garbage'), 'unknown');
  assert.equal(b.normalizeIntent(null), 'unknown');
});

test('classifyIntent: keyword fallback, English + CZ/SK', () => {
  assert.equal(b.classifyIntent('I beat @Petra'), 'report_win');
  assert.equal(b.classifyIntent('porazil som @Petra'), 'report_win');
  assert.equal(b.classifyIntent('add me'), 'sign_in');
  assert.equal(b.classifyIntent('prihlás ma prosím'), 'sign_in');
  assert.equal(b.classifyIntent('help'), 'help');
  assert.equal(b.classifyIntent('pomoc'), 'help');
  assert.equal(b.classifyIntent('can you start a tournament'), 'start_tournament');
  assert.equal(b.classifyIntent(''), 'unknown');
  assert.equal(b.classifyIntent('what is the weather'), 'unknown');
});

test('buildWinRecord: positional result + score doc, mirrors saveScore', () => {
  const players = ['OneHourPlayer', 'WestieWarrior', 'MorPet87', 'Hukul'];
  // winner index 0 beats loser index 2 → matchId 0-2, row(0) vs col(2) = "1:0"
  const r = b.buildWinRecord({ players, winner: 'onehourplayer', loser: 'MorPet87', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.matchId, '0-2');
  assert.equal(r.resultVal, '1:0');
  assert.deepEqual(r.score, {
    result: '1:0', winner_nickname: 'OneHourPlayer', loser_nickname: 'MorPet87',
    row_nickname: 'OneHourPlayer', col_nickname: 'MorPet87', match_id: '0-2',
    notified: false, created_at: 1700000000000,
  });
});

test('buildWinRecord: loser has lower index → result flips to 0:1', () => {
  const players = ['A', 'B', 'C'];
  const r = b.buildWinRecord({ players, winner: 'C', loser: 'A', now: NOW }); // wi=2, li=0, a=0
  assert.equal(r.matchId, '0-2');
  assert.equal(r.resultVal, '0:1');           // row(a=A) lost
  assert.equal(r.score.winner_nickname, 'C');
});

test('buildWinRecord: roster + self-match guards', () => {
  const players = ['A', 'B'];
  assert.equal(b.buildWinRecord({ players, winner: 'ghost', loser: 'A' }).code, 'winner_not_on_roster');
  assert.equal(b.buildWinRecord({ players, winner: 'A', loser: 'ghost' }).code, 'loser_not_on_roster');
  assert.equal(b.buildWinRecord({ players, winner: 'A', loser: 'a' }).code, 'same_player');
});

test('currentLeaders: sole leader by wins', () => {
  const players = ['A', 'B', 'C'];
  const results = { '0-1': '1:0', '0-2': '1:0', '1-2': '1:0' }; // A2 B1 C0
  assert.deepEqual(b.currentLeaders(players, results), ['A']);
});

test('currentLeaders: unresolved top tie returns both (they have not played)', () => {
  const players = ['A', 'B', 'C', 'D'];
  // A & B each beat C and D; A vs B not played → tie at the top
  const results = { '0-2': '1:0', '0-3': '1:0', '1-2': '1:0', '1-3': '1:0' };
  assert.deepEqual(b.currentLeaders(players, results).sort(), ['A', 'B']);
});

test('currentLeaders: head-to-head breaks a 2-way tie → sole leader', () => {
  const players = ['A', 'B', 'C', 'D'];
  // A & B both 3 wins, but A beat B → A is sole #1
  const results = { '0-1': '1:0', '0-2': '1:0', '0-3': '1:0', '1-2': '1:0', '1-3': '1:0' };
  // A: beat B,C,D = 3 ; B: beat C,D = 2 → actually sole by points
  assert.deepEqual(b.currentLeaders(players, results), ['A']);
});

test('currentLeaders: no games played → no leader', () => {
  assert.deepEqual(b.currentLeaders(['A', 'B'], {}), []);
  assert.deepEqual(b.currentLeaders(['A', 'B'], null), []);
});

test('validateNewTournament: required fields + conditionals', () => {
  assert.deepEqual(b.validateNewTournament({ style: 'might', mapType: 'Drylands', mapSize: 'Normal', nation: 'Ai-Mo' }), { ok: true, missing: [] });
  // glory needs a tier
  assert.equal(b.validateNewTournament({ style: 'glory', mapType: 'x', mapSize: 'y', nation: 'z' }).ok, false);
  assert.ok(b.validateNewTournament({ style: 'glory', mapType: 'x', mapSize: 'y', nation: 'z' }).missing.includes('glory tier'));
  // bots > 0 needs difficulty
  assert.ok(b.validateNewTournament({ style: 'might', mapType: 'x', mapSize: 'y', nation: 'z', botCount: 14 }).missing.includes('bot difficulty'));
  // bots 0 → difficulty not required
  assert.equal(b.validateNewTournament({ style: 'might', mapType: 'x', mapSize: 'y', nation: 'z', botCount: 0 }).ok, true);
  // missing core
  assert.deepEqual(b.validateNewTournament({}).ok, false);
});

test('nextTournamentId: increments past the highest order', () => {
  assert.deepEqual(b.nextTournamentId({ t4: { order: 4 }, t5: { order: 5 } }), { id: 't6', order: 6 });
  assert.deepEqual(b.nextTournamentId({}), { id: 't1', order: 1 });
  // id collision bumps forward (t2 taken → skip to t3)
  assert.deepEqual(b.nextTournamentId({ t1: { order: 1 }, t2: { order: 1 } }), { id: 't3', order: 3 });
});

test('buildTournamentEntry: glory with bots', () => {
  const e = b.buildTournamentEntry({ style: 'Glory', gloryTier: '15k', mapType: 'Drylands', mapSize: 'Normal', nation: 'Ai-Mo', botCount: '14', botDifficulty: 'Crazy' }, 6);
  assert.deepEqual(e, {
    order: 6, title: 'Tournament 6', legacy: false, players: [],
    setup: { mapType: 'Drylands', mapSize: 'Normal', nation: 'Ai-Mo', style: 'glory', gloryTier: '15k', botCount: 14, botDifficulty: 'Crazy' },
  });
});

test('buildTournamentEntry: might, no bots → no tier/bot fields', () => {
  const e = b.buildTournamentEntry({ style: 'might', mapType: 'Lakes', mapSize: 'Small', nation: 'Bardur' }, 7);
  assert.deepEqual(e.setup, { mapType: 'Lakes', mapSize: 'Small', nation: 'Bardur', style: 'might' });
  assert.equal(e.title, 'Tournament 7');
});

test('buildTranscript: text-only, oldest→newest, bot labeled, non-text skipped', () => {
  const msgs = [
    { from_name: 'Ann', text: { body: 'hi' }, timestamp: 3 },
    { from_name: 'Ben', text: { body: 'yo' }, timestamp: 1 },
    { text: {}, timestamp: 2 },                          // no body → skipped
    { from_me: true, text: { body: 'beep' }, timestamp: 4 },
    { from_name: 'Cy', type: 'image', timestamp: 5 },    // no text → skipped
  ];
  assert.equal(b.buildTranscript(msgs, { limit: 10, botName: 'PolyBot' }), 'Ben: yo\nAnn: hi\nPolyBot: beep');
});

test('buildTranscript: cap keeps the most recent, unknown sender → someone', () => {
  const msgs = [1, 2, 3].map((n) => ({ text: { body: 'm' + n }, timestamp: n }));
  assert.equal(b.buildTranscript(msgs, { limit: 2 }), 'someone: m2\nsomeone: m3');
  assert.equal(b.buildTranscript(null), '');
});

test('selectAnnouncements: only unnotified with a winner', () => {
  const scores = {
    '0-1': { winner_nickname: 'MorPet87', loser_nickname: 'WestieWarrior', notified: false, result: '1:0' },
    '0-2': { winner_nickname: 'Hukul', notified: true },              // already announced
    '1-2': { notified: false },                                       // no winner yet
  };
  const picked = b.selectAnnouncements(scores);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].matchId, '0-1');
  assert.equal(picked[0].winner_nickname, 'MorPet87');
});

test('announcementText: nicknames only, no PII', () => {
  const msg = b.announcementText({ winner_nickname: 'MorPet87', loser_nickname: 'WestieWarrior', result: '1:0' }, 'Tournament 5');
  assert.equal(msg, '🏆 MorPet87 beat WestieWarrior in Tournament 5 (1:0).');
  assert.ok(!/phone|\+\d{6}/i.test(msg));
});
