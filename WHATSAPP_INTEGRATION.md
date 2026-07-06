# WhatsApp Bot Integration (n8n-only, no Cloud Functions)

Two features connect a WhatsApp group to the tournament tracker through a private
**n8n** layer. n8n talks to Firebase over its **REST API** — there are **no Cloud
Functions and no Blaze plan required**. Everything runs on the free Spark plan.

```
WhatsApp group ⇄ Whapi.Cloud ⇄ n8n (private) ──REST──▶ Firebase RTDB ◀── frontend
   (bot number,    (hosted        │                       ▲
    scan QR)        gateway)      │  nicknames only        │  writes scores (notified:false)
                phone → nickname  │                        │  reads players + results
                resolved here — ALL secrets in n8n
```

> **No PII, no frontend secrets.** Phone numbers live **only** inside one n8n
> Code node. The repo, Firebase, and the frontend store/transmit **nicknames
> only**. The frontend holds **no** secrets and has no knowledge of n8n.

---

## Data model (RTDB)

```
tournaments/<tid>/
  order, title, setup{…}
  players:[ "Nick1", … ]     # THE single player list: who is in the tournament.
                             # Sign-in appends to it; also hand-editable. The board
                             # renders exactly this list. Result keys index into it.
  results/<matchId>        = "1:0"                    # positional (players index); drives ranking
  scores/<matchId>         = { winner_nickname, loser_nickname, result,
                               notified:false, created_at, … }   # written by the app OR the bot's report_win
latest_tournament = "<tid>"                            # active-tournament pointer
```

---

## Feature 1 — `/sign-in`  (WhatsApp → Firebase, a write)

Adding a player is simply a **write** into Firebase. n8n does it directly:

1. A group message hits the n8n **`whatsapp-inbound`** webhook. The bot reacts
   **only when it is @mentioned** (`messages[0].context.mentions` contains the
   bot number) and never to its own messages.
2. An **AI node (Claude Haiku)** classifies the message into one intent —
   `sign_in`, `report_win`, `help`, `start_tournament`, or `unknown` — so users
   write naturally ("add me", "I beat @player", "porazil som @player") in English
   or CZ/SK instead of exact tokens. **The AI classifies intent only:** the
   opponent comes from the message's `@mentions`, and all writes stay in the
   deterministic handlers. If the AI call fails (or no `ANTHROPIC_API_KEY`), a
   keyword fallback classifies instead — never a dead bot.
3. A **Switch** routes each intent to its own node; `unknown` replies asking the
   user to rephrase. Replies tag the requester. The **`sign_in`** handler:
   - resolves sender phone → nickname via the **`nickname_number_mapping`** n8n
     Data Table (`number` → `nickname`) — the only place a phone number appears,
   - `GET latest_tournament` (falls back to highest-`order` tournament),
   - `GET tournaments/<tid>/players`,
   - **appends the nickname to `players`** (case-insensitive dedupe keeps the
     existing spelling), then `PUT tournaments/<tid>/players` with the new list,
   - replies in the group (✅ signed in / ℹ️ already in / ⚠️ number not registered
     / ⚠️ no active tournament).

No repo endpoint, no shared secret exposed anywhere. The Data Table (number →
nickname) is the whitelist — only known numbers resolve to a nickname, so only
they can join. The frontend renders `players` directly (with the normal
tournaments read), so a sign-in shows up on the board with no extra listener.

The **`report_win`** handler ("I beat @player") records a result the same way:
it resolves **both** nicknames via the Data Table (winner = sender, loser = the
tagged opponent), `GET`s the roster to find their positions, then writes
`results/<a>-<b>` (positional, drives ranking) **and** `scores/<a>-<b>`
(`winner_nickname` + `notified:false`) — exactly what the web app's `saveScore`
writes, so the ranking updates and Feature 2 announces it. The positional/canonical
logic is the tested `buildWinRecord` in `n8n/lib/bot-logic.js`.

The **`start_tournament`** handler creates the next tournament, but **only the
player currently ranked #1** in the active tournament may do so (it need not be
finished). The bot recomputes standings with `currentLeaders` — a faithful port
of the web scoreboard (`calcStats`/`sortByRank`) — so "leader" matches what
players see. Claude then extracts the setup from the message; required fields are
`style`, `mapType`, `mapSize`, `nation` (plus `gloryTier` when glory, and
`botDifficulty` when `botCount > 0`) — anything missing is **denied with the
list**. On success it writes `tournaments/t(N+1)` (auto `order`/title, empty
`players`) and points `latest_tournament` at it, making it active. The reply
includes a **direct link** to the board (`<HUB_BASE_URL>/#t=<id>`). Logic:
`currentLeaders` / `validateNewTournament` / `nextTournamentId` /
`buildTournamentEntry` in `n8n/lib/bot-logic.js`.

Finally, an @mention that **isn't** a command falls through to **`AI Chat
(Claude)`** — a playful "PolyBot" that reads the last ~30 group messages from
Whapi (`/messages/list/<ChatID>`) for context and fires back a short, good-natured
roast in the group's language. It only runs when tagged, so it never spams. The
transcript builder (`buildTranscript`) is tested; the persona lives in the node.

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
truth): `addPlayerToList`, `matchRoster`, `pickLatestTid`, `buildWinRecord`,
`currentLeaders`, `validateNewTournament`, `nextTournamentId`,
`buildTournamentEntry`, `selectAnnouncements`, `announcementText`, and the
classifier's `normalizeIntent` / `classifyIntent` / `intentCatalog` /
`buildTranscript`. Run `npm test` (includes `n8n/lib/bot-logic.test.js`).
`scripts/bot-cli.mjs` runs the same logic against live Firebase from your terminal.

---

## Setup (no billing)

1. **Publish DB rules** — Firebase Console → Realtime Database → Rules → paste
   `firebase-rules.json` → Publish. (Already done; enables `latest_tournament`.)
2. **Set up Whapi.Cloud + import the workflows** — follow
   [`n8n/README.md`](n8n/README.md): create a Whapi channel, scan the QR to link
   the bot number, point Whapi's inbound webhook at n8n's `/webhook/whatsapp-inbound`,
   set the Variables (below), create the `nickname_number_mapping` Data Table
   (`number`, `nickname`), and select it in the `Get Nickname` node.
3. Activate both workflows.

### n8n Variables — Settings → Variables (all secrets stay here)

The bot number connects through **Whapi.Cloud** (hosted gateway — scan a QR to
link the number; see [`n8n/README.md`](n8n/README.md) step 1). On n8n Cloud the
workflows read config from **Variables** (`$vars`), not environment variables.

| Var | Used by | Value |
|-----|---------|-------|
| `WHAPI_TOKEN` | both | Your Whapi.Cloud channel Bearer token |
| `WHAPI_BASE` | both | *(optional)* defaults to `https://gate.whapi.cloud` |
| `WA_GROUP_ID` | announcements | Target group id (`...@g.us`) |
| `FIREBASE_DB_URL` | both | `https://polytournament-87d5b-default-rtdb.firebaseio.com` |
| `FIREBASE_AUTH_QS` | both | *(optional)* `?auth=<token>` if you later lock down the DB |
| `ANTHROPIC_API_KEY` | classify / create / chat | Anthropic key for classification, setup extraction, and the roast chat; unset → keyword fallback + canned quips |
| `ANTHROPIC_MODEL` | classify / create / chat | *(optional)* defaults to `claude-haiku-4-5-20251001` |
| `HUB_BASE_URL` | create | *(optional)* hub base for the tournament link; defaults to `https://polytournament-87d5b.web.app` |

---

## Security

- **No secrets in the frontend or the repo.** All credentials (WhatsApp provider,
  optional Firebase auth token) live in n8n environment variables.
- The RTDB currently has no auth (pre-existing posture), so `tournaments` /
  `latest_tournament` are publicly writable. To lock it down later, add Firebase
  auth and set `FIREBASE_AUTH_QS` in n8n; restrict public writes on
  `players` and `scores.notified` to the token n8n uses.

## Open decisions

1. **Announcement latency** — polling every minute (adjust the schedule). No
   Blaze, secrets stay server-side. The alternative (instant push) would need a
   Cloud Function (Blaze) or the frontend calling n8n (a secret in the browser) —
   both rejected.
2. **`scores` parallel to `results`** — kept: `results` drives ranking untouched;
   `scores` carries the explicit winner + `notified` for announcements. The
   frontend writes/deletes both together.
