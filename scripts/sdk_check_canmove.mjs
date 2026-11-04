#!/usr/bin/env node
/**
 * The canmove check: proves that the host's rule really stops an edit — on EVERY
 * path, and as a whole.
 *
 * Three claims, and all three break silently with ease:
 *
 *  - The veto is ATOMIC: one refused item refuses the WHOLE proposal. A
 *    partial move quietly rearranges what the user grabbed, and they read it
 *    as a bug in the library, not as their own rule at work.
 *  - The veto is NOT a cancel: the last accepted position goes out again
 *    with `vetoed: true`. The item stays where the rule allowed it — it does
 *    not jump back to the start, and it does not stay at the refused spot
 *    when the finger lifts. So the check also measures that a command is
 *    NEVER created for a refused position.
 *  - Both paths count: the gesture AND the programmatic twin. A veto that
 *    only works for the finger is data loss for the keyboard user. That is
 *    exactly what a check built on titles does not see: the veto branch of
 *    `runEdit` was once a hole in the coverage as well.
 *
 * Three independent checks: the vitest report (the suite ran and passed),
 * the machine's trace (on which path there really was a veto, and whether a
 * command was created), and the static half (the veto stops at the FIRST
 * failed patch, it is called on both paths, and a locked item is left out
 * of the drag rather than refusing it).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "canmove", "veto.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const reportFile = join(corePackage, ".canmove-report.json");
const traceFile = join(corePackage, ".canmove-trace.json");

const MIN_TESTS = 11;
const REQUIRED_CLAIMS = [
  "last accepted position",
  "not on every pixel",
  "whole selection",
  "refuses a resize",
  "programmatic twin",
  "programmatic resize",
  "locked item out of the drag",
  "will not start a drag on a locked item",
  "non-resizable",
];
/** Every path an edit can start on. Each one needs a veto. */
const REQUIRED_ROUTES = ["gesture-move", "gesture-resize", "api-move", "api-resize"];

const failures = [];
const notes = [];

const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. RUNTIME: the suite ----------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no vitest report (${reportFile}) — the canMove suite did NOT run, so this is a FAILURE`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} canMove tests ran, but at least ${String(MIN_TESTS)} are required`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`failing canMove test: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  const names = tests.map((test) => String(test.fullName).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    if (!names.some((name) => name.includes(claim.toLowerCase()))) {
      failures.push(`the check claims something nobody measures: "${claim}"`);
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} canMove tests, all passing, and every one of the ` +
        `${String(REQUIRED_CLAIMS.length)} required claims has a test`,
    );
  }
}

// --- 2. RUNTIME: the trace ----------------------------------------------------

if (!existsSync(traceFile)) {
  failures.push(
    `no veto trace (${traceFile}) — then we do not know on which path there really was a veto, ` +
      "only that the tests pass",
  );
} else {
  let trace;
  try {
    trace = JSON.parse(readFileSync(traceFile, "utf8"));
  } catch (error) {
    failures.push(`the veto trace is unreadable: ${String(error)}`);
  }
  if (trace !== undefined) {
    const vetoed = Array.isArray(trace.vetoed) ? trace.vetoed : [];
    for (const route of REQUIRED_ROUTES) {
      if (!vetoed.includes(route)) {
        failures.push(
          `there was no veto on the "${route}" path — if the rule does not stop on this path, ` +
            "this path overrides the host's own rule",
        );
      }
    }
    if (trace.commandsAfterVeto !== 0) {
      failures.push(
        `${String(trace.commandsAfterVeto)} commands were created for a refused position — ` +
          "then the veto is only for show: the change can still be stored",
      );
    }
    const atomic = Array.isArray(trace.atomic) ? trace.atomic : [];
    const proven = atomic.filter((entry) => entry.selected >= 2 && entry.movedAnyway === 0);
    if (proven.length === 0) {
      failures.push(
        "there is not a single multi-item proposal that a veto refused AS A WHOLE — " +
          `so atomicity is not measured (${String(atomic.length)} attempts in the trace)`,
      );
    }
    if (!Number.isInteger(trace.canMoveCalls) || trace.canMoveCalls < 1) {
      failures.push("the rule was never asked — the suite does not measure canMove");
    }
    if (failures.length === 0) {
      notes.push(
        `there was a veto on all ${String(REQUIRED_ROUTES.length)} paths, ${String(trace.canMoveCalls)} ` +
          "rule queries, not a single command was created for a refused position, " +
          "and the multi-item proposal was refused as a whole",
      );
    }
  }
}

// --- 3. STATIC: the measurement and the pipeline ----------------------------

if (!existsSync(testFile)) {
  failures.push(`no canMove test file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    )
  ) {
    failures.push("the canMove test does not drive the core's createInputMachine export");
  }
  if (!/canMove:/.test(source)) {
    failures.push("the canMove test passes no canMove rule — then what does it measure?");
  }
  for (const twin of ["moveItems(", "resizeItem("]) {
    if (!source.includes(twin)) {
      failures.push(
        `the canMove test does not drive the ${twin} programmatic twin — the keyboard path ` +
          "is exactly the one that can be missed",
      );
    }
  }
  if (!/multiSelect:\s*true/.test(source)) {
    failures.push("the canMove test does not measure a multi-selection — atomicity only shows there");
  }
  if (failures.length === 0) {
    notes.push("the measurement drives the real machine, on both paths, with a multi-selection");
  }
}

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`no input pipeline: ${machineFile}`);
} else {
  const code = codeOf(machine);
  const callSites = (code.match(/\brefused\(/g) ?? []).length;
  // One definition + at least two calls: the gesture and the programmatic twin.
  if (callSites < 3) {
    failures.push(
      `refused() is called in ${String(callSites - 1 > 0 ? callSites - 1 : 0)} places, but ` +
        "it needs at least two: the gesture path and the programmatic twin",
    );
  }
  const body = /function refused\(([\s\S]*?)\n {2}\}/.exec(code);
  if (body === null) {
    failures.push("refused() not found");
  } else if (!/for \(const patch of patches\)[\s\S]*return true;/.test(body[1])) {
    failures.push(
      "refused() does not stop at the FIRST failed patch — a check that " +
        "collects the failures and partly allows the proposal is not atomic",
    );
  }
  if (!/other\.item\.movable !== false/.test(code)) {
    failures.push(
      "the drag does not leave out the locked item (movable === false) — if it " +
        "refuses the whole gesture instead, a single pinned item in a selection " +
        "makes the selection unusable",
    );
  }
  if (failures.length === 0) {
    notes.push(
      "the veto stops at the first failed patch, it is called on both paths, and the locked " +
        "item is left out of the drag",
    );
  }
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
  console.error(`\ncanmove FAILED: ${String(failures.length)} problems.`);
  process.exit(1);
}

console.log(
  "\ncanmove passed: the host's rule stops the edit on both paths, as a whole, and " +
    "no command is created for a refused position.",
);
