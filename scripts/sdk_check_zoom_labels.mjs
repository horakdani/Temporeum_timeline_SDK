#!/usr/bin/env node
/**
 * The zoom-labels check: proves that a label visible both before and after a zoom
 * is missing from none of the zoom's frames — on generated, monotonic zoom
 * gestures, driven by the README's loop (stepwise re-anchoring, redrawing
 * until pendingTiles, at rest until the overscan is complete).
 *
 * Two independent checks:
 *
 *  1. THE PROPERTY: "zoom keeps the labels on both ends" passes in the
 *     report, with a seed and at least MIN_CASES cases. A missing report
 *     FAILS: the package command deletes it beforehand, so its presence
 *     means it ran NOW.
 *  2. THE CONTROL: the same cases drawn the 1.0.0-rc.4 way — every frame of
 *     the gesture `bare`: new tiles without labels, edge labels not pinned —
 *     would lose at least one label visible at both the start and the end.
 *     If not, the property would pass without the change too and would
 *     prove nothing about it. And the cases hold at least MIN_LABELS such
 *     labels in total: a property that runs on cases without labels is
 *     vacuously true.
 *
 * Why only monotonic zoom (the test file's header comment has the details):
 * every label lives in its own item's space, and under a monotonic zoom that
 * space is never smaller midway than at both ends; with a back-and-forth
 * zoom a label may rightly not fit midway. The maxLabels cap and clustering
 * are not covered.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-zoom-labels.json");
const controlFile = join(corePackage, ".zoom-labels-control.json");
const PROPERTY = "zoom keeps the labels on both ends";
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
  if (!(control.cases >= MIN_CASES)) {
    failures.push(`the control ran only ${String(control.cases)} cases, at least ${String(MIN_CASES)} are required`);
  }
  if (!(control.labelsBeforeAndAfter >= MIN_LABELS)) {
    failures.push(`only ${String(control.labelsBeforeAndAfter)} labels are visible before and after in the cases, at least ${String(MIN_LABELS)} are required`);
  }
  if (!(control.lostByOld > 0)) {
    failures.push("the control does NOT fail: the rc.4 way keeps every label too — the property proves nothing about the change");
  } else {
    notes.push(
      `control: the rc.4 way loses ${String(control.lostByOld)} / ${String(control.labelsBeforeAndAfter)} labels visible before and after ` +
        `(in ${String(control.casesLostByOld)} / ${String(control.cases)} cases, over ${String(control.gestureFrames)} gesture frames)`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "zoom-labels: passed" : "zoom-labels: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
