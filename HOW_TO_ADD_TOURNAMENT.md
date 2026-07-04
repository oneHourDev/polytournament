# How to Add a Tournament

There are now **two kinds** of tournament pages:

| Kind | Pages | How a new one is added |
|------|-------|------------------------|
| **Legacy (1–4)** | `index1.html` … `index4.html` | Frozen. Keep working exactly as before. Don't add new ones this way. |
| **Dynamic (5+)** | The hub, `index.html` | **No new files, no code, no new Firebase node.** Add one child under `tournaments`. |

Shared code lives in:
- `tournament-common.css` – styles
- `tournament-common.js` – logic (scoring, rendering, the dynamic hub)

---

## The dynamic hub (`index.html`)

`index.html` reads a **registry** from the Firebase Realtime Database node
`tournaments`, builds the navigation menu from it, and renders the selected
tournament in place.

- Legacy entries (`legacy: true`) are just menu links to `indexN.html`.
- Dynamic entries carry a full `setup` + `players` config and render inside the
  hub. They are addressed by URL hash: `index.html#t=<id>` (e.g. `#t=t5`).
- With no hash, the hub shows the **newest** dynamic tournament (highest `order`).

### Where match results are stored

Everything about a dynamic tournament — **config *and* match results** — lives
inside its registry entry:

```
tournaments/
  t5/
    order, title, legacy, setup{…}, players[…]   ← config
    results/                                       ← match results
      "0-1": "1:0"
      "2-3": "0:1"
```

Because results are nested under `tournaments` (not a separate top-level node),
creating a tournament never requires a new database node or a new security
rule. Legacy tournaments 1–4 still use their own top-level nodes
(`results`, `tournament2`, `tournament3`, `tournament4`) — unchanged.

---

## Add a new dynamic tournament (Tournament 5, 6, …)

### 1. One-time Firebase rules (already done for this project)

The rules in **`firebase-rules.json`** open the `tournaments` node (which holds
every dynamic tournament's config *and* results) plus the four legacy nodes.
They're already published for this project, so **adding tournaments needs no
further rule changes, ever.** To reapply them: Firebase Console → Realtime
Database → **Rules** → paste `firebase-rules.json` → **Publish**.

### 2. Add a registry entry

In the console, open the `tournaments` node and add a child. The `id` you
choose (e.g. `t6`) is what appears in the URL as `#t=t6`.

```jsonc
"t6": {
  "order": 6,                    // menu order; newest = shown by default
  "title": "Tournament 6",
  "legacy": false,               // false = rendered by the hub

  "setup": {
    "mapType": "Drylands",             // Map type
    "mapSize": "Normal (196 tiles)",   // Map size
    "botCount": 14,                    // Number of bots
    "botDifficulty": "Crazy",          // Bot difficulty (optional)
    "nation": "Ai-Mo",                 // Nation
    "style": "glory",                  // "might" or "glory"
    "gloryTier": "15k"                 // only for glory: "5k" | "10k" | "15k" | "20k" | "25k"
  },

  "players": [
    "OneHourPlayer",
    "MorPet87"
    // …add the rest
  ]
}
```

`players` is a **simple list of nicknames** — nothing else. The avatar is not
stored in the database; the app derives it from the nickname as
`resources/img/<nickname>.jpeg`. So the nickname must match the image filename
exactly (case-sensitive). If no image exists, it falls back to auto-generated
initials.

Don't add a `results` child yourself — the app creates
`tournaments/t6/results` the first time a match result is saved.

The header subtitle is generated automatically from `setup`, e.g.:
`Style: Glory 15k · Map: Drylands · Size: Normal (196 tiles) · Nation: Ai-Mo · Bots: 14 Crazy`
(For `"style": "might"` the tier is omitted and it reads `Style: Might`.)

### 3. Player avatars

Avatars are **not** in the database. Put each player's image at
`resources/img/<nickname>.jpeg` (filename must match the nickname exactly).
Missing images fall back to auto-generated initials. An optional winner video
can be added at `resources/video/<nickname>.mp4`.

That's it — reload `index.html` and the new tournament appears in the menu.

---

## Seeding / editing the registry from the command line

Instead of the console UI you can edit `scripts/tournaments-seed.json` and push
it (requires Node 18+):

```bash
node scripts/seed-firebase.mjs          # merge (PATCH) the registry — preserves saved results
node scripts/seed-firebase.mjs --verify # read it back
```

`seed-firebase.mjs` uses PATCH per entry, so re-running it updates config
without wiping any `results` already saved under a tournament.

---

## Registry field reference

| Field | Applies to | Meaning |
|-------|-----------|---------|
| `order` | all | Menu order (ascending). Newest dynamic = default view. |
| `title` | all | Menu label + page heading. |
| `legacy` | all | `true` → menu link to `href`. `false` → rendered by the hub. |
| `href` | legacy | Target page, e.g. `index2.html`. |
| `setup.mapType` | dynamic | Map type. |
| `setup.mapSize` | dynamic | Map size. |
| `setup.botCount` | dynamic | Number of bots. |
| `setup.botDifficulty` | dynamic | Bot difficulty (optional). |
| `setup.nation` | dynamic | Nation. |
| `setup.style` | dynamic | `"might"` or `"glory"`. |
| `setup.gloryTier` | dynamic | Glory score tier (only when style is glory). |
| `players[]` | dynamic | Simple list of nicknames (strings). Avatar derived as `resources/img/<nickname>.jpeg`. Round-robin derived from length. |
| `results` | dynamic | Auto-created by the app under `tournaments/<id>/results`. Don't hand-edit. |

## What is shared (do not edit per tournament)

🔒 Styling, scoring/ranking logic, matrix/scoreboard/popup UI, Firebase config.
