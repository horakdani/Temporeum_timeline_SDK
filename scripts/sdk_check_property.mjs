#!/usr/bin/env node
/**
 * G-PROP: bizonyitja, hogy a property-alapu teszt tenylegesen generalt
 * bemeneten futott, es hogy az atfedes-invariansot a mag sajat exportalt
 * ellenorzojevel vizsgalta.
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU: a property-riportbol minden property-nek zoldnek kell
 *     lennie, nevvel es seeddel, es legalabb MIN_CASES esettel. Egy
 *     property-teszt, ami nulla esetet futtatott, zold pipat ad es semmit nem
 *     bizonyit — pontosan ez a csend a gate ertelme ellen.
 *  2. STATIKUS: a property-fajl a mag `findSublaneOverlap` exportjat hasznalja,
 *     nem helyi masolatot. Egy sajat, parhuzamos atfedes-ellenorzo ugyanazt a
 *     hibat tartalmazhatja, mint a pakolo, es akkor a property onmagat
 *     igazolja.
 *
 * A riport hianya BUKAS, nem kihagyas.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const propertyDir = join(corePackage, "test", "property");

/** A tesztfajlhoz tartozo riport utja: egy fajl, egy riport. */
const reportFor = (testFile) =>
  join(corePackage, `.property-report-${testFile.replace(/\.test\.ts$/, "")}.json`);

const MIN_CASES = 500;
const MIN_PROPERTIES = 4;
const REQUIRED_PROPERTY = "no overlap in a row";

const failures = [];
const notes = [];

if (!existsSync(propertyDir)) {
  failures.push(`nincs property-teszt konyvtar: ${propertyDir}`);
}

const propertyFiles = existsSync(propertyDir)
  ? readdirSync(propertyDir).filter((name) => name.endsWith(".test.ts"))
  : [];

if (propertyFiles.length === 0) {
  failures.push("a test/property/ alatt nincs tesztfajl — nincs mit bizonyitani");
} else {
  notes.push(`${propertyFiles.length} property-tesztfajl: ${propertyFiles.join(", ")}`);
}

// --- 1. FUTASIDEJU -----------------------------------------------------------

// MINDEN property-tesztfajlnak sajat riportja van, es mindegyiknek meg kell
// lennie. Egy kozos riportfajlra iro masodik fajl feluliria az elsot, es a
// kapu kevesebb property-t lat, mint amennyi lefutott — pontosan ez tortent,
// amikor a P3-ban a masodik property-fajl bekerult. Egy riport, aminek nincs
// tesztfajlja, elavult: nem bizonyit semmit, de ugyanolyan jol olvashato.
const report = [];
const orphanReports = readdirSync(corePackage).filter(
  (name) =>
    name.startsWith(".property-report") &&
    name.endsWith(".json") &&
    !propertyFiles.some((testFile) => reportFor(testFile).endsWith(name)),
);
for (const orphan of orphanReports) {
  failures.push(
    `elavult property-riport: ${orphan} — nincs hozza tesztfajl, tehat nem bizonyit semmit`,
  );
}
for (const testFile of propertyFiles) {
  const path = reportFor(testFile);
  if (!existsSync(path)) {
    failures.push(
      `nincs property-riport (${path}) a ${testFile}-hez — a property-teszt NEM futott le, ezert BUKAS`,
    );
    continue;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    failures.push(`${testFile}: a property-riport ures`);
    continue;
  }
  report.push(...parsed);
}

if (report.length > 0) {
  {
    if (report.length < MIN_PROPERTIES) {
      failures.push(
        `${String(report.length)} property futott, de legalabb ${String(MIN_PROPERTIES)} kell`,
      );
    }
    for (const entry of report) {
      const name = String(entry?.name ?? "(nevtelen)");
      if (entry?.passed !== true) {
        failures.push(
          `bukott property: ${name} — ${JSON.stringify(entry?.counterexample ?? null)}`,
        );
      }
      if (!Number.isInteger(entry?.cases) || entry.cases < MIN_CASES) {
        failures.push(
          `${name}: ${String(entry?.cases)} eset, de legalabb ${String(MIN_CASES)} kell`,
        );
      }
      if (!Number.isFinite(entry?.seed)) {
        failures.push(`${name}: nincs seed, tehat egy bukas nem reprodukalhato`);
      }
    }
    if (!report.some((entry) => entry?.name === REQUIRED_PROPERTY)) {
      failures.push(`a kotelezo property hianyzik: "${REQUIRED_PROPERTY}"`);
    }
    if (failures.length === 0) {
      const total = report.reduce((sum, entry) => sum + entry.cases, 0);
      notes.push(
        `${String(report.length)} property, ${String(total)} generalt eset, mind zold: ` +
          report.map((entry) => `${entry.name} (${String(entry.cases)})`).join(", "),
      );
    }
  }
}

// --- 2. STATIKUS -------------------------------------------------------------

const usesCoreChecker = propertyFiles.some((name) => {
  const source = readFileSync(join(propertyDir, name), "utf8");
  return (
    /import\s*\{[^}]*\bfindSublaneOverlap\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/layout\.js"/.test(
      source,
    ) && /findSublaneOverlap\s*\(/.test(source)
  );
});

if (!usesCoreChecker) {
  failures.push(
    "egyetlen property-fajl sem hasznalja a mag findSublaneOverlap exportjat — " +
      "egy helyi masolat ugyanazt a hibat tartalmazhatja, mint a pakolo",
  );
} else {
  notes.push("az atfedes-invariansot a mag sajat exportalt ellenorzoje vizsgalja");
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
  console.error(`\nG-PROP BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log("\nG-PROP atment: generalt bemenetre SOHA nincs atfedes ugyanabban a sorban.");
