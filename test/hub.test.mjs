import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const commonJs = readFileSync(join(REPO, 'tournament-common.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } };

// Minimal hub DOM (mirrors index.html's board ids) + fake firebase + common.js
function makeDom(hash = '') {
  const fakeFirebase = `
    window.__refs = {};
    window.fetch = () => Promise.reject(new Error('no network in test'));
    window.firebase = {
      apps: [],
      initializeApp(cfg){ this.apps.push({}); return {}; },
      database(){
        return {
          ref(path){
            if(!window.__refs[path]){
              window.__refs[path] = {
                path, _cb:null, _errcb:null, _value:null, _removed:false,
                on(evt, cb, errcb){ this._cb=cb; this._errcb=errcb; },
                off(){ this._cb=null; },
                set(v){ this._value=v; return Promise.resolve(); },
                remove(){ this._removed=true; this._value=null; return Promise.resolve(); }
              };
            }
            return window.__refs[path];
          }
        };
      }
    };`;

  const html = `<!DOCTYPE html><html><body>
    <div class="tournament-nav" id="tournament-nav"></div>
    <div class="wrapper">
      <div id="hub-empty" style="display:none;"></div>
      <div id="hub-board" style="display:none;">
        <h1 id="hub-title"></h1>
        <div class="subtitle" id="hub-subtitle"></div>
        <span id="progress-text"></span>
        <div id="progress-fill"></div>
        <div class="scoreboard" id="scoreboard"></div>
        <table id="matrix-table"></table>
      </div>
    </div>
    <script>${fakeFirebase}</script>
    <script>${commonJs}</script>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'https://example.test/index.html' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  return dom;
}

const REGISTRY = {
  t1: { order: 1, title: 'Tournament 1', legacy: true, href: 'index1.html' },
  t2: { order: 2, title: 'Tournament 2', legacy: true, href: 'index2.html' },
  t3: { order: 3, title: 'Tournament 3', legacy: true, href: 'index3.html' },
  t4: { order: 4, title: 'Tournament 4', legacy: true, href: 'index4.html' },
  t5: {
    order: 5, title: 'Tournament 5', legacy: false,
    setup: { mapType: 'Lakes', mapSize: 'Normal (196 tiles)', botCount: 10, botDifficulty: 'Crazy', nation: 'Bardur', style: 'glory', gloryTier: '20k' },
    players: ['OneHourPlayer', 'WestieWarrior', 'MorPet87', 'Hukul'], // simple nickname list
  },
};

// ── Test 1: hub builds nav, defaults to newest dynamic tournament ──────────
console.log('\nTest 1: hub nav + default routing (no hash)');
{
  const dom = makeDom('');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  // Emit registry
  w.__refs['tournaments']._cb({ val: () => REGISTRY });

  const nav = w.document.getElementById('tournament-nav');
  const links = [...nav.querySelectorAll('a')];
  ok(links.length === 5, 'nav has 5 links (4 legacy + 1 dynamic)');
  ok(links[0].getAttribute('href') === 'index1.html', 'T1 → index1.html (legacy href)');
  ok(links[4].getAttribute('href') === '#t=t5', 'T5 → #t=t5 (dynamic hash)');
  ok(links[4].classList.contains('active'), 'T5 is active by default (newest dynamic)');

  ok(w.document.getElementById('hub-board').style.display !== 'none', 'board is visible');
  ok(w.document.getElementById('hub-empty').style.display === 'none', 'empty state hidden');
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 5', 'title = Tournament 5');
  ok(w.document.getElementById('hub-subtitle').textContent ===
     'Style: Glory 20k · Map: Lakes · Size: Normal (196 tiles) · Nation: Bardur · Bots: 10 Crazy',
     'subtitle generated from setup');
  ok(w.PLAYERS.length === 4, 'PLAYERS set to 4');
  ok(w.PLAYERS[0].name === 'OneHourPlayer', 'nickname string normalized to {name}');
  ok(w.PLAYERS[0].avatar === 'resources/img/OneHourPlayer.jpeg', 'avatar path derived from nickname (not in DB)');
  ok(w.__refs['tournaments/t5/results'] && typeof w.__refs['tournaments/t5/results']._cb === 'function', 'subscribed to nested tournaments/t5/results');

  // Emit some results and check matrix/progress render
  w.__refs['tournaments/t5/results']._cb({ val: () => ({ '0-1': '1:0', '2-3': '0:1' }) });
  const matrixCells = w.document.querySelectorAll('#matrix-table .result-cell').length;
  ok(matrixCells > 0, 'matrix rendered result cells (' + matrixCells + ')');
  const anyImg = [...w.document.querySelectorAll('#matrix-table img')].some(i => i.getAttribute('src') === 'resources/img/OneHourPlayer.jpeg');
  ok(anyImg, 'matrix avatar <img> uses derived repo path');
  const hasOnError = [...w.document.querySelectorAll('#matrix-table img')].every(i => i.getAttribute('onerror'));
  ok(hasOnError, 'avatar <img> has onerror fallback to initials');
  ok(w.document.getElementById('progress-text').textContent === '2 / 6', 'progress = 2 / 6 (4 players → 6 matches)');

  // Same-path guard: a saved result re-fires the parent "tournaments" listener
  // (results are nested under it). The results subscription must NOT be torn down.
  const cbBefore = w.__refs['tournaments/t5/results']._cb;
  w.__refs['tournaments']._cb({ val: () => REGISTRY }); // re-emit registry
  ok(w.__refs['tournaments/t5/results']._cb === cbBefore, 'results listener preserved across registry re-fire (no churn)');
}

// ── Test 2: hash selects a specific dynamic tournament ─────────────────────
console.log('\nTest 2: #t=t5 hash routing');
{
  const dom = makeDom('#t=t5');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REGISTRY });
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 5', 'hash #t=t5 loads Tournament 5');
  const activeLink = w.document.querySelector('#tournament-nav a.active');
  ok(activeLink && activeLink.getAttribute('href') === '#t=t5', 'nav marks #t=t5 active');
}

// ── Test 3: empty registry → friendly empty state ──────────────────────────
console.log('\nTest 3: no dynamic tournaments → empty state');
{
  const dom = makeDom('');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  const legacyOnly = { t1: REGISTRY.t1, t2: REGISTRY.t2 };
  w.__refs['tournaments']._cb({ val: () => legacyOnly });
  ok(w.document.getElementById('hub-board').style.display === 'none', 'board hidden when no dynamic tournaments');
  ok(w.document.getElementById('hub-empty').style.display !== 'none', 'empty state shown');
  ok([...w.document.querySelectorAll('#tournament-nav a')].length === 2, 'nav still lists the 2 legacy tournaments');
}

// ── Test 4: registry read error → error message ────────────────────────────
console.log('\nTest 4: registry read denied → error message');
{
  const dom = makeDom('');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._errcb(new Error('Permission denied'));
  const empty = w.document.getElementById('hub-empty');
  ok(empty.style.display !== 'none', 'error message shown');
  ok(/rules/i.test(empty.textContent), 'error mentions Firebase rules');
}

// ── Test 5: switching tournaments detaches the old results listener ────────
console.log('\nTest 5: switching dynamic tournaments tears down old subscription');
{
  const REG2 = JSON.parse(JSON.stringify(REGISTRY));
  REG2.t6 = { order: 6, title: 'Tournament 6', legacy: false,
    setup: { style: 'might', mapType: 'Pangea', botCount: 5, botDifficulty: 'Hard' },
    players: ['A', 'B', 'C'] };
  const dom = makeDom('#t=t5');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REG2 });
  ok(typeof w.__refs['tournaments/t5/results']._cb === 'function', 'subscribed to tournaments/t5/results');
  // Navigate to t6
  w.location.hash = '#t=t6';
  w.dispatchEvent(new w.Event('hashchange'));
  ok(w.__refs['tournaments/t5/results']._cb === null, 'old t5 results listener detached (.off called)');
  ok(typeof w.__refs['tournaments/t6/results']._cb === 'function', 'subscribed to tournaments/t6/results');
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 6', 'now showing Tournament 6');
  ok(w.document.getElementById('hub-subtitle').textContent === 'Style: Might · Map: Pangea · Bots: 5 Hard', 'might subtitle (no glory tier)');
}

// ── Test 7: subtitle override (migrated 1v1 PvP tournaments) ───────────────
console.log('\nTest 7: explicit subtitle override wins over setup');
{
  const REG = { t1: { order: 1, title: 'Tournament 1', legacy: false,
    subtitle: 'Game Mode: 1v1 · Drylands · Kickoo',
    setup: { mapType: 'Drylands', nation: 'Kickoo' },
    players: ['A', 'B', 'C'] } };
  const dom = makeDom('#t=t1');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REG });
  ok(w.document.getElementById('hub-subtitle').textContent === 'Game Mode: 1v1 · Drylands · Kickoo', 'override string shown verbatim');
  ok([...w.document.querySelectorAll('#tournament-nav a')][0].getAttribute('href') === '#t=t1', 'migrated T1 is now a dynamic hub link (not legacy href)');
}

// ── Test 8: latest_tournament pointer overrides newest-by-order default ─────
console.log('\nTest 8: latest_tournament pointer selects the default view');
{
  const REG = {
    t1: { order: 1, title: 'Tournament 1', legacy: false, subtitle: 'x', players: ['A', 'B'] },
    t5: { order: 5, title: 'Tournament 5', legacy: false, setup: { style: 'might' }, players: ['C', 'D'] },
  };
  const dom = makeDom('');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REG });
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 5', 'defaults to newest (t5) before pointer arrives');
  w.__refs['latest_tournament']._cb({ val: () => 't1' });
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 1', 'pointer switches default to t1');
}

// ── Test 9: board renders the players list (single source of truth) ─────────
console.log('\nTest 9: board renders exactly the players list, no participants badge');
{
  const REG = { t5: { order: 5, title: 'Tournament 5', legacy: false, setup: { style: 'might' },
    players: ['OneHourPlayer', 'MorPet87'] } };
  const dom = makeDom('#t=t5');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REG });
  w.__refs['tournaments/t5/results']._cb({ val: () => ({}) }); // force a render
  const cards = [...w.document.querySelectorAll('#scoreboard .score-card')];
  ok(cards.length === 2, 'both players rendered as cards');
  ok(cards.some(c => /MorPet87/.test(c.textContent)), 'MorPet87 rendered');
  ok(cards.some(c => /OneHourPlayer/.test(c.textContent)), 'OneHourPlayer rendered');
  ok(!w.document.querySelector('.signed-in'), 'no signed-in badge anywhere (participants removed)');
}

// ── Test 10: registry read error falls back to cached registry ─────────────
console.log('\nTest 10: cached registry fallback on read error');
{
  const REG = { t5: { order: 5, title: 'Tournament 5', legacy: false, setup: { style: 'might' }, players: ['A', 'B'] } };
  const dom = makeDom('');
  const w = dom.window;
  w.localStorage.setItem('polytournament-registry', JSON.stringify(REG)); // seed cache
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._errcb(new Error('Permission denied'));
  ok(w.document.getElementById('hub-board').style.display !== 'none', 'board rendered from cache despite read error');
  ok(w.document.getElementById('hub-title').textContent === 'Tournament 5', 'cached tournament shown');
}

// ── Test 11: saving a result writes a score doc with winner_nickname ────────
console.log('\nTest 11: confirming a result writes a score doc (feeds the bot)');
{
  const REG = { t5: { order: 5, title: 'Tournament 5', legacy: false, setup: { style: 'might' },
    players: ['OneHourPlayer', 'WestieWarrior', 'MorPet87', 'Hukul'] } };
  const dom = makeDom('#t=t5');
  const w = dom.window;
  w.initHub({ apiKey: 'x', databaseURL: 'y' });
  w.__refs['tournaments']._cb({ val: () => REG });
  w.__refs['tournaments/t5/results']._cb({ val: () => ({}) });
  w.openPopup(0, 1);
  w.confirmResult('r'); // player 0 (OneHourPlayer) beats player 1 (WestieWarrior)
  const score = w.__refs['tournaments/t5/scores/0-1']._value;
  ok(score && score.winner_nickname === 'OneHourPlayer', 'score doc has explicit winner_nickname');
  ok(score.loser_nickname === 'WestieWarrior', 'score doc has loser_nickname');
  ok(score.notified === false, 'score doc starts notified:false');
  ok(score.result === '1:0', 'canonical result recorded');
}

// ── Test 6: legacy initTournament has been removed ─────────────────────────
console.log('\nTest 6: legacy initTournament() removed');
{
  const dom = makeDom('');
  const w = dom.window;
  ok(typeof w.initTournament === 'undefined', 'initTournament no longer defined (hub-only)');
  ok(typeof w.initHub === 'function', 'initHub still present');
}

console.log(`\n──────────────────────────────\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
