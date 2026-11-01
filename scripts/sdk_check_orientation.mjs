#!/usr/bin/env node
/**
 * G-ORIENT: bizonyitja, hogy MINDEN geometriai teszt lefutott vizszintesen
 * ES fuggolegesen.
 *
 * Ket fuggetlen ellenorzes, mert a grep egyedul hazudhat:
 *
 *  1. FUTASIDEJU: a vitest JSON-riportjabol minden teszt neve ki van olvasva.
 *     Minden tesztnek viselnie kell egy orientacio-cimket, es minden
 *     tesztnevhez MINDKET orientacionak le kell futnia. Ha egy teszt csak
 *     vizszintesen futott le, az itt kiesik — akkor is, ha a fajl latszolag
 *     a harness-t hasznalja.
 *  2. STATIKUS: a harness az orientacio-listat a magbol veszi (ORIENTATIONS),
 *     nem sajat masolatbol, es a mag listaja tenylegesen mindkettot
 *     tartalmazza. Igy egy harmadik orientacio bevezetese utan ezek a
 *     tesztek maguktol lefutnanak abban is.
 *
 * A riport hianya vagy ures geometriai konyvtar BUKAS, nem kihagyas.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const geometryDir = join(corePackage, "test", "geometry");
const harnessFile = join(corePackage, "test", "orientation.ts");
const geometrySource = join(corePackage, "src", "geometry.ts");
const reportFile = join(corePackage, ".orientation-report.json");

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function ok(message) {
  notes.push(message);
}

// --- 1. A geometriai tesztek egyaltalan leteznek-e ---------------------------

if (!existsSync(geometryDir)) {
  fail(`nincs geometriai teszt-konyvtar: ${geometryDir}`);
}

const geometryFiles = existsSync(geometryDir)
  ? readdirSync(geometryDir).filter((name) => name.endsWith(".test.ts"))
  : [];

if (geometryFiles.length === 0) {
  fail("a test/geometry/ alatt nincs egyetlen tesztfajl sem — nincs mit bizonyitani");
} else {
  ok(`${geometryFiles.length} geometriai tesztfajl: ${geometryFiles.join(", ")}`);
}

// --- 2. FUTASIDEJU: a riport minden tesztje mindket orientacioban lefutott ---

if (!existsSync(reportFile)) {
  fail(
    `nincs vitest-riport (${reportFile}) — az orientacio-ellenorzes NEM futott le, ` +
      "ezert a check BUKAS, nem kihagyas",
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const results = Array.isArray(report.testResults) ? report.testResults : [];
  const geometryResults = results.filter((file) =>
    String(file.name ?? "").includes(`${join("test", "geometry")}`),
  );

  if (geometryResults.length === 0) {
    fail("a riport egyetlen test/geometry alatti fajlt sem tartalmaz");
  } else if (geometryResults.length !== geometryFiles.length) {
    fail(
      `${geometryFiles.length} geometriai tesztfajl van, de a riport ${geometryResults.length}-t ` +
        "tartalmaz — valamelyik nem futott le",
    );
  }

  /** @type {Map<string, Set<string>>} */
  const byBaseName = new Map();
  let total = 0;

  for (const file of geometryResults) {
    for (const test of file.assertionResults ?? []) {
      total += 1;
      if (test.status !== "passed") {
        fail(`nem zold teszt: ${String(test.fullName)} (${String(test.status)})`);
      }
      const match = /\[(horizontal|vertical)\]/.exec(String(test.fullName));
      if (match === null) {
        fail(
          `orientacio-cimke nelkuli teszt a test/geometry alatt: ${String(test.fullName)} — ` +
            "a describeBothOrientations harness-en kell futnia",
        );
        continue;
      }
      const base = String(test.fullName).replace(` [${match[1]}]`, "");
      const seen = byBaseName.get(base) ?? new Set();
      seen.add(match[1]);
      byBaseName.set(base, seen);
    }
  }

  if (byBaseName.size === 0) {
    fail("a riportban nincs egyetlen orientacio-cimkezett teszt sem");
  }

  for (const [base, seen] of byBaseName) {
    if (!(seen.has("horizontal") && seen.has("vertical"))) {
      fail(`csak ${[...seen].join(", ")} orientacioban futott le: ${base}`);
    }
  }

  if (failures.length === 0) {
    ok(
      `${total} geometriai teszt futott le, ${byBaseName.size} tesztnev x 2 orientacio, mind zold`,
    );
  }
}

// --- 3. STATIKUS: a harness a magbol veszi a listat --------------------------

if (!existsSync(harnessFile)) {
  fail(`nincs orientacio-harness: ${harnessFile}`);
} else {
  const harness = readFileSync(harnessFile, "utf8");
  if (!/import\s*\{[^}]*\bORIENTATIONS\b[^}]*\}\s*from\s*"\.\.\/src\/geometry\.js"/.test(harness)) {
    fail("a harness nem a magbol (src/geometry.js) importalja az ORIENTATIONS listat");
  } else {
    ok("a harness a mag ORIENTATIONS listajan jar, nem sajat masolaton");
  }
  if (/\["horizontal"\s*,\s*"vertical"\]/.test(harness)) {
    fail("a harness sajat orientacio-listat tartalmaz — az elavulhat a magtol");
  }
}

if (!existsSync(geometrySource)) {
  fail(`nincs ${geometrySource}`);
} else {
  const source = readFileSync(geometrySource, "utf8");
  const declaration = /export const ORIENTATIONS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (declaration === null) {
    fail("a src/geometry.ts nem exportal ORIENTATIONS listat");
  } else {
    const listed = [...declaration[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    for (const required of ["horizontal", "vertical"]) {
      if (!listed.includes(required)) {
        fail(`a mag ORIENTATIONS listajabol kimaradt: ${required}`);
      }
    }
    ok(`a mag ORIENTATIONS listaja: ${listed.join(", ")}`);
  }
}

// --- Eredmeny ---------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  HIBA ${failure}`);
  }
  console.error(`\nG-ORIENT BUKOTT: ${failures.length} hiba.`);
  process.exit(1);
}

console.log("\nG-ORIENT atment: minden geometriai teszt lefutott mindket orientacioban.");
