#!/usr/bin/env node
/**
 * A G-VISUAL kapu masodik fele: bizonyitja, hogy a vizualis MATRIX tenyleg
 * vegigfutott.
 *
 * A fixture-osszehasonlitas (sdk_visual_snapshots.mjs --check) azt mondja meg,
 * hogy a kirajzolt frame nem valtozott. Ez a szkript azt, hogy a mertek
 * EGESZE lefutott: minden szelessegen, mindket orientacioban, mindket
 * temaban. A kettot szandekosan nem egy szkript mondja: egy tesztfajl, ami
 * csendben kihagy egy orientaciot, a fixture-oldalon nem latszik.
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU: a vitest JSON-riportjaban minden matrix-esethez le kellett
 *     futnia legalabb MIN_PER_CASE tesztnek, mindnek zolden. A riport hianya
 *     BUKAS, nem kihagyas.
 *  2. STATIKUS: a tesztfajl a matrixot a megosztott matrix.json-bol es a MAG
 *     listaibol (ORIENTATIONS, THEMES) veszi, nem sajat masolatbol; es a
 *     fixture-konyvtar pontosan a vart fajlokat tartalmazza.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const visualDir = join(corePackage, "test", "visual");
const fixturesDir = join(visualDir, "fixtures");
const testFile = join(visualDir, "scene.test.ts");
const reportFile = join(corePackage, ".visual-report.json");

const MIN_PER_CASE = 5;

const failures = [];
const notes = [];

const core = await import(pathToFileURL(join(corePackage, "dist", "index.mjs")).href);
const matrix = JSON.parse(readFileSync(join(visualDir, "matrix.json"), "utf8"));

const cases = [];
for (const width of matrix.widths) {
  for (const orientation of core.ORIENTATIONS) {
    for (const theme of core.THEMES) {
      cases.push({
        name: `${String(width)}-${orientation}-${theme.name}`,
        prefix: `frame ${String(width)}px ${orientation} ${theme.name}`,
        density: matrix.densityForWidth[String(width)],
      });
    }
  }
}

if (matrix.widths.length < 3) {
  failures.push(`${String(matrix.widths.length)} szelesseg a matrixban, de legalabb 3 kell`);
}

// --- 1. FUTASIDEJU -----------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs vitest-riport (${reportFile}) — a vizualis matrix NEM futott le, ezert BUKAS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);

  if (tests.length === 0) {
    failures.push("a vizualis riport egyetlen tesztet sem tartalmaz");
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`nem zold vizualis teszt: ${String(test.fullName)} (${String(test.status)})`);
    }
  }

  const densitiesSeen = new Set();
  for (const entry of cases) {
    const ran = tests.filter((test) => String(test.fullName).startsWith(entry.prefix));
    if (ran.length < MIN_PER_CASE) {
      failures.push(
        `${entry.prefix}: ${String(ran.length)} teszt futott, de legalabb ` +
          `${String(MIN_PER_CASE)} kell — egy kihagyott matrix-eset nem bizonyit semmit`,
      );
    }
    for (const test of ran) {
      const match = /\((comfortable|compact|dense)\)/.exec(String(test.fullName));
      if (match !== null) {
        densitiesSeen.add(match[1]);
      }
    }
  }

  for (const density of core.DENSITIES) {
    if (!densitiesSeen.has(density)) {
      failures.push(`a(z) "${density}" suruseg egyetlen matrix-esetben sem szerepelt`);
    }
  }

  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} vizualis teszt, ${String(cases.length)} matrix-eset ` +
        `(${String(matrix.widths.length)} szelesseg x ${String(core.ORIENTATIONS.length)} orientacio x ` +
        `${String(core.THEMES.length)} tema), mind zold`,
    );
    notes.push(`mind a ${String(core.DENSITIES.length)} suruseg szerepel a matrixban`);
  }
}

// --- 2. STATIKUS -------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs vizualis tesztfajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  const usesCoreLists =
    /ORIENTATIONS\b/.test(source) &&
    /THEMES\b/.test(source) &&
    /from "\.\.\/\.\.\/src\/geometry\.js"/.test(source) &&
    /from "\.\.\/\.\.\/src\/theme\.js"/.test(source);
  if (!usesCoreLists) {
    failures.push(
      "a vizualis tesztfajl nem a mag ORIENTATIONS/THEMES listaibol epiti a matrixot — " +
        "egy helyi lista pont azt engedne meg, hogy egy orientacio csendben kimaradjon",
    );
  } else {
    notes.push("a matrix a mag ORIENTATIONS/THEMES listain all, nem helyi masolaton");
  }
  if (!/matrix\.json/.test(source)) {
    failures.push("a vizualis tesztfajl nem a megosztott matrix.json-bol olvassa a szelessegeket");
  }
  if (/\[\s*"horizontal"\s*,\s*"vertical"\s*\]/.test(source)) {
    failures.push("a vizualis tesztfajl sajat orientacio-listat tartalmaz");
  }
}

if (!existsSync(fixturesDir)) {
  failures.push(`nincs fixture-konyvtar: ${fixturesDir}`);
} else {
  const onDisk = readdirSync(fixturesDir);
  const expected = new Set([...cases.map((entry) => `${entry.name}.svg`), "manifest.json"]);
  for (const name of onDisk) {
    if (!expected.has(name)) {
      failures.push(`varatlan fajl a fixture-konyvtarban: ${name}`);
    }
  }
  for (const name of expected) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) {
      failures.push(`hianyzo fixture: ${name}`);
      continue;
    }
    if (name.endsWith(".svg")) {
      const text = readFileSync(path, "utf8");
      if (!text.startsWith("<svg")) {
        failures.push(`${name}: nem SVG-vel kezdodik`);
      }
      if (statSync(path).size < 1000) {
        failures.push(`${name}: ures vagy csonka fixture (${String(statSync(path).size)} bajt)`);
      }
    }
  }
  if (failures.length === 0) {
    notes.push(`${String(cases.length)} fixture + manifest a helyen, mind ervenyes SVG`);
  }
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
  console.error(`\nG-VISUAL BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log(
  "\nG-VISUAL atment: a frame valtozatlan 3 szelessegen x 2 orientacion x 2 temaban.",
);
