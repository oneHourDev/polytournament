# WhatsApp Bot Integration

Two features connect a WhatsApp group to this tournament tracker through a
private **n8n** layer. n8n is the only component that ever sees phone numbers.

```
WhatsApp group  ⇄  n8n (private)  ⇄  Cloud Functions (this repo)  ⇄  Firebase RTDB  ⇄  frontend
                     │                                                  ▲
   phone → nickname  │  nicknames only ─────────────────────────────────┘
   resolved here     │
```

> **No PII rule.** Phone numbers and any personal data live **only** in n8n.
> This repo, its Firebase schema, and the frontend store and transmit
> **nicknames only**. Verified by tests (payload PII assertion) and by design.

---

## Architecture note (RTDB, not Firestore)

This project uses the **Realtime Database** with a static frontend. The spec's
"collection" / "score doc" concepts are mapped onto RTDB nodes as below. All bot
logic is pure and unit-tested in `functions/lib/core.js`; `functions/index.js`
only wires the Firebase Admin SDK to it.

---

## Data model

```
tournaments/<tid>/
  order, title, setup{…}, players:[ "Nick1", "Nick2", … ]   # expected roster (invite list)
  results/<matchId>            = "1:0"                        # positional; drives ranking (unchanged)
  scores/<matchId>             = {                            # NEW: event record that feeds the bot
      result: "1:0",
      winner_nickname: "MorPet87",
      loser_nickname:  "WestieWarrior",
      row_nickname, col_nickname,
      match_id: "0-1",
      notified: false,          # set true by onScoreCreate after announcing
      created_at: <ms>
  }
  participants/<Nickname>      = {                            # NEW: who signed in
      nickname, status:"signed_in", joined_at:<ms>, tournament_id
  }

latest_tournament = "<tid>"     # NEW top-level pointer (optional; see fallback)
```

- **Roster vs participants:** `players[]` is the expected roster. `/sign-in`
  matches against it and writes a `participants/<Nickname>` record. The frontend
  shows a ✓ badge for signed-in players.
- **`latest_tournament` pointer** lets n8n/functions target the right tournament
  without tracking state. If unset/unreadable, both the Cloud Function and the
  frontend **fall back to the highest-`order` tournament** — so it is optional.
- **`scores` vs `results`:** `results` (positional strings) still drives the
  battle-tested ranking math untouched. `scores` is the authoritative
  "who won" record with an explicit `winner_nickname`, written alongside on
  every save. This avoids a risky refactor of the scoring core. *(Decision — see
  bottom; flag if you'd rather collapse them.)*

---

## Feature 1 — `/sign-in`

**Flow:** In the group, `@bot /sign-in` → n8n resolves sender phone → nickname
(privately) → n8n POSTs to the `botCommand` function with the nickname only.

### Endpoint (exposed by this repo)

`POST https://<region>-<project>.cloudfunctions.net/botCommand`

Headers: `x-webhook-secret: <shared secret>` · `Content-Type: application/json`

Request:
```json
{ "command": "/sign-in", "nickname": "MorPet87" }
```

Responses:

| Case | HTTP | Body |
|------|------|------|
| Signed in | 200 | `{ "ok": true, "nickname": "MorPet87", "tournament_id": "t5", "status": "signed_in", "joined_at": <ms> }` |
| Not on roster | 404 | `{ "ok": false, "error": "not_recognized", "message": "…", "tournament_id": "t5" }` |
| No nickname | 400 | `{ "ok": false, "error": "missing_nickname", … }` |
| No active tournament | 404 | `{ "ok": false, "error": "no_tournament", … }` |
| Unknown command | 400 | `{ "ok": false, "help": true, "commands": [ … ] }` |
| `/create-tournament` | 501 | `{ "error": "not_implemented", "help": true, "commands": [ … ] }` |
| Bad/missing secret | 401 | `{ "ok": false, "error": "unauthorized" }` |

- Matching is **case-insensitive + whitespace-trimmed**; the canonical roster
  spelling is returned and stored.
- Unknown/blank commands return a **help payload** so n8n can relay the command
  list. `/create-tournament` is advertised but not yet implemented.

---

## Feature 2 — Score → WhatsApp announcement

**Trigger:** `onScoreWrite` on `tournaments/{tid}/scores/{matchId}`, **onWrite** —
announces on new scores **and on corrections**. The frontend rewrites the doc
with `notified: false` on every save, so a genuine correction re-announces,
while the function's own `notified: true` follow-up write is skipped (no trigger
loop) and deletes (null value) are ignored.

The winner is taken from the explicit **`winner_nickname`** field (never
computed from raw scores, avoiding draw/tie ambiguity). The function POSTs to the
n8n webhook, then sets `notified: true`.

### Webhook payload contract (this repo → n8n) — stable

`POST <N8N_WEBHOOK_URL>` with header `x-webhook-secret: <shared secret>`:

```json
{
  "event": "match_result",
  "tournament_id": "t5",
  "tournament_title": "Tournament 5",
  "match_id": "0-1",
  "winner_nickname": "MorPet87",
  "loser_nickname": "WestieWarrior",
  "players": ["MorPet87", "WestieWarrior"],
  "result": "1:0",
  "timestamp": "2026-07-04T12:00:00.000Z"
}
```

Nicknames only. n8n turns this into a group message.

---

## Deployment

1. **Publish DB rules** (adds the `latest_tournament` node):
   Firebase Console → Realtime Database → Rules → paste `firebase-rules.json` → Publish.
   (Optional but recommended — enables the pointer; everything falls back without it.)
2. **Configure secrets** and deploy Functions (Blaze plan required):
   ```bash
   cd functions && npm install
   firebase functions:config:set n8n.secret="<shared-secret>" n8n.webhook_url="https://<n8n-host>/webhook/<id>"
   firebase deploy --only functions
   ```
   (Or set env vars `N8N_SHARED_SECRET` / `N8N_WEBHOOK_URL`.)
3. **Import the n8n workflows** from [`n8n/`](n8n/README.md) (`whatsapp-signin`
   and `score-announcement`) and follow [`n8n/README.md`](n8n/README.md): set the
   env vars, wire your WhatsApp provider, and point
   `n8n.webhook_url` at the score-announcement webhook. The same shared secret is
   sent both ways.

## Security

- Both directions require the shared secret header (`x-webhook-secret`). A
  missing/invalid secret is rejected with 401; an **unconfigured** server also
  rejects (fails closed).
- The Cloud Functions use the Admin SDK, which bypasses DB rules. The frontend
  only **reads** `participants` / `latest_tournament`.
- ⚠ **Lockdown TODO:** the RTDB currently has no auth, so `tournaments` /
  `latest_tournament` are publicly writable (matching the pre-existing posture).
  When auth is added, restrict writes on `participants`, `scores.notified`, and
  `latest_tournament` to the Functions service account.

## Open decisions (flagged for a human call)

1. **onCreate vs onWrite** — implemented **onWrite**: corrections re-announce
   (the frontend resets `notified: false` on every save, and the function's own
   `notified: true` write is skipped, so there is no trigger loop).
2. **`scores` parallel to `results`** — kept the positional `results` for
   ranking and added `scores` for the explicit winner/notification record.
   Low-risk but two nodes to keep consistent (the frontend writes/deletes both
   together). Alternative: make `scores` authoritative and derive `results`.
3. **Frontend caching** — the registry is cached in `localStorage`; on a failed
   read the last good registry is shown with an "Offline" toast. Results are not
   cached beyond the existing per-tournament localStorage fallback.
