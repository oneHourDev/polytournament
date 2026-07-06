#!/usr/bin/env node
// Local tester for the WhatsApp bot commands. Runs the SAME logic as the n8n
// "Handle Sign-in" Code node (n8n/lib/bot-logic.js) against the real Firebase
// Realtime Database over REST — no deploy, no emulator, no WhatsApp needed.
//
// Usage (PowerShell handles the leading slash fine):
//   node scripts/bot-cli.mjs /sign-in <nickname>
//   node scripts/bot-cli.mjs /sign-in "  morpet87 "     # case/space-insensitive
//   node scripts/bot-cli.mjs /help
//
// Optional: set FIREBASE_AUTH_QS='?auth=<token>' if you lock down the DB.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const b = require('../n8n/lib/bot-logic.js');

const DB = process.env.FIREBASE_DB_URL || 'https://polytournament-87d5b-default-rtdb.firebaseio.com';
const Q = process.env.FIREBASE_AUTH_QS || '';

const get = async (path) => {
  const r = await fetch(`${DB}/${path}.json${Q}`);
  const j = await r.json();
  return (j && j.error) ? null : j;
};
const put = async (path, val) => {
  const r = await fetch(`${DB}/${path}.json${Q}`, { method: 'PUT', body: JSON.stringify(val) });
  const j = await r.json();
  if (j && j.error) throw new Error(`${path}: ${j.error}`);
};

const [command, ...rest] = process.argv.slice(2);
const nickname = rest.join(' ');

const route = b.routeCommand(command || '');
if (route.kind !== 'sign-in') {
  console.log(`\n→ ${command || '(none)'}\n${route.message}`);
  process.exit(0);
}

const pointer = await get('latest_tournament');
const registry = (pointer && typeof pointer === 'string') ? null : (await get('tournaments')) || {};
const tid = b.pickLatestTid(pointer, registry || {});
const players = tid ? (await get(`tournaments/${tid}/players`)) || [] : [];

// Sign-in appends the nickname to the tournament's players list (the single
// source of truth the board renders). No participants node.
const res = b.addPlayerToList(players, nickname);
if (tid && res.ok && res.added) {
  await put(`tournaments/${tid}/players`, res.players);
}
console.log(`\n→ /sign-in  nickname: ${nickname || '(none)'}`);
if (!tid) console.log('← ok=false  code=no_tournament\n⚠️ There is no active tournament right now.');
else if (!res.ok) console.log(`← ok=false  code=${res.code}\n⚠️ Your number is not registered for this tournament.`);
else if (res.added) console.log(`← ok=true  added\n✅ ${res.nickname} — you're now in ${tid}.`);
else console.log(`← ok=true  already\nℹ️ ${res.nickname} is already in ${tid}.`);
