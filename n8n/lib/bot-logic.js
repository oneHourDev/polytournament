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

// Decide the outcome of a /sign-in. Pure: n8n does the REST write when ok.
// Provide either `players` (preferred) or a `registry` to derive them from `tid`.
function resolveSignIn({ pointer, registry, players, nickname, now }) {
  const tid = pickLatestTid(pointer, registry);
  const clean = String(nickname == null ? '' : nickname).trim();
  if (!tid) return { ok: false, code: 'no_tournament', message: '⚠️ There is no active tournament right now.' };
  if (!clean) return { ok: false, code: 'missing_nickname', tid, message: '⚠️ Your number is not registered for this tournament.' };
  const roster = players || (registry && registry[tid] && registry[tid].players) || [];
  const match = matchRoster(roster, clean);
  if (!match) {
    return { ok: false, code: 'not_recognized', tid, message: `⚠️ "${clean}" is not on the player list for ${tid}.` };
  }
  const record = { nickname: match, status: 'signed_in', joined_at: (now || Date.now)(), tournament_id: tid };
  return {
    ok: true, tid, nickname: match, participantKey: sanitizeKey(match), record,
    message: `✅ ${match} — you're signed in to ${tid}.`,
  };
}

// Route a raw bot command to a reply. For /sign-in the caller runs resolveSignIn;
// everything else returns a help/placeholder message.
function routeCommand(command) {
  const cmd = normalizeNick(command).replace(/^\//, '');
  if (cmd === 'sign-in' || cmd === 'signin') return { kind: 'sign-in' };
  if (cmd === 'create-tournament') return { kind: 'reply', message: '⚙️ /create-tournament is not available yet.\n' + helpText() };
  return { kind: 'reply', message: helpText('Unknown command.') };
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
  resolveSignIn,
  routeCommand,
  selectAnnouncements,
  announcementText,
  COMMANDS,
};
