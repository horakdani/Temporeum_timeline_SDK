#!/usr/bin/env node
/**
 * G-NARROW-LABELS: proves that every item whose truncated label (at least 3
 * characters and an ellipsis) fits in the item's visible part or in the free
 * space after it gets a label — on generated, dense data, in both
 * orientations, in the exact frame AND in the resting item space; the
 * visible labels do not overlap, none lands on another item, the text is the
 * item's own text (whole, or its start with an ellipsis), and the full text
 * is in the item's accessible name.
 *
 * The "fits" oracle computes from the layout, not from the placement (the
 * test file's header comment has the details).
 *
 * Two independent checks:
 *
 *  1. THE PROPERTY: in the report "narrow items get a label" is green, with a
 *     seed, and at least MIN_CASES cases. A missing report is a FAILURE: the
 *     package command deletes it first, so its presence means it ran NOW.
 *  2. THE CONTROL: the same cases with the earlier strategy (labelOverflow:
 *     "drop") leave, in the MAJORITY of cases, at least one item without a
 *     label that the oracle says is entitled to one — otherwise the data is
 *     too sparse, and the property would pass without truncation too. And
 *     across the cases there are at least MIN_REQUIRED such items in total.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-narrow-labels.json");
const controlFile = join(corePackage, ".narrow-labels-control.json");
const PROPERTY = "narrow items get a label";
const MIN_CASES = 500;
const MIN_REQUIRED = 1000;

const failures = [];
const notes = [];
const read = (file) => {
  if (!existsSync(file)) {
    failures.push(`missing: ${file} — the suite did NOT run, so this is a FAILURE`);
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
  if (!(control.cases >= MIN_CASES)) {
    failures.push(`the control ran only ${String(control.cases)} cases, at least ${String(MIN_CASES)} are required`);
  }
  if (!(control.required >= MIN_REQUIRED)) {
    failures.push(`the cases hold only ${String(control.required)} items entitled to a label, at least ${String(MIN_REQUIRED)} are required`);
  }
  if (!(control.casesMissedByDrop > control.cases / 2)) {
    failures.push(
      `the control does NOT fail in the majority of cases: the drop strategy leaves an item entitled to a label without one in only ${String(control.casesMissedByDrop)} / ${String(control.cases)} cases`,
    );
  } else {
    notes.push(
      `control: the drop strategy leaves an item entitled to a label without one in ${String(control.casesMissedByDrop)} / ${String(control.cases)} cases ` +
        `(${String(control.missedByDrop)} / ${String(control.required)} items); truncated labels: ${String(control.shortened)}`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "G-NARROW-LABELS: passed" : "G-NARROW-LABELS: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
