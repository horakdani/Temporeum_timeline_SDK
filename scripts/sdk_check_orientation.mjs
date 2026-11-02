#!/usr/bin/env node
/**
 * G-ORIENT: proves that EVERY geometry test ran horizontally AND
 * vertically.
 *
 * Two independent checks, because grep alone can lie:
 *
 *  1. RUNTIME: every test name is read from the vitest JSON report. Every
 *     test must carry an orientation tag, and BOTH orientations must have run
 *     for every test name. A test that only ran horizontally is caught here —
 *     even if the file appears to use the harness.
 *  2. STATIC: the harness takes the orientation list from the core
 *     (ORIENTATIONS), not from its own copy, and the core's list really
 *     contains both. So if a third orientation were introduced, these tests
 *     would run in it too on their own.
 *
 * A missing report or an empty geometry directory is a FAILURE, not a skip.
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

// --- 1. Whether the geometry tests exist at all ------------------------------

if (!existsSync(geometryDir)) {
  fail(`no geometry test directory: ${geometryDir}`);
}

const geometryFiles = existsSync(geometryDir)
  ? readdirSync(geometryDir).filter((name) => name.endsWith(".test.ts"))
  : [];

if (geometryFiles.length === 0) {
  fail("there is not a single test file under test/geometry/ — nothing to prove");
} else {
  ok(`${geometryFiles.length} geometry test files: ${geometryFiles.join(", ")}`);
}

// --- 2. RUNTIME: every test in the report ran in both orientations -----------

if (!existsSync(reportFile)) {
  fail(
    `no vitest report (${reportFile}) — the orientation check did NOT run, ` +
      "so the check is a FAILURE, not a skip",
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const results = Array.isArray(report.testResults) ? report.testResults : [];
  const geometryResults = results.filter((file) =>
    String(file.name ?? "").includes(`${join("test", "geometry")}`),
  );

  if (geometryResults.length === 0) {
    fail("the report contains no file under test/geometry");
  } else if (geometryResults.length !== geometryFiles.length) {
    fail(
      `there are ${geometryFiles.length} geometry test files, but the report contains ${geometryResults.length} ` +
        "— one of them did not run",
    );
  }

  /** @type {Map<string, Set<string>>} */
  const byBaseName = new Map();
  let total = 0;

  for (const file of geometryResults) {
    for (const test of file.assertionResults ?? []) {
      total += 1;
      if (test.status !== "passed") {
        fail(`test not green: ${String(test.fullName)} (${String(test.status)})`);
      }
      const match = /\[(horizontal|vertical)\]/.exec(String(test.fullName));
      if (match === null) {
        fail(
          `test without an orientation tag under test/geometry: ${String(test.fullName)} — ` +
            "it must run on the describeBothOrientations harness",
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
    fail("the report has not a single orientation-tagged test");
  }

  for (const [base, seen] of byBaseName) {
    if (!(seen.has("horizontal") && seen.has("vertical"))) {
      fail(`ran only in the ${[...seen].join(", ")} orientation: ${base}`);
    }
  }

  if (failures.length === 0) {
    ok(
      `${total} geometry tests ran, ${byBaseName.size} test names x 2 orientations, all green`,
    );
  }
}

// --- 3. STATIC: the harness takes the list from the core ---------------------

if (!existsSync(harnessFile)) {
  fail(`no orientation harness: ${harnessFile}`);
} else {
  const harness = readFileSync(harnessFile, "utf8");
  if (!/import\s*\{[^}]*\bORIENTATIONS\b[^}]*\}\s*from\s*"\.\.\/src\/geometry\.js"/.test(harness)) {
    fail("the harness does not import the ORIENTATIONS list from the core (src/geometry.js)");
  } else {
    ok("the harness walks the core's ORIENTATIONS list, not its own copy");
  }
  if (/\["horizontal"\s*,\s*"vertical"\]/.test(harness)) {
    fail("the harness contains its own orientation list — it can drift from the core");
  }
}

if (!existsSync(geometrySource)) {
  fail(`missing: ${geometrySource}`);
} else {
  const source = readFileSync(geometrySource, "utf8");
  const declaration = /export const ORIENTATIONS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (declaration === null) {
    fail("src/geometry.ts does not export an ORIENTATIONS list");
  } else {
    const listed = [...declaration[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    for (const required of ["horizontal", "vertical"]) {
      if (!listed.includes(required)) {
        fail(`missing from the core's ORIENTATIONS list: ${required}`);
      }
    }
    ok(`the core's ORIENTATIONS list: ${listed.join(", ")}`);
  }
}

// --- Result -----------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\nG-ORIENT FAILED: ${failures.length} failure(s).`);
  process.exit(1);
}

console.log("\nG-ORIENT passed: every geometry test ran in both orientations.");
