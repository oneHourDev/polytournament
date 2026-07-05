# n8n workflows (no Cloud Functions / no Blaze)

Two importable workflows connect a WhatsApp group to the tournament tracker,
talking to Firebase over its **REST API**. No Cloud Functions, no Blaze — the
free Spark plan is enough. All secrets live in n8n.

| File | Trigger | What it does |
|------|---------|--------------|
| `whatsapp-signin.workflow.json` | Webhook (WhatsApp inbound) | Resolves phone→nickname **privately**, matches the roster, and **writes** `participants/<Nickname>` to Firebase, then replies in the group. |
| `score-announcement.workflow.json` | Schedule (every minute) | Polls the active tournament's `scores`, announces any with a winner and `notified != true`, then marks them `notified: true`. |

Both are built from **core nodes only** (Webhook, Schedule, Set, Code, Respond),
so they import into any n8n without community nodes. Firebase reads/writes and
the WhatsApp send are done with `this.helpers.httpRequest` inside the Code nodes.

## Import

n8n → **Workflows** → **Import from File** → each `*.workflow.json`. They import
**inactive**; set the variables, wire your provider, then activate.

## Environment variables (all secrets stay here)

| Var | Used by | Value |
|-----|---------|-------|
| `FIREBASE_DB_URL` | both | `https://polytournament-87d5b-default-rtdb.firebaseio.com` |
| `FIREBASE_AUTH_QS` | both | *(optional)* `?auth=<token>` if you lock down the DB; leave empty otherwise |
| `WA_SEND_URL` | both | Your WhatsApp provider's send-message endpoint |
| `WA_GROUP_ID` | announcements | Target group chat id |

## The PII boundary (important)

Phone numbers exist **only** in the `Handle Sign-in` Code node's `DIRECTORY` map.
Replace the placeholder with your private lookup (hard-coded map, an n8n data
store, or an HTTP call to your own directory). Everything it writes to Firebase —
and everything the repo/frontend sees — is nicknames only.

## Provider wiring (the two spots to adapt)

1. **Inbound** (sign-in): point your WhatsApp provider's incoming-message webhook
   at `POST https://<your-n8n>/webhook/whatsapp-inbound`, then adjust the field
   paths in `Handle Sign-in` (`body.text`, `body.from`, `body.chatId`) to match
   your provider's payload.
2. **Outbound** (both): the Code nodes POST `{ chatId, text }` to `WA_SEND_URL`.
   Adjust that body to your provider's send API if different.

## How announcements work (no push needed)

The web app already writes each result to `tournaments/<tid>/scores/<matchId>`
with `notified: false`. The schedule workflow polls, sends, and flips `notified`
to `true`. A correction rewrites the doc with `notified:false`, so it
re-announces on the next tick. Tune the interval on the **Every minute** node.

## Keep logic in sync

The Code nodes mirror **`../n8n/lib/bot-logic.js`**, which is unit-tested
(`npm test`). If you change matching or announcement rules, change both. Test the
sign-in flow end-to-end against live Firebase with `node scripts/bot-cli.mjs`.
