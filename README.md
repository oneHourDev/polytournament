# Polytournament

A small static tournament hub for GitHub Pages.

## Structure

- `index.html` is the public hub at `/polytournament/`.
- `data/tournaments.json` is the source of truth for tournament metadata.
- `templates/tournament.html` is the reusable tournament detail page template.
- `assets/styles.css`, `assets/home.js`, and `assets/tournament.js` contain the shared styling and browser behavior.
- `fight-X/index.html` files are generated static tournament pages.

## Creating A Tournament

1. Open the homepage and click `New Tournament`.
2. Log in with the simple creator credentials.
3. Fill out the setup form and confirm.
4. Add the generated JSON entry to `data/tournaments.json`.
5. Run:

```sh
node scripts/generate-tournaments.js
```

6. Commit and push the changed JSON plus generated `fight-X/index.html` page.

The generator validates that tournament ids are sequential and that slugs match `fight-X`.

## Scores

Tournament settings and generated pages are static. Match scores are saved per tournament in Firebase at `results/fight-X`, with a browser `localStorage` fallback key of `polytournament-results-fight-X`.

If you want scores baked into the static data later, copy them into the tournament's `scoreResults` object in `data/tournaments.json` and regenerate the pages.

## GitHub Pages

The site has no build step or backend. GitHub Pages can serve it directly from the repository root. Generated tournament folders support direct navigation such as:

```text
https://onehourdev.github.io/polytournament/fight-1/
```
