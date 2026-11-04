#!/usr/bin/env node
/**
 * The rest-labels check: proves that at rest the item area shows every label the
 * exact frame keeps — on generated data, in both orientations.
 *
 * Two independent checks:
 *
 *  1. THE PROPERTY: "rest labels match the exact frame" passes in the
 *     report, with a seed and at least MIN_CASES cases. A missing report
 *     FAILS: the package command deletes it beforehand, so its presence
 *     means it ran NOW.
 *  2. THE CONTROL: on the same cases the frame drawn during a gesture — the
 *     same tiles, without the at-rest fill-in — loses at least one label
 *     that the exact frame keeps. If it lost none, the property would pass
 *     without the fill-in too and would prove nothing about it. And the
 *     cases hold at least MIN_LABELS exact labels in total: a property that
 *     runs on cases without labels is vacuously true.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-rest-labels.json");
const controlFile = join(corePackage, ".rest-labels-control.json");
const PROPERTY = "rest labels match the exact frame";
const MIN_CASES = 500;
const MIN_LABELS = 1000;

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
  if (!(control.exactLabels >= MIN_LABELS)) {
    failures.push(`the cases hold only ${String(control.exactLabels)} exact labels, at least ${String(MIN_LABELS)} are required`);
  }
  if (!(control.missedDuringGesture > 0)) {
    failures.push("the control does NOT fail: the tiles' labels show everything even without the fill-in — the property proves nothing about the fill-in");
  } else {
    notes.push(
      `control: the frame during a gesture misses ${String(control.missedDuringGesture)} / ${String(control.exactLabels)} exact labels ` +
        `(in ${String(control.casesMissing)} / ${String(control.cases)} cases) — without the at-rest fill-in the property would fail`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "rest-labels: passed" : "rest-labels: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
