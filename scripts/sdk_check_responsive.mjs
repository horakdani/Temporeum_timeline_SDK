#!/usr/bin/env node
/**
 * G-RESPONSIVE: bizonyitja, hogy 375 / 768 / 1440 px-en az orientacio es a
 * suruseg a VARTRA valt, es vizszintes lapgorgetes nincs — igazi bongeszoben,
 * a SHIPPELT csomagon.
 *
 * Ez a kapu harom modon hazudhat magarol, es mindharomra van zar:
 *
 *  1. a keszlet a sajat elvarasat a mert kodbol szamolja — akkor mindig
 *     egyetert vele. Ezert a spec-ben LEIRT tablanak kell allnia (szelesseg,
 *     orientacio, suruseg), es a spec nem importalhat a magbol;
 *  2. a lap sajat torespontot hasznal, es a mag dontese a bongeszoben soha
 *     nem fut — akkor a kapu a lapot meri, nem a konyvtarat. Ezert a lapnak a
 *     mag resolveOrientation / fitDensity / resolveDetailSurface / observeSize
 *     fuggvenyein kell dontenie, es nem lehet benne sajat 640-es szam vagy
 *     matchMedia;
 *  3. a dontes a betoltes pillanataban szuletik, es egy elforgatott telefon
 *     a regi vetuletben marad. Ezert kotelezo az ELO atmeretezes allitasa,
 *     es a hiszterezise is.
 *
 * Plusz ami a P4 ota minden bongeszos kapura all: a riport hianya, egy
 * kihagyott, flaky vagy ujraprobalt teszt BUKAS.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsPackage = join(repoRoot, "packages", "docs");
const reportFile = join(docsPackage, ".e2e-responsive-report.json");
const configFile = join(docsPackage, "playwright.responsive.config.ts");
const specFile = join(docsPackage, "e2e", "responsive.spec.ts");
const pageFile = join(docsPackage, "public", "responsive.html");
const serverFile = join(docsPackage, "e2e", "serve.mjs");

const WIDTHS = [375, 768, 1440];
const MIN_TESTS = 14;
/** Szelessegenkent kotelezo allitasok; a `{w}` helyere a szelesseg kerul. */
const PER_WIDTH_CLAIMS = ["{w} px: ", "{w} px: vízszintes lapgörgetés nincs", "{w} px: a részlet"];
/** Szelessegtol fuggetlen kotelezo allitasok. */
const REQUIRED_CLAIMS = [
  "élő átméretezés",
  "újratöltés nélkül",
  "hiszterézis",
  "alsó lap a saját gombjával záródik",
  "2 px-es pillanat is eltalálható",
  "egérrel ugyanott nem",
  "explicit orientáció felülírja",
  "popover bezárul",
];
/** A szerzodes. Ezt kell a spec-ben LEIRVA latni, nem szamolva. */
const CONTRACT = [
  { width: 375, orientation: "vertical", density: "dense", surface: "sheet" },
  { width: 768, orientation: "horizontal", density: "compact", surface: "popover" },
  { width: 1440, orientation: "horizontal", density: "comfortable", surface: "popover" },
];
/** A lapnak ezeken kell dontenie — a magbol, nem sajat kodbol. */
const CORE_DECISIONS = ["resolveOrientation", "fitDensity", "resolveDensity", "resolveDetailSurface"];
const DOM_BINDINGS = ["observeSize", "openDetail", "attachInput"];

const failures = [];
const notes = [];

const codeOf = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// --- 1. FUTASIDEJU ------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`nincs e2e-riport (${reportFile}) — a reszponziv keszlet NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const stats = report.stats ?? {};
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      specs.push(spec);
    }
    for (const child of suite.suites ?? []) {
      walk(child);
    }
  };
  for (const suite of report.suites ?? []) {
    walk(suite);
  }
  if (specs.length < MIN_TESTS) {
    failures.push(`${String(specs.length)} e2e teszt futott, de legalabb ${String(MIN_TESTS)} kell`);
  }
  for (const [key, label] of [
    ["unexpected", "bukott"],
    ["flaky", "flaky"],
    ["skipped", "kihagyott"],
  ]) {
    if (Number(stats[key] ?? 0) > 0) {
      failures.push(`${String(stats[key])} ${label} e2e teszt — ez BUKAS, nem semleges`);
    }
  }
  const green = [];
  for (const spec of specs) {
    const ok = (spec.tests ?? []).length > 0 && spec.tests.every((test) => test.status === "expected");
    if (!ok) {
      failures.push(`nem zold e2e teszt: ${String(spec.title)}`);
    } else {
      green.push(String(spec.title).toLowerCase());
    }
  }
  for (const width of WIDTHS) {
    for (const template of PER_WIDTH_CLAIMS) {
      const claim = template.replace("{w}", String(width)).toLowerCase();
      if (!green.some((title) => title.includes(claim))) {
        failures.push(`nincs zold teszt erre: "${claim.trim()}"`);
      }
    }
  }
  for (const claim of REQUIRED_CLAIMS) {
    if (!green.some((title) => title.includes(claim.toLowerCase()))) {
      failures.push(`a kapu allit valamit, amit senki nem mer a bongeszoben: "${claim}"`);
    }
  }
  for (const project of report.config?.projects ?? []) {
    if (Number(project.retries ?? 0) > 0) {
      failures.push(`a ${String(project.name)} projekt ujraprobal — az elrejti a bizonytalant`);
    }
  }
  if (failures.length === 0) {
    notes.push(`${String(specs.length)} bongeszos teszt, mind zold, ${WIDTHS.join(" / ")} px-en`);
  }
}

// --- 2. STATIKUS: leirt szerzodes, nem szamolt --------------------------------

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (spec === "") {
  failures.push(`nincs reszponziv keszlet: ${specFile}`);
} else {
  if (/from\s*["'][^"']*(core|timeline-core)[^"']*["']/.test(spec)) {
    failures.push("a spec a magbol importal — a sajat elvarasat a mert kodbol szamolna");
  }
  for (const row of CONTRACT) {
    const pattern = new RegExp(
      `width:\\s*${String(row.width)}\\b[^}]*orientation:\\s*"${row.orientation}"[^}]*density:\\s*"${row.density}"[^}]*surface:\\s*"${row.surface}"`,
    );
    if (!pattern.test(spec)) {
      failures.push(
        `a spec szerzodes-tablajaban nincs leirva: ${String(row.width)} px -> ${row.orientation} / ${row.density} / ${row.surface}`,
      );
    }
  }
  if (!/setViewportSize\(/.test(spec)) {
    failures.push("a spec sehol nem meretez at elo lapot — a dontes akkor a betolteskori meretbol is johetne");
  }
  if (failures.length === 0) {
    notes.push("a szerzodes a spec-ben leirva all, es a spec nem a magtol kerdezi");
  }
}

const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
if (config === "") {
  failures.push(`nincs reszponziv konfig: ${configFile}`);
} else {
  if (!/retries:\s*0/.test(config)) {
    failures.push("a reszponziv konfig nem zarja ki az ujraprobalast");
  }
  if (!/reuseExistingServer:\s*false/.test(config)) {
    failures.push("a reszponziv konfig idegen szervert is elfogadna");
  }
  if (!/\.e2e-responsive-report\.json/.test(config)) {
    failures.push("a reszponziv riport nem a sajat fajljaba megy — felulirhatja az erintesest");
  }
}

// --- 3. STATIKUS: a lap a magon dont ------------------------------------------

const page = existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "";
if (page === "") {
  failures.push(`nincs reszponziv demo lap: ${pageFile}`);
} else {
  const code = codeOf(page);
  if (!/from\s*"\/core\/index\.mjs"/.test(code) || !/from\s*"\/core\/dom\.mjs"/.test(code)) {
    failures.push("a reszponziv lap nem a `/core/` ala kiszolgalt csomagbol importal");
  }
  for (const name of [...CORE_DECISIONS, ...DOM_BINDINGS]) {
    if (!new RegExp(`\\b${name}\\(`).test(code)) {
      failures.push(`a lap nem hivja a mag ${name}() fuggvenyet — a dontest maga hozza`);
    }
  }
  if (/\b640\b/.test(code) || /matchMedia/.test(code) || /new\s+ResizeObserver/.test(code)) {
    failures.push(
      "a lapon sajat torespont, matchMedia vagy sajat ResizeObserver van — a meres es a dontes a konyvtare",
    );
  }
  if (failures.length === 0) {
    notes.push("a lap a mag dontesein es kotesein fut, sajat torespont nelkul");
  }
}

const server = existsSync(serverFile) ? readFileSync(serverFile, "utf8") : "";
if (!/"core",\s*"dist"/.test(server)) {
  failures.push("a szerver nem a dist-et szolgalja ki a `/core/` ala");
}

// --- Eredmeny ----------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}
if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  HIBA ${failure}`);
  }
  console.error(`\nG-RESPONSIVE BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}
console.log(
  "\nG-RESPONSIVE atment: 375 / 768 / 1440 px-en a vart vetulet, elo atmeretezessel, vizszintes gorgetes nelkul.",
);
