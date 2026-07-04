'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Firebase Cloud Functions entrypoints for the WhatsApp bot integration.
//
// All domain logic lives in ./lib/core.js (pure + unit-tested). This file only
// wires the real Firebase Admin SDK and configuration into that logic.
//
// Configuration (set before deploy):
//   firebase functions:config:set n8n.secret="..." n8n.webhook_url="https://.../webhook"
//   (or provide env vars N8N_SHARED_SECRET / N8N_WEBHOOK_URL)
// ─────────────────────────────────────────────────────────────────────────────

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const core = require('./lib/core');

// db adapter over Admin RTDB (admin bypasses security rules).
const db = {
  async get(path) {
    const snap = await admin.database().ref(path).get();
    return snap.exists() ? snap.val() : null;
  },
  async set(path, value) {
    await admin.database().ref(path).set(value);
  },
  async update(path, value) {
    await admin.database().ref(path).update(value);
  },
};

function cfg() {
  const c = (functions.config && functions.config()) || {};
  const n8n = c.n8n || {};
  return {
    secret: n8n.secret || process.env.N8N_SHARED_SECRET || '',
    webhookUrl: n8n.webhook_url || process.env.N8N_WEBHOOK_URL || '',
  };
}

// ── Feature 1: inbound bot commands (n8n → here) ─────────────────────────────
// n8n POSTs { command, nickname } with header `x-webhook-secret: <shared secret>`.
// nickname is resolved from the sender's phone INSIDE n8n; no phone reaches here.
exports.botCommand = functions.https.onRequest(async (req, res) => {
  try {
    const { secret } = cfg();
    const result = await core.handleRequest({
      headers: req.headers || {},
      body: req.body || {},
      expectedSecret: secret,
      db,
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('botCommand failed:', e);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── Feature 2: score → WhatsApp announcement (here → n8n) ─────────────────────
// Fires once per NEW score (onCreate only — corrections/edits do not re-notify).
// The winner is taken from the explicit `winner_nickname` field, never computed.
exports.onScoreCreate = functions.database
  .ref('tournaments/{tid}/scores/{matchId}')
  .onCreate(async (snapshot, context) => {
    const { secret, webhookUrl } = cfg();
    const score = snapshot.val();
    const tid = context.params.tid;
    const tournament = await db.get(`tournaments/${tid}`);
    return core.handleScoreCreate({
      score,
      tournamentId: tid,
      matchId: context.params.matchId,
      tournament,
      secret,
      postWebhook: (payload, sec) => core.postJson(webhookUrl, payload, sec),
      setNotified: () => snapshot.ref.child('notified').set(true),
    });
  });
