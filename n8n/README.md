# WhatsApp bot + announcements (n8n · Whapi.Cloud · Firebase REST)

Two importable n8n workflows connect a WhatsApp group to the tournament tracker
via **Whapi.Cloud** (a hosted WhatsApp gateway — no infrastructure to run) and
Firebase's **REST API**. No Cloud Functions, no Blaze — everything runs on the
free Spark plan, and **all secrets live in n8n**.

```
WhatsApp group ⇄ Whapi.Cloud ⇄ n8n (private) ──REST──▶ Firebase RTDB ◀── frontend
   (bot number,    (hosted        │                       ▲
    scan QR)        gateway)      │  nicknames only        │  reads players + results
                phone → nickname  │                        │  writes scores (notified:false)
                resolved here — ALL secrets in n8n
```

> **No PII in the repo, Firebase, or the frontend.** Phone numbers live **only**
> inside n8n (the `nickname_number_mapping` Data Table). Everything downstream —
> Firebase, the frontend, this repo — stores/transmits **nicknames only**.

| File | Trigger | What it does |
|------|---------|--------------|
| `whatsapp-signin.workflow.json` | Webhook (Whapi inbound) | An **AI node (Claude Haiku)** classifies the @mention into an intent (`sign_in` / `report_win` / `help` / `start_tournament`, else `unknown`) and routes it to a handler (see below). Unknown → a funny AI roast reply. |
| `score-announcement.workflow.json` | Schedule (every minute) | Polls the active tournament's `scores`, announces any with a winner and `notified != true` via Whapi, then marks them `notified: true`. |

Built from **core nodes only** (Webhook, Schedule, Set, Code, Switch, If). Firebase
reads/writes and Whapi calls use `this.helpers.httpRequest` inside the Code nodes.

## Data model (Firebase RTDB)

```
tournaments/<tid>/
  order, title, legacy:false
  setup{ style ("might"|"glory"), gloryTier?, mapType, mapSize, nation,
         botCount?, botDifficulty? }        # gloryTier if glory; botDifficulty if botCount>0
  players:[ "Nick1", … ]     # THE player list: who is in the tournament. Sign-in
                             # appends to it; also hand-editable. The board renders
                             # it. Result keys index into it (append-only = stable).
  results/<a>-<b>          = "1:0"           # positional (players index); drives ranking
  scores/<a>-<b>           = { winner_nickname, loser_nickname, result,
                               notified:false, created_at, … }  # app OR bot report_win
latest_tournament = "<tid>"                  # active pointer; sign-in/report/create target it
```

Avatars aren't stored — the frontend derives each from the nickname as
`resources/img/<nickname>.jpeg` (falls back to initials). Adding a tournament is
just one child under `tournaments`; the bot's `start_tournament` does exactly that
(or hand-edit it in the Firebase console).

## 1. Whapi.Cloud setup (links your bot number)

1. Create a Whapi.Cloud account → create a **channel** → **scan the QR** with the
   phone that will be the bot (this is where your number connects — like linking
   WhatsApp Web). ⚠ Use a dedicated/second number if you can; unofficial gateways
   carry a small ban risk on personal numbers.
2. Copy the channel **token** (a Bearer token) → this becomes `WHAPI_TOKEN` in n8n.
3. In the channel's **webhook / settings**, set the inbound webhook URL to your
   n8n webhook: `https://<your-n8n-cloud>/webhook/whatsapp-inbound`, for **message**
   events. (Import the sign-in workflow first so the webhook URL exists; use the
   **Production URL** from the Webhook node.)
4. Get the **group id** you want announcements posted to (a `...@g.us` id — Whapi's
   API/dashboard lists your groups) → `WA_GROUP_ID`.

## 2. Import the workflows

n8n → **Workflows** → **Import from File** → each `*.workflow.json`. They import
**inactive**. Set the variables below, then activate both.

## 3. n8n Variables (Settings → Variables)

On **n8n Cloud** you can't set custom environment variables, so these workflows
read config from **n8n Variables** (`$vars`). Add each one under
**Settings → Variables** (all secrets stay inside n8n):

| Variable | Used by | Value |
|----------|---------|-------|
| `WHAPI_TOKEN` | both | Your Whapi channel Bearer token |
| `WHAPI_BASE` | both | *(optional)* defaults to `https://gate.whapi.cloud` |
| `WA_GROUP_ID` | announcements | Target group id (`...@g.us`) |
| `FIREBASE_DB_URL` | both | `https://polytournament-87d5b-default-rtdb.firebaseio.com` |
| `FIREBASE_AUTH_QS` | both | *(optional)* `?auth=<token>` if you lock down the DB |
| `ANTHROPIC_API_KEY` | classify / create / chat | Anthropic API key for intent classification, tournament-setup extraction, and the roast chat. If unset, classification falls back to keywords and chat replies a canned line. |
| `ANTHROPIC_MODEL` | classify / create / chat | *(optional)* defaults to `claude-haiku-4-5-20251001` |
| `HUB_BASE_URL` | create | *(optional)* base URL of the hub for the tournament link; defaults to `https://polytournament-87d5b.web.app` (→ `<base>/#t=<id>`) |

> If your n8n plan doesn't include Variables, either paste the values directly
> into the **Config** node fields, or store the Whapi token as an HTTP **Header
> Auth credential** instead.

## Phone→nickname mapping (n8n Data Table)

The mapping lives in an n8n **Data Table** called **`nickname_number_mapping`**
with two columns: **`number`** (sender's phone, digits only, international, no `+`)
and **`nickname`**. Phone numbers stay inside n8n; only the nickname flows onward,
so Firebase and the frontend still see nicknames only.

After importing, open the **`Get Nickname (Data Table)`** node and:
1. Select your **`nickname_number_mapping`** table in the *Data Table* dropdown.
2. Confirm the operation is **Get Row(s)** with the filter **`number` equals
   `{{ $json.number }}`** (the digits parsed from the inbound message).

Add a row per player, e.g. `number = 420123456789`, `nickname = MorPet87`.

## Command routing (mention-gated, AI intent classifier)

```
Webhook → Config → Parse Message → Bot mentioned? ─true→ AI Classify (Claude) → Route Command ┬ sign_in          → Get Nickname → Handle sign-in
                                        └false→ (ignored)                                     ├ help             → Handle help
                                                                                              ├ start_tournament → Get Creator → Handle start-tournament
                                                                                              ├ report_win       → Get Opponent → Get Sender → Handle defeated
                                                                                              └ unknown          → AI Chat (Claude)
```

- **The bot only reacts when it is @mentioned.** `Parse Message` checks
  `messages[0].context.mentions` for the **bot number** (set in the `Config`
  node's `botNumber`, default `420776374284`), and ignores the bot's own
  messages (`from_me` or `from === botNumber`). Everything else is dropped.
- **No exact command needed — say it however you like.** The `AI Classify
  (Claude)` node reads the message and picks one intent (`sign_in`,
  `report_win`, `help`, `start_tournament`, or `unknown`). "add me", "sign me
  up", "I beat @player", "porazil som @player" all work, in English or CZ/SK.
- **The AI classifies intent ONLY.** It never touches Firebase and never invents
  data: the opponent for `report_win` comes from the message's `@mentions`
  (parsed into `targetPlayers`), the Data Table resolves the nickname, and every
  write stays in the (tested) handler nodes.
- **Fallback, never a dead bot.** If the Anthropic call errors, returns junk, or
  `ANTHROPIC_API_KEY` is unset, the node degrades to the deterministic
  `classifyIntent` keyword matcher (mirrored from `lib/bot-logic.js`).
- **Route Command** (Switch) routes on `intent`; `unknown` (and anything
  unmatched) falls through to **AI Chat (Claude)** — a playful roast reply.
  Replies tag the requester (`@<sender>`).

| Intent | Example phrasings | Node | Status |
|--------|-------------------|------|--------|
| `sign_in` | "sign me in", "add me", "prihlás ma" | Handle sign-in | ✅ implemented (Data Table → append nickname to `players`) |
| `help` | "help", "what can you do", "pomoc" | Handle help | ✅ lists commands, tags requester |
| `start_tournament` | "create a glory 15k tournament, Drylands, Normal, Ai-Mo, 14 Crazy bots" | Get Creator → Handle start-tournament | ✅ **leader-only**: Claude extracts the setup, validates required fields, creates `t(N+1)` (empty players) and sets it active — see below |
| `report_win` | "I beat @player", "porazil som @player" | Get Opponent → Get Sender → Handle defeated | ✅ resolves winner (sender) + loser (tagged), then writes `results/<a>-<b>` **and** `scores/<a>-<b>` (feeds ranking + announcements), mirroring the web app's `saveScore` |
| `unknown` | *(anything else)* | AI Chat (Claude) | ✅ **roast mode** — pulls the last ~30 group messages from Whapi for context and fires back a short, funny Polytopia-flavored jab (see below) |

**Mentions:** Whapi only tags a person if the send request includes **both** the
`@<number>` in the body **and** a `mentions: ["<number>", …]` array. Every reply
node does this (tagging the requester, and the opponent for `defeated`).

## Creating a tournament (`start_tournament`, leader-only)

`Get Creator (Data Table)` resolves the requester's nickname, then
`Handle start-tournament`:

1. **Authorizes** — only the player **currently ranked #1** in the active
   tournament may create the next one (it need **not** be finished). The bot
   recomputes the standings with `currentLeaders` (a faithful port of the web
   scoreboard's `calcStats`/`sortByRank` — points = wins, head-to-head /
   beat-all-in-group tie-breaks). An unresolved tie at the top lets any tied
   leader create; if no match has been played yet, nobody can (no leader).
2. **Extracts** the setup from the message with **Claude** into
   `{ style, gloryTier, mapType, mapSize, nation, botCount, botDifficulty }`
   (EN/CZ/SK).
3. **Validates** required fields — `style`, `mapType`, `mapSize`, `nation` are
   mandatory; `gloryTier` is required when `style` is glory; `botDifficulty` when
   `botCount > 0`. Missing anything → **denied**, replying with the exact list.
4. **Creates** `t(N+1)` — `order`/`title` auto-increment ("Tournament N"),
   `legacy:false`, the parsed `setup`, and an **empty `players` list** (players
   join via sign-in) — then **sets `latest_tournament`** to it so it's active
   immediately, and replies with a **direct link** to the board
   (`<hubUrl>/#t=<id>`).

The id/order/validation/build and ranking logic all live in the tested
`lib/bot-logic.js` (`currentLeaders`, `validateNewTournament`,
`nextTournamentId`, `buildTournamentEntry`).

## AI chat / roast fallback (`unknown` → `AI Chat (Claude)`)

Anything that isn't a command doesn't get a "not recognized" — the bot **plays
along**. Because it only runs when the bot is @mentioned, it never chats
unprompted. The node:

1. `GET`s the last ~30 messages of the group from Whapi
   (`/messages/list/<ChatID>?count=30`) and builds a transcript with
   `buildTranscript` (text only, oldest→newest, display names — never numbers).
2. Calls **Claude** with a playful "PolyBot" persona that roasts the players
   good-naturedly, leans into Polytopia flavor, and replies in the group's
   language (CZ/SK/EN). One short line, tagging the requester.
3. If Whapi context or Claude is unavailable it still replies with a canned
   quip — never a dead end.

`buildTranscript` is tested in `lib/bot-logic.js`; the persona + fetch live in the
node. Tune the persona in the `AI Chat (Claude)` node's prompt.

## How announcements work (no push, no Blaze)

The web app writes each result to `tournaments/<tid>/scores/<matchId>` with
`notified:false`. The schedule workflow polls, sends via Whapi, and flips
`notified` to `true`. A correction rewrites the doc with `notified:false`, so it
re-announces next tick. Tune the interval on the **Every minute** node.

## Keep logic in sync

The Code nodes mirror **`lib/bot-logic.js`**, which is unit-tested (`npm test`) —
the classifier (`normalizeIntent` / `classifyIntent` / `intentCatalog`), sign-in
(`addPlayerToList`), win recording (`buildWinRecord`), and tournament creation +
ranking (`currentLeaders` / `validateNewTournament` / `nextTournamentId` /
`buildTournamentEntry`). Test the sign-in decision logic against live Firebase
with `node scripts/bot-cli.mjs /sign-in <nickname>`.

## Security

- **No secrets in the frontend or the repo.** All credentials (Whapi token,
  Anthropic key, optional Firebase auth token) live in n8n Variables.
- **Phone numbers never leave n8n** — the Data Table maps `number → nickname`;
  only nicknames flow to Firebase and the frontend. The roast chat sends recent
  group **messages** (with display names, not numbers) to Anthropic for context.
- The RTDB currently has no auth (pre-existing posture), so `tournaments` /
  `latest_tournament` are publicly writable. To lock it down later, add Firebase
  auth and set `FIREBASE_AUTH_QS` in n8n; restrict public writes on `players` and
  `scores.notified` to the token n8n uses.
