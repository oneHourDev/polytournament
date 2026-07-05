# WhatsApp Bot Integration (n8n-only, no Cloud Functions)

Two features connect a WhatsApp group to the tournament tracker through a private
**n8n** layer. n8n talks to Firebase over its **REST API** — there are **no Cloud
Functions and no Blaze plan required**. Everything runs on the free Spark plan.

```
WhatsApp group  ⇄  n8n (private)  ──REST──▶  Firebase RTDB  ◀──  frontend
                     │                          ▲
   phone → nickname  │   nicknames only         │  writes scores (notified:false)
   resolved here     │                          │  reads players/participants
   ALL secrets here  ┘
```

> **No PII, no frontend secrets.** Phone numbers live **only** inside one n8n
> Code node. The repo, Firebase, and the frontend store/transmit **nicknames
> only**. The frontend holds **no** secrets and has no knowledge of n8n.

---

## Data model (RTDB)

```
tournaments/<tid>/
  order, title, setup{…}, players:[ "Nick1", … ]     # expected roster
  results/<matchId>        = "1:0"                    # positional; drives ranking
  scores/<matchId>         = { winner_nickname, loser_nickname, result,
                               notified:false, created_at, … }   # written by the app
  participants/<Nickname>  = { nickname, status:"signed_in", joined_at, tournament_id }
latest_tournament = "<tid>"                            # active-tournament pointer
```

---

## Feature 1 — `/sign-in`  (WhatsApp → Firebase, a write)

Adding a player is simply a **write** into Firebase. n8n does it directly:

1. Group message `@bot /sign-in` hits the n8n **`whatsapp-inbound`** webhook.
2. The **`Handle Sign-in`** Code node:
   - resolves sender phone → nickname (private `DIRECTORY` map — the only PII spot),
   - `GET latest_tournament` (falls back to highest-`order` tournament),
   - `GET tournaments/<tid>/players`,
   - matches the nickname (**case-insensitive + trimmed**),
   - on match: `PUT tournaments/<tid>/participants/<Nickname>`,
   - replies in the group (✅ / ⚠️ not recognized / help for unknown commands).

No repo endpoint, no shared secret exposed anywhere. The frontend shows a ✓ badge
for signed-in players (it reads `participants` with the normal tournaments read).

## Feature 2 — Score announcements  (Firebase → WhatsApp, by polling)

The app already writes a `scores/<matchId>` doc (with `winner_nickname` and
`notified:false`) whenever a result is saved. n8n announces them **without any
Firebase→outbound trigger**:

1. A **schedule** (every minute) runs the **`Poll & Announce`** Code node.
2. It reads the active tournament's `scores`, selects entries with a
   `winner_nickname` and `notified !== true`, sends each to the group, then
   `PATCH … {notified:true}`.
3. A correction re-writes the doc with `notified:false`, so it re-announces on the
   next poll. The winner is the explicit `winner_nickname` (never recomputed).

---

## The logic is unit-tested

Both Code nodes are mirrors of **`n8n/lib/bot-logic.js`** (the tested source of
truth): `resolveSignIn`, `matchRoster`, `pickLatestTid`, `selectAnnouncements`,
`announcementText`. Run `npm test` (includes `n8n/lib/bot-logic.test.js`).
`scripts/bot-cli.mjs` runs the same logic against live Firebase from your terminal.

---

## Setup (no billing)

1. **Publish DB rules** — Firebase Console → Realtime Database → Rules → paste
   `firebase-rules.json` → Publish. (Already done; enables `latest_tournament`.)
2. **Import the workflows** from [`n8n/`](n8n/README.md) and set the env vars
   (below). Put your real phone→nickname map in the `Handle Sign-in` node, and
   wire your WhatsApp provider's inbound webhook + send endpoint.
3. Activate both workflows.

### n8n environment variables (all secrets stay here)

| Var | Used by | Value |
|-----|---------|-------|
| `FIREBASE_DB_URL` | both | `https://polytournament-87d5b-default-rtdb.firebaseio.com` |
| `FIREBASE_AUTH_QS` | both | *(optional)* `?auth=<token>` if you later lock down the DB |
| `WA_SEND_URL` | both | Your WhatsApp provider's send-message endpoint |
| `WA_GROUP_ID` | announcements | Target group chat id |

---

## Security

- **No secrets in the frontend or the repo.** All credentials (WhatsApp provider,
  optional Firebase auth token) live in n8n environment variables.
- The RTDB currently has no auth (pre-existing posture), so `tournaments` /
  `latest_tournament` are publicly writable. To lock it down later, add Firebase
  auth and set `FIREBASE_AUTH_QS` in n8n; restrict public writes on
  `participants` and `scores.notified` to the token n8n uses.

## Open decisions

1. **Announcement latency** — polling every minute (adjust the schedule). No
   Blaze, secrets stay server-side. The alternative (instant push) would need a
   Cloud Function (Blaze) or the frontend calling n8n (a secret in the browser) —
   both rejected.
2. **`scores` parallel to `results`** — kept: `results` drives ranking untouched;
   `scores` carries the explicit winner + `notified` for announcements. The
   frontend writes/deletes both together.
