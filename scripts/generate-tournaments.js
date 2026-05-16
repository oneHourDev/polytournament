#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "tournaments.json");
const templatePath = path.join(root, "templates", "tournament.html");

const data = readJson(dataPath);
const template = fs.readFileSync(templatePath, "utf8");
const tournaments = data.tournaments;

validateTournaments(tournaments);

for (const tournament of tournaments) {
  const outputDir = path.join(root, tournament.slug);
  const outputPath = path.join(outputDir, "index.html");
  const html = template
    .replaceAll("{{TITLE}}", escapeHtml(tournament.name || `Fight ${tournament.id}`))
    .replace("{{TOURNAMENT_JSON}}", serializeForScript(tournament));

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`Generated ${path.relative(root, outputPath)}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path.relative(root, filePath)}: ${error.message}`);
  }
}

function validateTournaments(items) {
  if (!Array.isArray(items)) {
    throw new Error("data/tournaments.json must contain a tournaments array.");
  }

  const ids = new Set();
  const slugs = new Set();
  const sorted = [...items].sort((a, b) => a.id - b.id);

  sorted.forEach((tournament, index) => {
    const expectedId = index + 1;
    const expectedSlug = `fight-${expectedId}`;

    if (tournament.id !== expectedId) {
      throw new Error(`Tournament ids must be sequential. Expected ${expectedId}, got ${tournament.id}.`);
    }

    if (tournament.slug !== expectedSlug) {
      throw new Error(`Tournament ${tournament.id} must use slug "${expectedSlug}".`);
    }

    if (ids.has(tournament.id)) {
      throw new Error(`Duplicate tournament id: ${tournament.id}`);
    }

    if (slugs.has(tournament.slug)) {
      throw new Error(`Duplicate tournament slug: ${tournament.slug}`);
    }

    ids.add(tournament.id);
    slugs.add(tournament.slug);
  });
}

function serializeForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
