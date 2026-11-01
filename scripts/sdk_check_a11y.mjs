#!/usr/bin/env node
/**
 * G-AXE: bizonyitja, hogy az axe a lapok MINDEN mert allapotaban 0 hibat
 * talalt, WCAG 2.2 AA cimkekkel, igazi bongeszoben — es hogy a harness nem
 * vak.
 *
 * Harom modon hazudhat egy axe-kapu, es mindharom ellen kulon ellenorzes all:
 *
 *  1. Az axe nem fut, vagy rossz cimkekkel fut (pl. csak wcag2a), es a nulla
 *     sertes semmit nem jelent. -> Az eredmenyfajl minden futasa a pontos
 *     cimkekeszletet hordja, a verziot, es legalabb 10 atment szabalyt.
 *  2. Az axe csak az alaphelyzetet latja, vagy csak a demolapokat. A docs-oldal
 *     (P12) minden lapja es elo peldaja is kotelezo, a manifesztje szerint.
 *     Az axe csak az alaphelyzetet latja. A fokusz, a kijeloles, a dialogus
 *     pont azok az allapotok, ahol az ARIA-hibak elnek. -> Minden kotelezo
 *     allapotnak szerepelnie kell, a kotelezo projektben.
 *  3. A harness vak: egy elrontott lapon sem talalna semmit. -> A NEGATIV
 *     KONTROLL ugyanazzal a harnesszel fut, es harom ismert hibat (egy
 *     sehova mutato aria-activedescendant, egy arva option, egy nev nelkuli
 *     gomb) meg KELL talalnia.
 *
 * A negyedik a kontraszt: az axe az SVG-szoveg kontrasztjat nem tudja
 * eldonteni (incomplete). Az SVG-szoveg a mag token-tesztjere tartozik
 * (packages/core/test/a11y/contrast.test.ts, a G-TEST resze); a HTML-szoveget,
 * amit az axe nem dontott el, a spec a szamitott szinekbol meri, es annak
 * 4.5:1 felett kell lennie. Barmi mas incomplete BUKAS.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repoRoot, "packages", "docs");
const reportFile = join(docs, ".e2e-a11y-report.json");
const resultsFile = join(docs, ".axe-results.json");
const specFile = join(docs, "e2e", "a11y.spec.ts");
const pageFile = join(docs, "public", "index.html");
const responsiveFile = join(docs, "public", "responsive.html");
const serverFile = join(docs, "e2e", "serve.mjs");
const contrastTest = join(repoRoot, "packages", "core", "test", "a11y", "contrast.test.ts");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MIN_PASSES = 10;
/** Allapot -> a projektek, amelyekben kotelezo. */
const REQUIRED_STATES = {
  "index:initial": ["desktop", "pixel-7"],
  "index:vertical": ["desktop", "pixel-7"],
  "index:focused": ["desktop"],
  "index:selected": ["desktop"],
  "index:multi": ["desktop"],
  "index:jump-dialog": ["desktop"],
  "index:dark-edited": ["desktop"],
  "responsive:initial": ["desktop", "pixel-7"],
  "responsive:detail-popover": ["desktop"],
  "responsive:detail-sheet": ["pixel-7"],
};
const CONTROL_FINDINGS = ["aria-valid-attr-value", "aria-required-parent", "button-name"];
/** A billentyus ut allitasai (a spec cimei), az asztali projektben. */
const REQUIRED_CLAIMS = [
  "Tab az idővonalra",
  "Alt+nyíl mozgat",
  "a hoszt szabálya a billentyűre is áll",
  "g, dátum, Enter",
  "Esc elengedi",
  "nem görgeti a lapot",
  "reduced-motion: a lapozás egy képkockában",
  "a média-beállítás változását",
  "NEGATÍV KONTROLL",
];

const failures = [];
const notes = [];

// --- 1. A Playwright-riport --------------------------------------------------
if (!existsSync(reportFile)) {
  failures.push(`nincs Playwright-riport (${reportFile}) — a keszlet NEM futott, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const results = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) {
        const last = run.results?.at(-1);
        results.push({ title: [...trail, spec.title].join(" › "), project: run.projectName, status: last?.status ?? "none" });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  const failed = results.filter((r) => r.status !== "passed" && r.status !== "skipped");
  for (const r of failed) failures.push(`[${r.project}] ${r.title}: ${r.status}`);
  for (const claim of REQUIRED_CLAIMS) {
    const hit = results.find((r) => r.project === "desktop" && r.title.includes(claim) && r.status === "passed");
    if (hit === undefined) failures.push(`nincs zold teszt az asztali projektben erre: "${claim}"`);
  }
  // Kihagyni csak a billentyus teszteket szabad, csak a telefonon.
  for (const r of results.filter((r) => r.status === "skipped")) {
    if (r.project !== "pixel-7") failures.push(`kihagyott teszt az asztali projektben: ${r.title}`);
  }
  notes.push(`${results.filter((r) => r.status === "passed").length} zold, ${results.filter((r) => r.status === "skipped").length} kihagyott (billentyu a telefonon)`);
}

// --- 2. Az axe-eredmenyek -----------------------------------------------------
if (!existsSync(resultsFile)) {
  failures.push(`nincs axe-eredmenyfajl (${resultsFile}) — az axe NEM futott, ezert BUKAS`);
} else {
  const runs = readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const real = runs.filter((run) => !run.control);
  const controls = runs.filter((run) => run.control);
  const versions = new Set(runs.map((run) => run.version));
  if (versions.size !== 1 || [...versions][0] === undefined) failures.push(`az axe-verzio nem egyertelmu: ${[...versions].join(", ")}`);
  for (const run of real) {
    const where = `[${run.project}] ${run.state}`;
    if (JSON.stringify(run.tags) !== JSON.stringify(TAGS)) failures.push(`${where}: a cimkek nem a WCAG 2.2 AA keszlet: ${JSON.stringify(run.tags)}`);
    if (run.violations.length > 0) failures.push(`${where}: ${run.violations.length} sertes: ${run.violations.map((v) => v.id).join(", ")}`);
    if (run.passes.length < MIN_PASSES) failures.push(`${where}: csak ${run.passes.length} szabaly ment at — az axe alig latott valamit`);
    const other = run.incomplete.filter((rule) => rule.id !== "color-contrast");
    if (other.length > 0) failures.push(`${where}: eldontetlen szabaly: ${other.map((rule) => rule.id).join(", ")}`);
    for (const node of run.undecided ?? []) {
      if (!node.svg && !(node.ratio >= 4.5)) failures.push(`${where}: a HTML-szoveg kontrasztja ${String(node.ratio)} < 4.5: ${node.target}`);
    }
  }
  for (const [state, projects] of Object.entries(REQUIRED_STATES)) {
    for (const project of projects) {
      if (!real.some((run) => run.state === state && run.project === project)) failures.push(`az axe nem latta ezt az allapotot: [${project}] ${state}`);
    }
  }
  // A docs-oldal: minden lap es minden elo pelda, mindket projektben. A lista
  // a builder manifesztje, nem ez a fajl: egy uj lap magatol kotelezo lesz.
  const siteManifest = join(docs, "dist", "site-manifest.json");
  if (!existsSync(siteManifest)) {
    failures.push("nincs dist/site-manifest.json — a docs-oldal nem epult fel, az axe nem lathatta: BUKAS");
  } else {
    const site = JSON.parse(readFileSync(siteManifest, "utf8"));
    const wanted = [...site.pages.map((page) => `site:${page.id}`), ...site.examples.map((example) => `site-example:${example.id}`)];
    for (const state of wanted) {
      for (const project of ["desktop", "pixel-7"]) {
        if (!real.some((run) => run.state === state && run.project === project)) failures.push(`az axe nem latta a docs-oldal ezen reszet: [${project}] ${state}`);
      }
    }
    notes.push(`docs-oldal: ${String(site.pages.length)} lap es ${String(site.examples.length)} elo pelda, mindket projektben`);
  }
  for (const project of ["desktop", "pixel-7"]) {
    const control = controls.find((run) => run.project === project);
    if (control === undefined) {
      failures.push(`[${project}] nincs negativ kontroll — nem tudni, hogy a harness lat-e`);
      continue;
    }
    const found = control.violations.map((v) => v.id);
    for (const id of CONTROL_FINDINGS) {
      if (!found.includes(id)) failures.push(`[${project}] a negativ kontrollon az axe NEM talalta: ${id} — a harness vak`);
    }
  }
  const svgUndecided = real.reduce((sum, run) => sum + (run.undecided ?? []).filter((node) => node.svg).length, 0);
  const htmlUndecided = real.reduce((sum, run) => sum + (run.undecided ?? []).filter((node) => !node.svg).length, 0);
  notes.push(`axe ${[...versions][0]}: ${real.length} allapot 0 sertessel, ${controls.length} negativ kontroll talalattal`);
  notes.push(`kontraszt, amit az axe nem dontott el: ${svgUndecided} SVG-csomopont (a token-tesztre), ${htmlUndecided} HTML-csomopont merve >= 4.5`);
}

// --- 3. Statikus: mit merunk ---------------------------------------------------
const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (!spec.includes('require.resolve("axe-core/axe.min.js")')) failures.push("a spec nem a telepitett axe-core-t injektalja");
const docsManifest = JSON.parse(readFileSync(join(docs, "package.json"), "utf8"));
if (docsManifest.devDependencies?.["axe-core"] === undefined) failures.push("az axe-core nincs a docs dev-fuggosegei kozott");
const server = readFileSync(serverFile, "utf8");
if (!/core.*dist/.test(server)) failures.push("a szerver /core/ utvonala nem a dist-re mutat — nem a shippelt csomagot mernenk");
for (const file of [pageFile, responsiveFile]) {
  const page = readFileSync(file, "utf8");
  if (!page.includes("focusedId: machine.focusedId") || !page.includes("createNavigator(")) {
    failures.push(`${file}: a lap nincs bekotve a billentyuzetre — az axe egy fel-lapot merne`);
  }
}
if (!existsSync(contrastTest)) failures.push("hianyzik a mag kontraszt-tesztje: az SVG-szoveg kontrasztja igy senki altal nincs merve");

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nG-AXE BUKOTT:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\nG-AXE: 0 axe-sertes WCAG 2.2 AA-n, minden mert allapotban; a negativ kontroll talal.");
