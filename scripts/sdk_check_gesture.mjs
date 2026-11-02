#!/usr/bin/env node
/**
 * G-GESTURE: proves that the gesture suite really ran, and that what it
 * measures is the REAL pipeline.
 *
 * The check's `proof` field claims four things: pan, pinch, pointercancel,
 * and lifting a finger during a pinch. A test file that quietly leaves one of
 * them out gives a green tick — vitest does not know something should have
 * been measured.
 *
 * Three independent checks:
 *
 *  1. RUNTIME: every required claim must be in the vitest JSON report, and
 *     every one must pass. A missing report is a FAILURE, not a skip.
 *  2. STATIC — the measurement: the test file drives the core's
 *     `createInputMachine` export, feeds it all four pointer phases, uses at
 *     least three pointers, and measures the anchoring with the core's own
 *     `createTimeScale`, not with a local formula.
 *  3. STATIC — the pipeline: `input.ts` sees no clock and uses no timer
 *     (that is what makes a sequence reproducible), and `dom/attach.ts` does
 *     not interpret gestures (that is what makes ONE pipeline, not two).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "gesture", "pointer.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const bindingFile = join(corePackage, "src", "dom", "attach.ts");
const reportFile = join(corePackage, ".gesture-report.json");

const MIN_TESTS = 10;
/** The check's proof claims these; each one needs a passing test. */
const REQUIRED_CLAIMS = [
  "one pointer",
  "two pointers",
  "pointercancel",
  "lifting one finger during a pinch",
  "double tap",
  "two-finger tap",
  "drag threshold",
  "wheel",
  "both orientations",
];
/** If any of these gets into the core, a sequence is not reproducible. */
const FORBIDDEN_IN_MACHINE = [
  "Date.now",
  "performance.now",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "new Date(",
];
/** If any of these gets into the binding, gestures are interpreted in two places. */
const FORBIDDEN_IN_BINDING = ["zoomDomainAt", "panDomainBy", "clampDomain", "createTimeScale"];

const failures = [];
const notes = [];

// --- 1. RUNTIME ---------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no vitest report (${reportFile}) — the gesture suite did NOT run, so this is a FAILURE`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} gesture tests ran, but at least ${String(MIN_TESTS)} are required`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`failing gesture test: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  const names = tests.map((test) => String(test.fullName).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    const covered = names.some((name) => name.includes(claim.toLowerCase()));
    if (!covered) {
      failures.push(`the check claims something nobody measures: "${claim}"`);
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} gesture tests, all passing, and every one of the ` +
        `${String(REQUIRED_CLAIMS.length)} required claims has a test`,
    );
  }
}

// --- 2. STATIC: the measurement ----------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`no gesture test file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (!/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(source)) {
    failures.push("the gesture test does not drive the core's createInputMachine export");
  }
  for (const phase of ["down", "move", "up", "cancel"]) {
    if (!source.includes(`"${phase}"`)) {
      failures.push(`the gesture test does not feed the ${phase} phase — the sequence is incomplete`);
    }
  }
  const pointerIds = new Set([...source.matchAll(/at\(\s*(\d+)\s*,/g)].map((m) => m[1]));
  if (pointerIds.size < 3) {
    failures.push(
      `${String(pointerIds.size)} pointer ids in the test, but the third finger's behaviour is a claim too`,
    );
  }
  if (!/createTimeScale/.test(source)) {
    failures.push(
      "it does not measure the anchoring with the core's createTimeScale — a local formula could contain the same bug",
    );
  }
  if (failures.length === 0) {
    notes.push(
      `the measurement drives the real pipeline: all 4 pointer phases, ${String(pointerIds.size)} pointers, measured with the core's scale`,
    );
  }
}

// --- 3. STATIC: the pipeline --------------------------------------------------

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`no input pipeline: ${machineFile}`);
}
for (const forbidden of FORBIDDEN_IN_MACHINE) {
  // Comments do not count: we only look at the code.
  const code = machine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (code.includes(forbidden)) {
    failures.push(
      `the input pipeline uses ${forbidden} — then a sequence is not reproducible, and the gesture test becomes flaky`,
    );
  }
}

const binding = existsSync(bindingFile) ? readFileSync(bindingFile, "utf8") : "";
if (binding === "") {
  failures.push(`no browser binding: ${bindingFile}`);
}
for (const forbidden of FORBIDDEN_IN_BINDING) {
  if (binding.includes(forbidden)) {
    failures.push(
      `the browser binding uses ${forbidden} — gesture interpretation splits in two, and ONE pipeline was the point`,
    );
  }
}
if (machine !== "" && binding !== "" && failures.length === 0) {
  notes.push("the core is free of clocks and timers, and the binding does not interpret gestures");
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
  console.error(`\nG-GESTURE FAILED: ${String(failures.length)} problems.`);
  process.exit(1);
}

console.log("\nG-GESTURE passed: synthetic pointer sequences drive the SINGLE pipeline.");
