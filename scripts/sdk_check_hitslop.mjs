#!/usr/bin/env node
/**
 * The hitslop check: proves that with a coarse pointer even a 2 px item can be
 * hit — and that this is down to the POINTER, not a large zone handed out
 * to everyone.
 *
 * Why a "the 2 px item can be hit" test is not enough: an infinite slop
 * would pass it too. A timeline where every press catches something is
 * exactly as unusable as one where nothing does. So the check asks for
 * PAIRS: next to every "reaches" claim there is a "does not reach" claim.
 *
 * Three independent checks:
 *
 *  1. RUNTIME — the suite: in the vitest JSON report every required claim
 *     must be green, in BOTH orientations. The slop is built in
 *     (main, cross) space; if it only holds horizontally, a finger on a
 *     vertical timeline catches the neighbouring row. A missing report is
 *     a FAILURE.
 *  2. STATIC — the pipeline: the input machine PASSES the pointer type to
 *     the hit tester. Without that, the zone exists in the function but not
 *     in the gesture — and the check would prove a capability a finger
 *     never gets.
 *  3. STATIC — one number, one place: 4 / 12 / 24 are defined in
 *     responsive.ts, and the hit tester asks for them there. This is the
 *     lesson of an earlier touchAction bug: the same number in two places
 *     means one of them drifts.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const srcDir = join(corePackage, "src");
const reportFile = join(corePackage, ".hitslop-report.json");
const machineFile = join(srcDir, "input.ts");
const testerFile = join(srcDir, "editing.ts");
const responsiveFile = join(srcDir, "responsive.ts");

const MIN_TESTS = 20;
/** The proof's claims, in pairs: what it reaches, and what it does NOT. */
const REQUIRED_CLAIMS = [
  // reaches
  "a finger reaches a 2 px item it misses by 10 px along time",
  "a finger reaches a 2 px item it misses by 10 px across the lanes",
  "a finger long press picks up the 2 px item",
  "dense raises even a mouse's target to 24 px",
  // does not reach
  "a mouse does not reach the same item from 10 px",
  "a mouse press at the same pixel picks up nothing",
  "without a pointer type the geometry is exact",
  "without a pointer type even dense stays exact",
  // does not steal
  "an exact hit wins over a slop hit on a neighbour",
  "in the gap between two items the nearest one wins",
  "a slop hit is the body, never a handle",
  "dense turns resizing off",
];

const failures = [];
const notes = [];

const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. RUNTIME ---------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`no vitest report (${reportFile}) — the hit zone suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(`${String(tests.length)} tests ran, but at least ${String(MIN_TESTS)} are required`);
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`test not green: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  for (const claim of REQUIRED_CLAIMS) {
    for (const orientation of ["horizontal", "vertical"]) {
      const found = tests.some(
        (test) =>
          test.status === "passed" &&
          String(test.fullName).includes(`[${orientation}]`) &&
          String(test.fullName).includes(claim),
      );
      if (!found) {
        failures.push(`no green ${orientation} test for: "${claim}"`);
      }
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} tests green; ${String(REQUIRED_CLAIMS.length)} claims x 2 orientations, in reaches/does-not-reach pairs`,
    );
  }
}

// --- 2. STATIC: the pipeline -------------------------------------------------

const machine = existsSync(machineFile) ? codeOf(readFileSync(machineFile, "utf8")) : "";
if (machine === "") {
  failures.push(`no input machine: ${machineFile}`);
} else if (!/hitTest\(\s*\{[^}]*\}\s*,\s*pointer\.pointerType\s*\)/.test(machine)) {
  failures.push(
    "the input machine does not pass the pointer type to the hit tester — the zone does not exist in the gesture",
  );
} else {
  notes.push("the machine passes the press's pointer type to the hit tester");
}

// --- 3. STATIC: one number, one place ----------------------------------------

const responsive = existsSync(responsiveFile) ? codeOf(readFileSync(responsiveFile, "utf8")) : "";
const tester = existsSync(testerFile) ? codeOf(readFileSync(testerFile, "utf8")) : "";
if (responsive === "") {
  failures.push(`no responsive.ts: ${responsiveFile}`);
} else {
  for (const [name, value] of [
    ["HIT_SLOP_FINE", 4],
    ["HIT_SLOP_COARSE", 12],
    ["DENSE_MIN_TARGET", 24],
  ]) {
    if (!new RegExp(`export const ${name} = ${String(value)};`).test(responsive)) {
      failures.push(`responsive.ts does not define: ${name} = ${String(value)}`);
    }
    const elsewhere = readdirSync(srcDir, { recursive: true })
      .filter((name_) => String(name_).endsWith(".ts") && String(name_) !== "responsive.ts")
      .filter((file) =>
        new RegExp(`const ${name}\\b`).test(readFileSync(join(srcDir, String(file)), "utf8")),
      );
    if (elsewhere.length > 0) {
      failures.push(`${name} is also defined in a second place: ${elsewhere.join(", ")}`);
    }
  }
}
if (tester === "") {
  failures.push(`no hit tester: ${testerFile}`);
} else if (
  !/import\s*\{[^}]*\bhitSlopFor\b[^}]*\bslopForExtent\b[^}]*\}\s*from\s*"\.\/responsive\.js"/.test(tester)
) {
  failures.push("the hit tester does not get the zone from responsive.ts");
} else {
  notes.push("4 / 12 / 24 live in one place, and the hit tester asks for them there");
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
  console.error(`\nhitslop FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}
console.log("\nhitslop passed: with a coarse pointer even a 2 px item can be hit, and a mouse does not steal.");
