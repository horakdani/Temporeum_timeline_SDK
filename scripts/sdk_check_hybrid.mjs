#!/usr/bin/env node
/**
 * The hybrid check: proves that in the SAME session, on the SAME machine instance,
 * a drag starts at once with a mouse, while a finger needs a long press.
 *
 * Why this check: a touchscreen laptop is one machine with two hands, and
 * the user switches between them. A mouse that has to be held for half a
 * second feels broken, and a finger that drags on contact makes the list
 * unscrollable. The easy bug is not that one of them does not work, but
 * that the machine GETS STUCK in whichever hand touched it last.
 *
 * Three independent checks:
 *
 *  1. RUNTIME — the suite: every required claim must be in the vitest JSON
 *     report, and all of them green. A missing report is a FAILURE.
 *  2. RUNTIME — the trace: the test does not prove by its title but by a
 *     trace the MACHINE produced. It shows that there was a single
 *     instance, that the mouse drag started without a clock, that the
 *     finger needed a wake-up, and that AFTERWARDS the mouse is immediate
 *     again — so nothing is stuck. A test title can drift from the
 *     behaviour; this cannot, because the behaviour wrote it.
 *  3. STATIC — the pipeline: the core still sees no clock and uses no timer
 *     (so a sequence stays reproducible after a long press too), the delay
 *     is defined in the CORE, and the browser binding does NOT know how
 *     long a long press is — the lesson of an earlier touchAction bug,
 *     where the same number had to be set in two places.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "hybrid-pointer", "mixed.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const bindingFile = join(corePackage, "src", "dom", "attach.ts");
const reportFile = join(corePackage, ".hybrid-report.json");
const traceFile = join(corePackage, ".hybrid-trace.json");

const MIN_TESTS = 6;
/** The check's proof claims these; each needs a green test. */
const REQUIRED_CLAIMS = [
  "same session",
  "resize handle without the hold",
  "cancels the hold",
  "takes back the wake-up",
  "late move",
  "pen",
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

const failures = [];
const notes = [];

/** Code without comments: a ban must not fail on the explanation. */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. RUNTIME: the suite ---------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no vitest report (${reportFile}) — the hybrid suite did NOT run, so this is a FAILURE`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} hybrid tests ran, but at least ${String(MIN_TESTS)} are required`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`hybrid test not green: ${String(test.fullName)} (${String(test.status)})`);
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
      `${String(tests.length)} hybrid tests, all green, and each of the ` +
        `${String(REQUIRED_CLAIMS.length)} required claims has a test`,
    );
  }
}

// --- 2. RUNTIME: the trace ---------------------------------------------------

if (!existsSync(traceFile)) {
  failures.push(
    `no machine trace (${traceFile}) — without it the "same session" claim is ` +
      "only a test title, not an observation",
  );
} else {
  let trace;
  try {
    trace = JSON.parse(readFileSync(traceFile, "utf8"));
  } catch (error) {
    failures.push(`the trace is unreadable: ${String(error)}`);
  }
  if (trace !== undefined) {
    if (trace.machinesInSession !== 1) {
      failures.push(
        `${String(trace.machinesInSession)} machine instances in the session, but exactly 1 is required — ` +
          "two different objects behaving differently says nothing about switching",
      );
    }
    const events = Array.isArray(trace.events) ? trace.events : [];
    if (events.length !== 3) {
      failures.push(
        `${String(events.length)} steps in the trace, but 3 are required: mouse, finger, then mouse again`,
      );
    } else {
      const [first, second, third] = events;
      const immediate = (event, label) => {
        if (event.pointerType !== "mouse") {
          failures.push(`${label}: ${String(event.pointerType)} pointer, but a mouse was expected`);
        }
        if (event.trigger !== "pointer") {
          failures.push(
            `${label}: the drag was started by "${String(event.trigger)}", not the pointer — ` +
              "the mouse button has to be held, which feels broken",
          );
        }
        if (event.elapsed !== false || event.scheduled !== null) {
          failures.push(
            `${label}: the mouse drag needed a clock (scheduled=${String(event.scheduled)}, ` +
              `elapsed=${String(event.elapsed)})`,
          );
        }
      };
      immediate(first, "step 1 (mouse)");
      if (second.pointerType !== "touch") {
        failures.push(`step 2: ${String(second.pointerType)} pointer, but a finger was expected`);
      }
      if (second.trigger !== "long-press") {
        failures.push(
          `step 2: the drag was started by "${String(second.trigger)}", not the long press — ` +
            "a finger that drags on contact makes the list unscrollable",
        );
      }
      if (second.elapsed !== true || !Number.isFinite(second.scheduled)) {
        failures.push(
          "step 2: the finger needed no wake-up — so there was no hold, " +
            `or the machine did not ask for a clock (scheduled=${String(second.scheduled)})`,
        );
      }
      // This is the point of the check: the THIRD step.
      immediate(third, "step 3 (mouse after the finger) — the machine got stuck");
    }
    if (failures.length === 0) {
      notes.push(
        "trace of a single machine instance: mouse at once, finger on hold, then the mouse " +
          "at once again — nothing gets stuck",
      );
    }
  }
}

// --- 3. STATIC: the measurement and the pipeline -----------------------------

if (!existsSync(testFile)) {
  failures.push(`no hybrid test file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    )
  ) {
    failures.push("the hybrid test does not drive the core's createInputMachine export");
  }
  for (const kind of ['"mouse"', '"touch"', '"pen"']) {
    if (!source.includes(kind)) {
      failures.push(`the hybrid test uses no ${kind} pointer — switching is about all three`);
    }
  }
  if (!/\.elapse\(/.test(source)) {
    failures.push(
      "the hybrid test does not call elapse — then it does not drive the machine's clock but waits, " +
        "and a time-based test that really waits is flaky",
    );
  }
  if (!/moveTrigger:\s*"auto"/.test(source)) {
    failures.push(
      'the hybrid test does not measure the "auto" resolution — a mode set by hand proves ' +
        "nothing about switching",
    );
  }
  if (failures.length === 0) {
    notes.push('the measurement drives the real machine in "auto" mode, with all three pointer types');
  }
}

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`no input pipeline: ${machineFile}`);
} else {
  const code = codeOf(machine);
  for (const forbidden of FORBIDDEN_IN_MACHINE) {
    if (code.includes(forbidden)) {
      failures.push(
        `the input pipeline uses ${forbidden} — even with long press the point is ` +
          "that the machine never sees the clock, otherwise a sequence is not reproducible",
      );
    }
  }
  if (!/DEFAULT_LONG_PRESS_MS\s*=\s*\d+/.test(code)) {
    failures.push(
      "no long-press delay is defined in the core — then someone else decides it, " +
        "and the threshold is not the machine's",
    );
  }
  if (!/type:\s*"schedule"/.test(code)) {
    failures.push(
      "the machine sends no schedule effect — then it does not ASK for the wake-up but waits " +
        "for it somewhere, and that is already a clock",
    );
  }
}

const binding = existsSync(bindingFile) ? readFileSync(bindingFile, "utf8") : "";
if (binding === "") {
  failures.push(`no browser binding: ${bindingFile}`);
} else {
  const code = codeOf(binding);
  const timers = (code.match(/setTimeout\(/g) ?? []).length;
  if (timers !== 1) {
    failures.push(
      `${String(timers)} setTimeout calls in the binding, but exactly 1 is required — one for the long press, ` +
        "and nothing more, otherwise the timing lives in two places again",
    );
  }
  for (const leak of ["longPressMs", "LONG_PRESS", "DEFAULT_LONG_PRESS_MS"]) {
    if (code.includes(leak)) {
      failures.push(
        `the browser binding knows ${leak} — so the delay is defined in two ` +
          "places, which is exactly the earlier touchAction bug",
      );
    }
  }
  if (!/machine\.elapse\(/.test(code)) {
    failures.push(
      "the binding does not call machine.elapse — then the wake-up never reaches the machine",
    );
  }
  if (failures.length === 0) {
    notes.push(
      "the core is free of clocks and timers, the delay lives in the core, and the binding runs a single " +
        "timer without knowing how long a long press is",
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
  console.error(`\nhybrid FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}

console.log(
  "\nhybrid passed: on one machine, in one session, the mouse drags at once, the finger on hold, " +
    "and the mouse at once again afterwards.",
);
