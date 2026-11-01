#!/usr/bin/env node
/**
 * G-EXAMPLES — MINDEN dokumentalt pelda tenyleg lefut.
 *
 * Harom fele van, mert harom kulonbozo modon avulhat el egy pelda:
 *
 *  1. A KODBLOKKOK (statikus). Minden kodblokk a docs-lapokon (site/pages)
 *     ES a kiadott csomagok README-jeiben vagy egy elo pelda egesze
 *     (`::: example <id>`), vagy egy futo pelda / sablon kivonata
 *     (```js excerpt:example/<id>): a nem ures sorai sorrendben benne
 *     vannak a megnevezett forrasban (packages/docs/scripts/excerpts.mjs).
 *     Kivetel csak a shell es a sima szoveg. Nyelv nelkuli, jeloletlen vagy
 *     elcsuszott blokk: BUKAS. Negativ kontroll: egy megvaltoztatott es egy
 *     felcserelt sor ugyanazon a meron bukik.
 *  2. AZ ELO PELDAK (bongeszo). e2e/examples.spec.ts a felepitett oldalon:
 *     minden pelda a sajat lapjan hiba nelkul fut, mutatja, amit allit, es
 *     szerkesztes utan ujrafut. A lista a site-manifest.json-bol jon, amit
 *     a builder a lapokbol ir. Negativ kontroll: egy eldobo, egy semmit
 *     nem rajzolo es egy hianyzo modult importalo pelda HIBAT kell mutasson.
 *  3. A SABLONOK. scripts/sdk_check_templates.mjs: minden sablon a
 *     CSOMAGOLT tarballokkal telepul, epul, fut, es igazi Chromiumban
 *     rajzol, konzolhiba nelkul.
 *
 * A nem futtathato resz BUKAS, nem kihagyas.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXEMPT_LANGS, matchExcerpt, resolveExcerptSource } from "../packages/docs/scripts/excerpts.mjs";
import { parseMarkdown } from "../packages/docs/scripts/markdown.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const problems = [];
const notes = [];

/** A kiadott csomagok README-je: a npm-oldaluk, az elso, amit egy felhasznalo olvas. */
const READMES = [
  "packages/core/README.md",
  "packages/web-component/README.md",
  "packages/react/README.md",
  // P23: a három keretrendszer-adapter.
  "packages/vue/README.md",
  "packages/svelte/README.md",
  "packages/angular/README.md",
  "packages/docs/README.md",
];

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

// --- 1. a kodblokkok ----------------------------------------------------------
const files = [...markdownFiles(join(docs, "site", "pages")), ...READMES.map((file) => join(repo, file))];
const examplesDir = join(docs, "site", "examples");
const exampleIds = new Set(readdirSync(examplesDir).filter((name) => statSync(join(examplesDir, name)).isDirectory()));
let checked = 0;
let exempt = 0;
let lines = 0;
let wholeExamples = 0;
let firstExcerpt;
for (const file of files) {
  const where = relative(repo, file);
  if (!existsSync(file)) {
    problems.push(`${where}: nincs meg`);
    continue;
  }
  let blocks;
  try {
    blocks = parseMarkdown(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${where}: ${error.message}`);
    continue;
  }
  const flat = blocks.flatMap((block) => (block.type === "quote" ? block.blocks : [block]));
  for (const block of flat) {
    if (block.type === "example") {
      if (!exampleIds.has(block.id)) problems.push(`${where}:${String(block.line)}: nincs ilyen pelda: ${block.id}`);
      wholeExamples += 1;
      continue;
    }
    if (block.type !== "code") continue;
    if (block.lang === "") {
      problems.push(`${where}:${String(block.line)}: kodblokk nyelv nelkul — nem tudni, futnia kell-e`);
      continue;
    }
    if (EXEMPT_LANGS.has(block.lang)) {
      exempt += 1;
      continue;
    }
    if (block.excerpt === null) {
      problems.push(`${where}:${String(block.line)}: a ${block.lang}-blokk nem kivonata egyetlen futo peldanak sem (jelold: \`\`\`${block.lang} excerpt:example/<id>), es nem is elo pelda`);
      continue;
    }
    const source = resolveExcerptSource(block.excerpt, docs);
    if (source.error) {
      problems.push(`${where}:${String(block.line)}: ${source.error}`);
      continue;
    }
    const match = matchExcerpt(block.text, source.text);
    checked += 1;
    lines += match.checked;
    firstExcerpt ??= { block, source };
    if (match.checked === 0) problems.push(`${where}:${String(block.line)}: a kivonat ures — semmit nem allit`);
    for (const miss of match.missing) {
      problems.push(`${where}:${String(block.line + miss.line)}: ${miss.reason} (${block.excerpt}): ${miss.text}`);
    }
  }
}
notes.push(`kodblokkok: ${String(checked)} kivonat (${String(lines)} sor a futo forrasban), ${String(wholeExamples)} elo pelda, ${String(exempt)} shell/szoveg — ${String(files.length)} fajlban`);

// A meres nem vak: egy atirt es egy felcserelt sor bukik.
if (firstExcerpt === undefined) {
  problems.push("egyetlen kivonat sincs — a negativ kontroll nem futhat, ezert BUKAS");
} else {
  const kept = firstExcerpt.block.text.split("\n").filter((line) => line.trim() !== "");
  const changed = [...kept];
  changed[0] = `${changed[0]} // drift`;
  const swapped = kept.length >= 2 ? [kept[1], kept[0], ...kept.slice(2)] : null;
  if (matchExcerpt(changed.join("\n"), firstExcerpt.source.text).ok) problems.push("NEGATIV KONTROLL: egy atirt sor is atment — a kivonat-mero vak");
  if (swapped !== null && kept[0].trim() !== kept[1].trim() && matchExcerpt(swapped.join("\n"), firstExcerpt.source.text).ok) {
    problems.push("NEGATIV KONTROLL: ket felcserelt sor is atment — a kivonat-mero a sorrendet nem latja");
  }
  notes.push("negativ kontroll: egy atirt es egy felcserelt sor a kivonat-meron bukik");
}

// --- 2. az elo peldak, bongeszoben ------------------------------------------------
const manifestPath = join(docs, "dist", "site-manifest.json");
const resultsPath = join(docs, ".examples-results.json");
if (!existsSync(manifestPath)) {
  problems.push("nincs dist/site-manifest.json — az oldal nem epult fel, a peldak nem futhattak: BUKAS");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Before the run, not inside it: a failed test restarts Playwright's worker.
  rmSync(resultsPath, { force: true });
  const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.examples.config.ts"], { cwd: docs, stdio: "inherit" });
  if (!existsSync(resultsPath)) {
    problems.push("a bongeszos keszlet nem irt eredmenyt — nem futott, ezert BUKAS");
  } else {
    const results = readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    for (const example of manifest.examples) {
      const result = results.find((entry) => entry.kind === "example" && entry.id === example.id);
      const where = `pelda ${example.id} (${example.page})`;
      if (result === undefined) {
        problems.push(`${where}: nincs eredmenye — nem futott`);
        continue;
      }
      if (result.first.state !== "ok" || result.first.errors !== 0) problems.push(`${where}: nem fut hiba nelkul: ${result.first.status}`);
      for (const claim of [...result.shown, ...result.shownAfterEdit]) {
        if (claim.count < claim.min) problems.push(`${where}: "${claim.selector}" ${String(claim.count)} talalat, legalabb ${String(claim.min)} kell`);
      }
      if (result.edited.state !== "ok" || !result.editedSeen) problems.push(`${where}: szerkesztes utan nem fut ujra`);
      for (const error of result.pageErrors) problems.push(`${where}: hiba a lapon: ${error}`);
    }
    const control = results.find((entry) => entry.kind === "control");
    if (control === undefined) {
      problems.push("NEGATIV KONTROLL: nem futott — nem tudni, hogy a mero lat-e");
    } else {
      if (control.thrown.state !== "error") problems.push("NEGATIV KONTROLL: az eldobo pelda nem hibat mutatott — a mero vak");
      if (!control.emptyClaims.some((claim) => claim.count < claim.min)) problems.push("NEGATIV KONTROLL: a semmit nem rajzolo pelda allitasai teljesultek — a mero vak");
      if (control.missing.state !== "error") problems.push("NEGATIV KONTROLL: a hianyzo modul nem hibat mutatott — a mero vak");
      notes.push("negativ kontroll: az eldobo, az ures es a hianyzo modult importalo pelda hibat mutat");
    }
    notes.push(`elo peldak: ${String(manifest.examples.length)} a ${String(manifest.pages.length)} lapon; a keszlet exit kodja ${String(run.status)}`);
    if (run.status !== 0 && problems.length === 0) problems.push(`a bongeszos keszlet ${String(run.status)} koddal lepett ki`);
  }
}

// --- 3. a sablonok ------------------------------------------------------------------
try {
  execFileSync("node", [join(repo, "scripts", "sdk_check_templates.mjs")], { cwd: repo, stdio: "inherit" });
  notes.push("sablonok: mind epul es rajzol a csomagolt tarballokkal (sdk_check_templates.mjs)");
} catch (error) {
  problems.push(`a sablonok ellenorzese bukott (exit ${String(error.status)})`);
}

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length > 0) {
  console.error(`\nG-EXAMPLES BUKOTT — ${String(problems.length)} problema:`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("\nG-EXAMPLES: minden kodblokk egy futo pelda resze, minden elo pelda fut, minden sablon epul es rajzol.");
