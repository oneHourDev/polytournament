'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Pure bot logic for the n8n-only (no Cloud Functions / no Blaze) architecture.
//
// n8n reads/writes Firebase over REST; these functions are the decision brain it
// calls. NO Firebase, NO network, NO PII. The same functions are inlined into the
// n8n workflow Code nodes — keep them in sync (this file is the tested source of
// truth, mirrored by scripts/bot-cli.mjs).
// ─────────────────────────────────────────────────────────────────────────────

// Case-insensitive, whitespace-trimmed — used for ALL nickname comparisons.
function normalizeNick(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Firebase RTDB keys may not contain . $ # [ ] / or control chars.
function sanitizeKey(s) {
  return String(s).replace(/[.$#\[\]\/ -]/g, '_');
}

// Pick the active tournament: explicit pointer, else highest `order`.
function pickLatestTid(pointer, registry) {
  if (pointer && typeof pointer === 'string') return pointer;
  let best = null;
  let bestOrder = -Infinity;
  for (const [id, t] of Object.entries(registry || {})) {
    if (!t || id.startsWith('_')) continue;
    const order = typeof t.order === 'number' ? t.order : 0;
    if (order > bestOrder) { best = id; bestOrder = order; }
  }
  return best;
}

// Return the canonical roster spelling that matches `nickname`, or null.
function matchRoster(players, nickname) {
  const target = normalizeNick(nickname);
  return (players || []).find((p) => normalizeNick(p) === target) || null;
}

const COMMANDS = [
  { name: '/sign-in', description: 'Join the current tournament (identity from your phone number).' },
  { name: '/create-tournament', description: 'Create a new tournament (coming soon).' },
];

function helpText(message) {
  return (message || 'Available commands:') + '\n' + COMMANDS.map((c) => `${c.name} – ${c.description}`).join('\n');
}

// Sign-in = append the nickname to the tournament's `players` list, the single
// source of truth the board renders (there is no separate participants node).
// Case-insensitive dedupe keeps the existing spelling; returns the new list for
// n8n to PUT and whether it actually changed. Pure: n8n does the REST write.
function addPlayerToList(players, nickname) {
  const list = Array.isArray(players) ? players.slice() : [];
  const clean = String(nickname == null ? '' : nickname).trim();
  if (!clean) return { ok: false, code: 'missing_nickname' };
  const existing = matchRoster(list, clean);
  if (existing) return { ok: true, added: false, nickname: existing, players: list };
  list.push(clean);
  return { ok: true, added: true, nickname: clean, players: list };
}

// Route a raw bot command to a reply. For /sign-in the caller runs addPlayerToList;
// everything else returns a help/placeholder message.
function routeCommand(command) {
  const cmd = normalizeNick(command).replace(/^\//, '');
  if (cmd === 'sign-in' || cmd === 'signin') return { kind: 'sign-in' };
  if (cmd === 'create-tournament') return { kind: 'reply', message: '⚙️ /create-tournament is not available yet.\n' + helpText() };
  return { kind: 'reply', message: helpText('Unknown command.') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent classification. An AI node (Claude Haiku) maps free-text messages to one
// of these intents; the deterministic handlers then act. The AI classifies intent
// ONLY — the opponent for `report_win` comes from the message's @mentions, and all
// Firebase writes stay in the (tested) handlers. `classifyIntent` is the keyword
// fallback used when the AI call errors or returns junk, so a Claude outage
// degrades to keyword routing instead of a dead bot.
// ─────────────────────────────────────────────────────────────────────────────

const INTENTS = [
  { intent: 'sign_in', description: 'The sender wants to join / sign in to the current tournament.', examples: ['sign me in', 'sign-in', 'add me', 'I want to join', 'prihlás ma', 'zapíš ma'] },
  { intent: 'report_win', description: 'The sender is reporting that they won a match / beat the tagged opponent.', examples: ['I beat @player', 'I defeated @player', 'I won against @player', 'porazil som @player', 'zdolal som @player'] },
  { intent: 'help', description: 'The sender is asking what the bot can do.', examples: ['help', 'what can you do', 'commands', 'pomoc'] },
  { intent: 'start_tournament', description: 'The sender wants to start / create a new tournament.', examples: ['start tournament', 'create a tournament', 'new tournament', 'začni turnaj', 'vytvor turnaj'] },
];
const INTENT_NAMES = INTENTS.map((i) => i.intent);

// Validate a raw AI-returned intent against the known set; anything else → unknown.
function normalizeIntent(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase().replace(/[-\s]+/g, '_');
  return INTENT_NAMES.includes(v) ? v : 'unknown';
}

// Deterministic keyword fallback (English + Czech/Slovak). First match wins.
function classifyIntent(text) {
  const t = normalizeNick(text);
  if (!t) return 'unknown';
  const has = (...kw) => kw.some((k) => t.includes(k));
  if (has('beat', 'beated', 'defeat', 'won', 'porazil', 'zdolal', 'vyhral', 'vyhrál')) return 'report_win';
  if (has('sign in', 'sign-in', 'signin', 'add me', 'join', 'register', 'prihlas', 'prihlás', 'zapis', 'zapíš', 'pridaj')) return 'sign_in';
  if (has('start tournament', 'start a tournament', 'start-tournament', 'new tournament', 'create tournament', 'create a tournament', 'zacni', 'začni', 'vytvor turnaj')) return 'start_tournament';
  if (has('help', 'pomoc', 'command', 'what can you')) return 'help';
  return 'unknown';
}

// The intent catalog rendered for the classifier's system prompt.
function intentCatalog() {
  return INTENTS.map((i) => `- ${i.intent}: ${i.description} Examples: ${i.examples.join('; ')}.`).join('\n');
}

// Turn Whapi's message list into a plain-text transcript for the roast/chat
// reply's context: text messages only, oldest→newest, capped at `limit`. The
// bot's own messages are labeled `botName`; others use their WhatsApp display
// name (never their number — no PII leaves for the model).
function buildTranscript(messages, opts) {
  const o = opts || {};
  const limit = o.limit || 30;
  const botName = o.botName || 'PolyBot';
  const list = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.text && typeof m.text.body === 'string' && m.text.body.trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(-limit);
  return list.map((m) => `${m.from_me ? botName : (m.from_name || 'someone')}: ${m.text.body.trim()}`).join('\n');
}

// Record a win. Winner and loser are nicknames; positions come from the `players`
// roster. Returns the positional writes n8n makes over REST — mirrors the web
// app's saveScore (tournament-common.js): results/<a>-<b> drives ranking, scores/
// <a>-<b> carries the explicit winner + notified:false for the announce workflow.
// The canonical result is row(a=min index) vs col(b=max index).
function buildWinRecord({ players, winner, loser, now }) {
  const list = players || [];
  const wName = matchRoster(list, winner);
  const lName = matchRoster(list, loser);
  if (!wName) return { ok: false, code: 'winner_not_on_roster' };
  if (!lName) return { ok: false, code: 'loser_not_on_roster' };
  if (normalizeNick(wName) === normalizeNick(lName)) return { ok: false, code: 'same_player' };
  const wi = list.findIndex((p) => normalizeNick(p) === normalizeNick(wName));
  const li = list.findIndex((p) => normalizeNick(p) === normalizeNick(lName));
  const a = Math.min(wi, li);
  const b = Math.max(wi, li);
  const matchId = `${a}-${b}`;
  const resultVal = wi === a ? '1:0' : '0:1';
  const score = {
    result: resultVal,
    winner_nickname: wName,
    loser_nickname: lName,
    row_nickname: list[a],
    col_nickname: list[b],
    match_id: matchId,
    notified: false,
    created_at: (now || Date.now)(),
  };
  return { ok: true, matchId, resultVal, score, winner: wName, loser: lName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Standings / ranking — a faithful port of the web scoreboard (tournament-common
// .js: getResult, calcStats, sortByRank) so the bot's notion of "who leads" is
// identical to what players see. Points = wins; ties broken by head-to-head (for
// pairs) or beat-all-in-group / wins / losses (for larger groups).
// ─────────────────────────────────────────────────────────────────────────────

// results is the positional map tournaments/<tid>/results, keyed "<min>-<max>".
function getResultAt(results, r, c) {
  if (r === c) return null;
  const key = (a, b) => `${a}-${b}`;
  if (r < c) return (results && results[key(r, c)]) || null;
  const v = (results && results[key(c, r)]) || null;
  if (!v) return null;
  return v === '1:0' ? '0:1' : '1:0';
}

function calcStandings(players, results) {
  const N = (players || []).length;
  const stats = [];
  for (let i = 0; i < N; i++) {
    let wins = 0, losses = 0, played = 0, remaining = 0;
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const r = getResultAt(results, i, j);
      if (r === '1:0') { wins++; played++; }
      else if (r === '0:1') { losses++; played++; }
      else remaining++;
    }
    stats.push({ idx: i, wins, losses, played, remaining, pts: wins });
  }
  return stats;
}

function rankStandings(stats, results) {
  const headToHead = (a, b) => { const r = getResultAt(results, a, b); if (r === '1:0') return -1; if (r === '0:1') return 1; return 0; };
  const beatAll = (idx, group) => group.every((o) => (o.idx === idx ? true : getResultAt(results, idx, o.idx) === '1:0'));
  const grouped = {};
  stats.forEach((s) => { (grouped[s.pts] = grouped[s.pts] || []).push(s); });
  const result = [];
  Object.keys(grouped).map(Number).sort((a, b) => b - a).forEach((pts) => {
    const group = grouped[pts];
    if (group.length === 1) { group[0].isTied = false; result.push(group[0]); }
    else if (group.length === 2) {
      const h = headToHead(group[0].idx, group[1].idx);
      if (h < 0) { group[0].isTied = false; group[1].isTied = false; result.push(group[0], group[1]); }
      else if (h > 0) { group[0].isTied = false; group[1].isTied = false; result.push(group[1], group[0]); }
      else { group[0].isTied = true; group[1].isTied = true; result.push(group[0], group[1]); }
    } else {
      const winners = group.filter((p) => beatAll(p.idx, group));
      if (winners.length === 1) {
        winners[0].isTied = false;
        const rest = group.filter((p) => p.idx !== winners[0].idx);
        rest.forEach((p) => { p.isTied = true; });
        result.push(winners[0], ...rest.sort((a, b) => b.wins - a.wins || a.losses - b.losses));
      } else {
        group.forEach((p) => { p.isTied = true; });
        result.push(...group.sort((a, b) => b.wins - a.wins || a.losses - b.losses));
      }
    }
  });
  return result;
}

// The nickname(s) currently ranked #1 (canonical spelling). Empty when no match
// has been played (no leader yet). A resolved tie-break yields a sole leader; an
// unresolved tie at the top yields everyone in that top group.
function currentLeaders(players, results) {
  const list = players || [];
  const ranked = rankStandings(calcStandings(list, results), results);
  const top = ranked[0];
  if (!top || top.pts <= 0) return [];
  if (!top.isTied) return [list[top.idx]];
  const leaders = [];
  for (const s of ranked) { if (s.pts === top.pts && s.isTied) leaders.push(list[s.idx]); else break; }
  return leaders;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create-tournament: validate the setup fields, pick the next id/order, build the
// registry entry. Required: style, mapType, mapSize, nation; gloryTier when style
// is glory; botDifficulty when botCount > 0. Title auto-increments ("Tournament N").
// ─────────────────────────────────────────────────────────────────────────────

function validateNewTournament(fields) {
  const s = fields || {};
  const missing = [];
  const style = String(s.style == null ? '' : s.style).toLowerCase();
  if (style !== 'might' && style !== 'glory') missing.push('style (might or glory)');
  if (!s.mapType) missing.push('map type');
  if (!s.mapSize) missing.push('map size');
  if (!s.nation) missing.push('nation');
  if (style === 'glory' && !s.gloryTier) missing.push('glory tier');
  const bots = (s.botCount == null || s.botCount === '') ? 0 : Number(s.botCount);
  if (bots > 0 && !s.botDifficulty) missing.push('bot difficulty');
  return { ok: missing.length === 0, missing };
}

function nextTournamentId(registry) {
  let maxOrder = 0;
  for (const [id, t] of Object.entries(registry || {})) {
    if (!t || id.startsWith('_')) continue;
    const o = typeof t.order === 'number' ? t.order : 0;
    if (o > maxOrder) maxOrder = o;
  }
  let order = maxOrder + 1;
  let id = 't' + order;
  while (registry && Object.prototype.hasOwnProperty.call(registry, id)) { order++; id = 't' + order; }
  return { id, order };
}

function buildTournamentEntry(fields, order) {
  const s = fields || {};
  const style = String(s.style == null ? '' : s.style).toLowerCase();
  const setup = { mapType: s.mapType, mapSize: s.mapSize, nation: s.nation, style };
  if (style === 'glory') setup.gloryTier = s.gloryTier;
  const bots = (s.botCount == null || s.botCount === '') ? 0 : Number(s.botCount);
  if (bots > 0) { setup.botCount = bots; setup.botDifficulty = s.botDifficulty; }
  return { order, title: 'Tournament ' + order, legacy: false, setup, players: [] };
}

// Announcements: pick score docs that still need announcing (have a winner and
// are not yet notified). `scores` is the RTDB map under tournaments/<tid>/scores.
function selectAnnouncements(scores) {
  return Object.entries(scores || {})
    .filter(([, s]) => s && s.winner_nickname && s.notified !== true)
    .map(([matchId, s]) => ({ matchId, ...s }));
}

function announcementText(score, tournamentTitle) {
  const title = tournamentTitle || score.tournament_id || 'the tournament';
  const suffix = score.result ? ` (${score.result})` : '';
  return `🏆 ${score.winner_nickname} beat ${score.loser_nickname} in ${title}${suffix}.`;
}

module.exports = {
  normalizeNick,
  sanitizeKey,
  pickLatestTid,
  matchRoster,
  helpText,
  addPlayerToList,
  routeCommand,
  normalizeIntent,
  classifyIntent,
  intentCatalog,
  buildTranscript,
  INTENTS,
  buildWinRecord,
  calcStandings,
  rankStandings,
  currentLeaders,
  validateNewTournament,
  nextTournamentId,
  buildTournamentEntry,
  selectAnnouncements,
  announcementText,
  COMMANDS,
};
