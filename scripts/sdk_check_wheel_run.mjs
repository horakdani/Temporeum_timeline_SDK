#!/usr/bin/env node
/**
 * The wheel-run check: proves that a run of wheel steps is ONE gesture in the
 * machine — on generated runs, with the browser binding's single wake-up
 * timer, the way attachInput drives it.
 *
 * Two independent checks:
 *
 *  1. THE PROPERTY: "a wheel run is one gesture" passes in the report, with
 *     a seed and at least MIN_CASES cases. A missing report FAILS: the
 *     package command deletes it beforehand, so its presence means it ran NOW.
 *  2. THE CONTROL: on the same cases at least MIN_RESTS steps continue a run
 *     that is already open — without the run the host would have been at
 *     rest there, and the property would prove nothing about runs — and at
 *     least MIN_STILL steps moved nothing (at the boundary): the "does not
 *     open a run" claim is not vacuously true.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-wheel-run.json");
const controlFile = join(corePackage, ".wheel-run-control.json");
const PROPERTY = "a wheel run is one gesture";
const MIN_CASES = 500;
const MIN_RESTS = 1000;
const MIN_STILL = 100;

const failures = [];
const notes = [];
const read = (file) => {
  if (!existsSync(file)) {
    failures.push(`missing: ${file} — the suite did NOT run, so this FAILS`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`unreadable: ${file}: ${String(error)}`);
    return undefined;
  }
};

const report = read(reportFile);
if (report !== undefined) {
  const entry = Array.isArray(report) ? report.find((candidate) => candidate?.name === PROPERTY) : undefined;
  if (entry === undefined) {
    failures.push(`the property is missing from the report: "${PROPERTY}"`);
  } else {
    if (entry.passed !== true) failures.push(`failed: ${PROPERTY} — ${JSON.stringify(entry.counterexample ?? null)}`);
    if (!Number.isInteger(entry.cases) || entry.cases < MIN_CASES) {
      failures.push(`${PROPERTY}: ${String(entry.cases)} cases, but at least ${String(MIN_CASES)} are required`);
    }
    if (!Number.isFinite(entry.seed)) failures.push(`${PROPERTY}: no seed`);
    if (entry.passed === true) notes.push(`${PROPERTY}: ${String(entry.cases)} cases, seed ${String(entry.seed)}`);
  }
}

const control = read(controlFile);
if (control !== undefined) {
  if (!(control.restsInsideARun >= MIN_RESTS)) {
    failures.push(
      `the control does NOT fail: only ${String(control.restsInsideARun)} steps continue an open run, at least ${String(MIN_RESTS)} are required — the property proves nothing about runs`,
    );
  } else {
    notes.push(
      `control: ${String(control.restsInsideARun)} steps continue an open run (${String(control.runsWithSeveralSteps)} multi-step runs, ` +
        `${String(control.cases)} cases) — without the run the host would have been at rest there`,
    );
  }
  if (!(control.stillSteps >= MIN_STILL)) {
    failures.push(`only ${String(control.stillSteps)} steps moved nothing, at least ${String(MIN_STILL)} are required`);
  } else {
    notes.push(`${String(control.stillSteps)} steps at the boundary moved nothing and opened no run`);
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "wheel-run: passed" : "wheel-run: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
