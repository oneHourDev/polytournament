#!/usr/bin/env node
// Local tester for the WhatsApp bot commands. Runs the SAME logic as the
// deployed Cloud Function (functions/lib/core.js) against the real Firebase
// Realtime Database over REST — no deploy, no emulator, no WhatsApp needed.
//
// Usage:
//   node scripts/bot-cli.mjs /sign-in <nickname>
//   node scripts/bot-cli.mjs /help
//   node scripts/bot-cli.mjs /sign-in "  morpet87 "     # case/space-insensitive
//
// This is exactly what n8n sends to the botCommand function ({command, nickname}).
import core from '../functions/lib/core.js';

const DB = 'https://polytournament-87d5b-default-rtdb.firebaseio.com';

const db = {
  async get(path) {
    const r = await fetch(`${DB}/${path}.json`);
    const j = await r.json();
    return (j && j.error) ? null : j;
  },
  async set(path, val) {
    const r = await fetch(`${DB}/${path}.json`, { method: 'PUT', body: JSON.stringify(val) });
    const j = await r.json();
    if (j && j.error) throw new Error(`${path}: ${j.error}`);
  },
  async update(path, val) {
    const r = await fetch(`${DB}/${path}.json`, { method: 'PATCH', body: JSON.stringify(val) });
    const j = await r.json();
    if (j && j.error) throw new Error(`${path}: ${j.error}`);
  },
};

const [command, ...rest] = process.argv.slice(2);
const nickname = rest.join(' ');

const res = await core.handleCommand(db, command || '', nickname);
console.log(`\n→ command: ${command || '(none)'}  nickname: ${nickname || '(none)'}`);
console.log(`← HTTP ${res.status}`);
console.log(JSON.stringify(res.body, null, 2));
