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

test('resolveSignIn: match writes a participant record', () => {
  const r = b.resolveSignIn({ pointer: 't5', registry: REGISTRY, nickname: 'westiewarrior', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.tid, 't5');
  assert.equal(r.nickname, 'WestieWarrior');
  assert.equal(r.participantKey, 'WestieWarrior');
  assert.deepEqual(r.record, { nickname: 'WestieWarrior', status: 'signed_in', joined_at: 1700000000000, tournament_id: 't5' });
});

test('resolveSignIn: no-match returns a clear (non-silent) error', () => {
  const r = b.resolveSignIn({ pointer: 't5', registry: REGISTRY, nickname: 'Ghost', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_recognized');
  assert.match(r.message, /not on the player list/i);
});

test('resolveSignIn: uses fallback tid when no pointer', () => {
  const r = b.resolveSignIn({ pointer: null, registry: REGISTRY, nickname: 'Hukul', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.tid, 't5');
});

test('resolveSignIn: no tournament / no nickname', () => {
  assert.equal(b.resolveSignIn({ pointer: null, registry: {}, nickname: 'x', now: NOW }).code, 'no_tournament');
  assert.equal(b.resolveSignIn({ pointer: 't5', registry: REGISTRY, nickname: '   ', now: NOW }).code, 'missing_nickname');
});

test('routeCommand: /sign-in vs help', () => {
  assert.equal(b.routeCommand('/SIGN-IN').kind, 'sign-in');
  assert.match(b.routeCommand('/nope').message, /Unknown command/);
  assert.match(b.routeCommand('/create-tournament').message, /not available yet/);
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
