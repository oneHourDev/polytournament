#!/usr/bin/env node
// Seed / update the Firebase "tournaments" registry from tournaments-seed.json.
//
// Each tournament is written with PATCH (merge), so it updates config fields
// (order/title/legacy/setup/players) WITHOUT touching a tournament's saved
// `results` child. Match results for dynamic tournaments live at
// tournaments/<id>/results — no separate top-level node or rule per tournament.
//
// Prerequisite: RTDB rules must allow write to the "tournaments" node
// (see firebase-rules.json). That node is already open in this project.
//
// Usage:  node scripts/seed-firebase.mjs           # write/merge the registry
//         node scripts/seed-firebase.mjs --verify  # read it back
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DB = 'https://polytournament-87d5b-default-rtdb.firebaseio.com';
const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, 'tournaments-seed.json');

async function verify() {
  const reg = await (await fetch(`${DB}/tournaments.json`)).json();
  if (reg && reg.error) { console.error('Read failed:', reg.error); process.exit(1); }
  for (const [id, t] of Object.entries(reg || {})) {
    const kind = t.legacy ? 'legacy → ' + t.href : (t.setup ? '(' + (t.setup.style || '?') + ')' : '');
    const played = t.results ? Object.keys(t.results).length : 0;
    console.log(`  ${id}  order=${t.order}  "${t.title}"  ${kind}  results=${played}`);
  }
}

async function seed() {
  const data = JSON.parse(readFileSync(SEED, 'utf8'));
  for (const [id, entry] of Object.entries(data)) {
    const res = await fetch(`${DB}/tournaments/${id}.json`, {
      method: 'PATCH',
      body: JSON.stringify(entry),
    });
    const body = await res.json();
    if (body && body.error) {
      console.error(`  ✗ ${id}: ${body.error}`);
      console.error('    → publish firebase-rules.json in the console first.');
      process.exit(1);
    }
    console.log(`  ✓ ${id} (${entry.legacy ? 'legacy' : 'dynamic'})`);
  }
  console.log('Done. Verify with: node scripts/seed-firebase.mjs --verify');
}

if (process.argv.includes('--verify')) verify();
else seed();
