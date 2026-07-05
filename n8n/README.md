# n8n workflows (Whapi.Cloud + Firebase REST, no Cloud Functions)

Two importable workflows connect a WhatsApp group to the tournament tracker via
**Whapi.Cloud** (a hosted WhatsApp gateway — no infrastructure to run) and
Firebase's **REST API**. No Cloud Functions, no Blaze. All secrets live in n8n.

| File | Trigger | What it does |
|------|---------|--------------|
| `whatsapp-signin.workflow.json` | Webhook (Whapi inbound) | Routes `/`-commands: `/sign-in` looks up the nickname in the `nickname_number_mapping` Data Table, matches the roster, **writes** `participants/<Nickname>`, and replies; any other command replies "Command not recognized". |
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

## Command routing (separate nodes)

```
Webhook → Config → Parse Message → Is a command? ─true→ Route Command ┬ /sign-in → Get Nickname → Handle /sign-in
                                        └false→ (ignored)             └ (default) → Command Not Recognized
```

- **Parse Message** ignores the bot's own messages (`from_me`) and anything that
  isn't a `/command`.
- **Route Command** (Switch) sends `/sign-in` to its handler; **any other
  command** falls through to the **Command Not Recognized** node, which replies
  "Command not recognized." Add more commands as extra Switch outputs + handler
  nodes later.

## How announcements work (no push, no Blaze)

The web app writes each result to `tournaments/<tid>/scores/<matchId>` with
`notified:false`. The schedule workflow polls, sends via Whapi, and flips
`notified` to `true`. A correction rewrites the doc with `notified:false`, so it
re-announces next tick. Tune the interval on the **Every minute** node.

## Keep logic in sync

The Code nodes mirror **`lib/bot-logic.js`**, which is unit-tested (`npm test`).
Test the sign-in decision logic against live Firebase with
`node scripts/bot-cli.mjs /sign-in <nickname>`.
