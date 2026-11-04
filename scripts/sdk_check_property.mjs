#!/usr/bin/env node
/**
 * The prop check: proves that the property-based test really ran on generated
 * input, and that it checked the overlap invariant with the core's own
 * exported checker.
 *
 * Two independent checks:
 *
 *  1. RUNTIME: in the property report every property must be green, with a
 *     name and a seed, and at least MIN_CASES cases. A property test that ran
 *     zero cases gives a green tick and proves nothing — exactly the kind of
 *     silence that defeats the point of the gate.
 *  2. STATIC: the property file uses the core's `findSublaneOverlap` export,
 *     not a local copy. A separate, parallel overlap checker could contain
 *     the same bug as the packer, and then the property vouches for itself.
 *
 * A missing report is a FAILURE, not a skip.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const propertyDir = join(corePackage, "test", "property");

/** The path of a test file's report: one file, one report. */
const reportFor = (testFile) =>
  join(corePackage, `.property-report-${testFile.replace(/\.test\.ts$/, "")}.json`);

const MIN_CASES = 500;
const MIN_PROPERTIES = 4;
const REQUIRED_PROPERTY = "no overlap in a row";

const failures = [];
const notes = [];

if (!existsSync(propertyDir)) {
  failures.push(`no property test directory: ${propertyDir}`);
}

const propertyFiles = existsSync(propertyDir)
  ? readdirSync(propertyDir).filter((name) => name.endsWith(".test.ts"))
  : [];

if (propertyFiles.length === 0) {
  failures.push("there is no test file under test/property/ — nothing to prove");
} else {
  notes.push(`${propertyFiles.length} property test files: ${propertyFiles.join(", ")}`);
}

// --- 1. RUNTIME --------------------------------------------------------------

// EVERY property test file has its own report, and each one must be there.
// A second file writing to a shared report file overwrites the first, and the
// check sees fewer properties than actually ran — exactly what happened when
// the second property file was added. A report without a test file is
// stale: it proves nothing, but reads just as well.
const report = [];
const orphanReports = readdirSync(corePackage).filter(
  (name) =>
    name.startsWith(".property-report") &&
    name.endsWith(".json") &&
    !propertyFiles.some((testFile) => reportFor(testFile).endsWith(name)),
);
for (const orphan of orphanReports) {
  failures.push(
    `stale property report: ${orphan} — it has no test file, so it proves nothing`,
  );
}
for (const testFile of propertyFiles) {
  const path = reportFor(testFile);
  if (!existsSync(path)) {
    failures.push(
      `no property report (${path}) for ${testFile} — the property test did NOT run, so this is a FAILURE`,
    );
    continue;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    failures.push(`${testFile}: the property report is empty`);
    continue;
  }
  report.push(...parsed);
}

if (report.length > 0) {
  {
    if (report.length < MIN_PROPERTIES) {
      failures.push(
        `${String(report.length)} properties ran, but at least ${String(MIN_PROPERTIES)} are required`,
      );
    }
    for (const entry of report) {
      const name = String(entry?.name ?? "(unnamed)");
      if (entry?.passed !== true) {
        failures.push(
          `failed property: ${name} — ${JSON.stringify(entry?.counterexample ?? null)}`,
        );
      }
      if (!Number.isInteger(entry?.cases) || entry.cases < MIN_CASES) {
        failures.push(
          `${name}: ${String(entry?.cases)} cases, but at least ${String(MIN_CASES)} are required`,
        );
      }
      if (!Number.isFinite(entry?.seed)) {
        failures.push(`${name}: no seed, so a failure is not reproducible`);
      }
    }
    if (!report.some((entry) => entry?.name === REQUIRED_PROPERTY)) {
      failures.push(`required property missing: "${REQUIRED_PROPERTY}"`);
    }
    if (failures.length === 0) {
      const total = report.reduce((sum, entry) => sum + entry.cases, 0);
      notes.push(
        `${String(report.length)} properties, ${String(total)} generated cases, all green: ` +
          report.map((entry) => `${entry.name} (${String(entry.cases)})`).join(", "),
      );
    }
  }
}

// --- 2. STATIC ---------------------------------------------------------------

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
    "no property file uses the core's findSublaneOverlap export — " +
      "a local copy could contain the same bug as the packer",
  );
} else {
  notes.push("the overlap invariant is checked by the core's own exported checker");
}

// --- Result ------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\nprop FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}

console.log("\nprop passed: on generated input there is NEVER an overlap in the same row.");
