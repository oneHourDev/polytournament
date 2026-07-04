# How to Add a Tournament

**All** tournaments are now dynamic: they live as entries in a single Firebase
registry (`tournaments`) and are rendered by the hub (`index.html`). Adding a
tournament means **adding one child under `tournaments`** — no new files, no
code, no new database node.

Shared code lives in:
- `tournament-common.css` – styles
- `tournament-common.js` – logic (scoring, rendering, the dynamic hub)

> **Legacy pages** `index1.html` … `index4.html` (and the old top-level result
> nodes `results`, `tournament2`, `tournament3`, `tournament4`) are kept as
> read-only backups of the pre-migration data. The live site is served entirely
> by the hub; the legacy pages are no longer linked and can be removed later.

---

## The dynamic hub (`index.html`)

`index.html` reads the **registry** from the Firebase Realtime Database node
`tournaments`, builds the navigation menu from it, and renders the selected
tournament in place.

- Each entry carries a full `setup` + `players` config and renders inside the
  hub, addressed by URL hash: `index.html#t=<id>` (e.g. `#t=t5`).
- With no hash, the hub shows the **newest** tournament (highest `order`).
- An entry may set `legacy: true` + `href` to become a plain menu link instead
  of a rendered board (not used anymore, but still supported).

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

  // "subtitle": "Game Mode: 1v1 · Drylands · Kickoo",  // optional: shows this
  //   verbatim instead of the string generated from `setup`. Used for older
  //   tournaments whose descriptor doesn't fit the structured fields below.

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
| `subtitle` | optional | Verbatim subtitle string; overrides the one built from `setup`. |
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
