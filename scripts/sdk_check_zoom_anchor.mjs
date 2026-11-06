#!/usr/bin/env node
/**
 * The anchor check: proves that zoom is anchored to the gesture's focus — and that
 * the tolerance used for the measurement really is tight.
 *
 * This check is special because here the MEASUREMENT itself is the risk. A
 * test that asserts the anchor "within 50 pixels" passes green while the feel
 * of the zoom is broken: the content slides out from under the finger. So
 * the script does not only read the result, it also checks the tolerance,
 * statically too.
 *
 * Three checks:
 *
 *  1. RUNTIME: every scenario must pass, with at least MIN_CASES generated
 *     cases, and the largest error below the tolerance.
 *  2. NON-TRIVIAL: the generated cases really zoomed both IN and OUT (the
 *     spread of the span ratio), and the gesture really moved. A suite that
 *     only tries factors close to 1.0 lets anything through.
 *  3. STATIC: the tolerance constant in the test file is below the threshold
 *     too, the case count above it, and the error is measured with the
 *     core's own scale.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "zoom-anchor", "anchor.test.ts");
const reportFile = join(corePackage, ".zoom-anchor-report.json");
const readme = join(corePackage, "README.md");

const MIN_SCENARIOS = 5;
const MIN_CASES = 200;
/**
 * The tolerance the README promises — its "zoom anchor error after a gesture"
 * row — is the most the test and the report may use: a looser one would pass
 * green under a claim it does not prove (V28). One place says the number.
 */
const promised = /\|\s*zoom anchor error after a gesture\s*\|\s*([0-9.]+)\s*px\s*\|/.exec(existsSync(readme) ? readFileSync(readme, "utf8") : "");
const MAX_TOLERANCE_PX = promised === null ? Number.NaN : Number(promised[1]);
const MAX_SKIPPED_RATIO = 0.02;
/** The suite must zoom both in AND out. */
const NEEDED_ZOOM_IN = 0.5;
const NEEDED_ZOOM_OUT = 2;
const MIN_TRAVEL_PX = 10;

const failures = [];
const notes = [];
if (!(MAX_TOLERANCE_PX > 0)) failures.push(`the core README has no "zoom anchor error after a gesture" row in px — nothing says what the tolerance may be`);

// --- 1-2. RUNTIME ------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no anchor report (${reportFile}) — the measurement did NOT run, so this FAILS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (!Array.isArray(report) || report.length < MIN_SCENARIOS) {
    failures.push(
      `${String(Array.isArray(report) ? report.length : 0)} scenarios ran, but at least ${String(MIN_SCENARIOS)} are required`,
    );
  }
  for (const entry of report) {
    const name = String(entry?.scenario ?? "(unnamed)");
    if (entry?.passed !== true) {
      failures.push(`failed scenario: ${name} — ${String(entry?.maxErrorPx)} px error`);
    }
    if (!Number.isInteger(entry?.cases) || entry.cases < MIN_CASES) {
      failures.push(`${name}: ${String(entry?.cases)} cases, but at least ${String(MIN_CASES)} are required`);
    }
    if (!Number.isFinite(entry?.tolerancePx) || entry.tolerancePx > MAX_TOLERANCE_PX) {
      failures.push(
        `${name}: ${String(entry?.tolerancePx)} px tolerance — above ${String(MAX_TOLERANCE_PX)} px a green tick says nothing about the feel, it is a formality`,
      );
    }
    if (!Number.isFinite(entry?.maxErrorPx) || entry.maxErrorPx > entry.tolerancePx) {
      failures.push(`${name}: the largest error (${String(entry?.maxErrorPx)} px) is above the tolerance`);
    }
    if (!Number.isFinite(entry?.seed)) {
      failures.push(`${name}: no seed, so a failure cannot be reproduced`);
    }
    if (Number(entry?.skipped ?? 0) > Number(entry?.cases ?? 0) * MAX_SKIPPED_RATIO) {
      failures.push(
        `${name}: ${String(entry?.skipped)} skipped cases out of ${String(entry?.cases)} — that many skips amount to dodging the measurement`,
      );
    }
    if (!Number.isFinite(entry?.travelPxMax) || entry.travelPxMax < MIN_TRAVEL_PX) {
      failures.push(
        `${name}: the gesture moved at most ${String(entry?.travelPxMax)} px — anything is true of a gesture that stands still`,
      );
    }
  }
  const zoomedIn = report.some((entry) => Number(entry?.spanRatioMin) <= NEEDED_ZOOM_IN);
  const zoomedOut = report.some((entry) => Number(entry?.spanRatioMax) >= NEEDED_ZOOM_OUT);
  if (!zoomedIn) {
    failures.push("no scenario zoomed IN by at least a factor of two");
  }
  if (!zoomedOut) {
    failures.push("no scenario zoomed OUT to at least half");
  }
  if (failures.length === 0) {
    const total = report.reduce((sum, entry) => sum + entry.cases, 0);
    const worst = Math.max(...report.map((entry) => entry.maxErrorPx));
    notes.push(
      `${String(report.length)} scenarios, ${String(total)} generated gestures: ` +
        report.map((entry) => entry.scenario).join(", "),
    );
    notes.push(
      `the largest anchor error is ${worst.toExponential(2)} px, the tolerance ${String(report[0].tolerancePx)} px`,
    );
  }
}

// --- 3. STATIC ---------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`no anchor test file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  const tolerance = /const\s+TOLERANCE_PX\s*=\s*([0-9.e-]+)/.exec(source);
  const cases = /const\s+CASES\s*=\s*(\d+)/.exec(source);
  if (tolerance === null || Number(tolerance[1]) > MAX_TOLERANCE_PX) {
    failures.push(
      `the test file's tolerance is ${String(tolerance?.[1])} px — the report can claim anything, the source decides`,
    );
  }
  if (cases === null || Number(cases[1]) < MIN_CASES) {
    failures.push(`the test file's case count is ${String(cases?.[1])}, but at least ${String(MIN_CASES)} are required`);
  }
  if (!/createTimeScale/.test(source)) {
    failures.push("the error is not measured with the core's createTimeScale — a local formula could contain the same bug");
  }
  if (!/makeRandom/.test(source)) {
    failures.push("no generator: on hand-picked points the anchor is easily true");
  }
}

// --- Result -------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\nanchor FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}

console.log("\nanchor passed: the MOMENT under the focus is in the same place after the zoom.");
