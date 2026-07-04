# n8n workflows

Two importable workflows that connect a WhatsApp group to the tournament tracker.
They are built from **n8n core nodes only** (Webhook, Code, IF, HTTP Request,
Respond to Webhook) so they import into any n8n instance without community nodes.

| File | Direction | Purpose |
|------|-----------|---------|
| `whatsapp-signin.workflow.json` | WhatsApp → repo | Handles `@bot /sign-in`, resolves phone→nickname **privately**, calls the `botCommand` Cloud Function, replies in the group. |
| `score-announcement.workflow.json` | repo → WhatsApp | Receives the score webhook from the `onScoreWrite` Cloud Function and posts the result to the group. |

## Import

n8n → **Workflows** → **Import from File** → select each `*.workflow.json`.
They import **inactive**; review, wire your provider (below), then activate.

## Environment variables (n8n → Settings → Variables, or host env)

| Var | Used by | Value |
|-----|---------|-------|
| `CF_BOTCOMMAND_URL` | sign-in | The deployed `botCommand` URL, e.g. `https://<region>-polytournament-87d5b.cloudfunctions.net/botCommand` |
| `N8N_SHARED_SECRET` | both | The **same** shared secret you set in `functions:config:set n8n.secret=...` |
| `WA_SEND_URL` | both | Your WhatsApp provider's "send message" endpoint |
| `WA_GROUP_ID` | announcements | The target group chat id |

## The PII boundary (important)

Phone numbers exist **only** in the sign-in workflow's **`Resolve Nickname`**
Code node. Replace its placeholder `DIRECTORY` map with a private lookup (n8n
data store, a DB, or an HTTP call). Everything it sends onward — and everything
this repo/Firebase stores — is nicknames only.

## Provider wiring (the two spots to adapt)

These workflows are provider-agnostic. Adapt to WAHA / Evolution API / Twilio /
Meta Cloud API at exactly two places:

1. **Inbound** (sign-in): point your provider's incoming-message webhook at
   `POST https://<your-n8n>/webhook/whatsapp-inbound`. Then adjust the field
   paths in the **`Parse Command`** node (`text`, `from`, `chatId`) to match your
   provider's payload.
2. **Outbound** (both): the **`Send WhatsApp …`** HTTP Request nodes POST
   `{ chatId, text }` to `WA_SEND_URL`. Adjust the body shape to your provider's
   send API if different.

## Connect the Cloud Function to workflow 2

Set the function's webhook target to this workflow's URL:

```bash
firebase functions:config:set n8n.webhook_url="https://<your-n8n>/webhook/score-announcement"
```

The function sends `x-webhook-secret`; workflow 2's **Verify Shared Secret** node
rejects anything that doesn't match `N8N_SHARED_SECRET` (401).

## Payload contract

The inbound side of workflow 2 expects exactly the payload documented in
[`../WHATSAPP_INTEGRATION.md`](../WHATSAPP_INTEGRATION.md) ("Webhook payload contract").

> Node `typeVersion`s target n8n ~1.x core nodes. If your n8n is older/newer and
> a node imports with a version warning, open it and re-save — the parameters are
> standard.
