# n8n workflows (Whapi.Cloud + Firebase REST, no Cloud Functions)

Two importable workflows connect a WhatsApp group to the tournament tracker via
**Whapi.Cloud** (a hosted WhatsApp gateway — no infrastructure to run) and
Firebase's **REST API**. No Cloud Functions, no Blaze. All secrets live in n8n.

| File | Trigger | What it does |
|------|---------|--------------|
| `whatsapp-signin.workflow.json` | Webhook (Whapi inbound) | Resolves phone→nickname **privately**, matches the roster, **writes** `participants/<Nickname>` to Firebase, replies in the group via Whapi. |
| `score-announcement.workflow.json` | Schedule (every minute) | Polls the active tournament's `scores`, announces any with a winner and `notified != true` via Whapi, then marks them `notified: true`. |

Built from **core nodes only** (Webhook, Schedule, Set, Code, Respond). Firebase
reads/writes and Whapi sends use `this.helpers.httpRequest` inside the Code nodes.

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

> If your n8n plan doesn't include Variables, either paste the values directly
> into the **Config** node fields, or store the Whapi token as an HTTP **Header
> Auth credential** instead.

## The PII boundary (important)

Phone numbers exist **only** in the `Handle Sign-in` Code node's `DIRECTORY` map
(`{ '<digits-only phone>': '<nickname>' }`). Whapi delivers the sender as
`messages[0].from`; the node strips it to digits and looks up the nickname there.
Everything written to Firebase and everything the frontend sees is nicknames only.

## How the trigger works

The sign-in node reads Whapi's inbound `messages[0]`, ignores the bot's own
messages (`from_me`), and acts on any message containing a **slash command**
(`/sign-in`). (WhatsApp @mentions just tag the bot's number; if you want to
require an explicit mention, add a check for your bot number in `text`.)

## How announcements work (no push, no Blaze)

The web app writes each result to `tournaments/<tid>/scores/<matchId>` with
`notified:false`. The schedule workflow polls, sends via Whapi, and flips
`notified` to `true`. A correction rewrites the doc with `notified:false`, so it
re-announces next tick. Tune the interval on the **Every minute** node.

## Keep logic in sync

The Code nodes mirror **`lib/bot-logic.js`**, which is unit-tested (`npm test`).
Test the sign-in decision logic against live Firebase with
`node scripts/bot-cli.mjs /sign-in <nickname>`.
