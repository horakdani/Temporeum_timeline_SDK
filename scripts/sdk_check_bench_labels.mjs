#!/usr/bin/env node
/**
 * The bench-labels check: proves that on the 10,000-item page of the vis comparison,
 * panning and wheel zoom stay within the perf check's thresholds (<= 5% missed
 * vsync, <= 100 ms longest frame), and that on the same page, zoomed in with
 * a real wheel up to the density limit (the core's SHORTEN_DENSITY_LIMIT,
 * 1000 items per view width), at least half of the visible items carry a
 * label at rest — by the median of three fresh pages.
 *
 * Why at the limit and not in the 10,000-item view (by design): in the
 * 10,000-item view ~2000 items share 1440 px, ~0.7 px per item. There every
 * shortened label would be "Ite…" — it does not tell the items apart —, and
 * an experiment with a raster label layer made zoom worse, at 16.9%. So the
 * label claim speaks where a label is readable; the 10,000-item view proves
 * performance. The check prints the labels of the dense view but does not
 * judge them.
 *
 * A "visible item" is a rect.tl-item the browser considers visible; it
 * "carries a label" if it has a .tl-label node (data-tl-label = the item)
 * that is visible too. Up to 1.0.0-rc.4 there were 0 labels here.
 *
 * Validity — if any of these breaks, the check FAILS:
 *   - the report exists, is `labels`, with 4x throttling, 10,000 items, at
 *     least three pan runs and three zoom runs, with a fresh core and element
 *     dist;
 *   - 1900-2200 items are visible in the view (the published benchmark's view);
 *   - the drag moved the view, the zoom went above 4x and came back, nothing
 *     edited an item;
 *   - at the limit at most SHORTEN_DENSITY_LIMIT, but at least half that many
 *     items are visible (we measure near the limit, not at an easy, deep
 *     zoom), the zoom really happened, and the coverage settled at rest, with
 *     two matching readings.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The limit is the renderer's own, not on the public entry: read from its source.
const SHORTEN_DENSITY_LIMIT = Number(/export const SHORTEN_DENSITY_LIMIT = ([\d_]+);/.exec(readFileSync(new URL("../packages/core/src/render.ts", import.meta.url), "utf8"))?.[1]?.replaceAll("_", "") ?? NaN);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-labels.json");
const MIN_LABELLED_SHARE = 0.5;
const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MIN_REPS = 3;
const VISIBLE = [1900, 2200];
const TARGET_PX = 12 * 240;

const failures = [];
const notes = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (!existsSync(reportFile)) {
  failures.push(`missing: ${reportFile} — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const pans = report.panRuns ?? [];
  const zooms = report.zoomRuns ?? [];
  if (report.kind !== "labels") failures.push(`the report is not the labels measurement (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`the throttling is ${String(report.throttle)}x, not 4x`);
  if (report.items !== 10_000) failures.push(`${String(report.items)} items, not 10,000`);
  if (pans.length < MIN_REPS || zooms.length < MIN_REPS) failures.push(`${String(pans.length)} pan / ${String(zooms.length)} zoom runs, at least ${String(MIN_REPS)} of each are required — a measurement that cannot run is a FAILURE`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`stale dist (${JSON.stringify(report.fresh)})`);
  pans.forEach((run, index) => {
    if (!(run.atRest.visibleItems >= VISIBLE[0] && run.atRest.visibleItems <= VISIBLE[1])) failures.push(`#${String(index + 1)}: ${String(run.atRest.visibleItems)} visible items, ${String(VISIBLE[0])}-${String(VISIBLE[1])} required`);
    if (!(Math.abs(run.pan.midPx - TARGET_PX) <= 0.25 * TARGET_PX) || !(Math.abs(run.pan.endPx) <= 60)) failures.push(`#${String(index + 1)}: the drag did not cover the expected distance (${run.pan.midPx.toFixed(0)} / ${run.pan.endPx.toFixed(0)} px)`);
    if (run.edits !== 0) failures.push(`#${String(index + 1)}: the pan edited something`);
  });
  if (report.densityLimit !== SHORTEN_DENSITY_LIMIT) failures.push(`the measurement ran with a limit of ${String(report.densityLimit)} items, the core has ${String(SHORTEN_DENSITY_LIMIT)}`);
  zooms.forEach((run, index) => {
    if (!(run.peakFactor >= 4) || !(run.finalFactor > 0.8 && run.finalFactor < 1.25)) failures.push(`zoom #${String(index + 1)}: peak ${run.peakFactor.toFixed(2)}x, end ${run.finalFactor.toFixed(2)}x`);
    if (run.edits !== 0) failures.push(`zoom #${String(index + 1)}: the zoom edited something`);
    const limit = run.atLimit;
    if (limit === undefined) {
      failures.push(`zoom #${String(index + 1)}: no measurement at the limit — a measurement that cannot run is a FAILURE`);
      return;
    }
    if (!(limit.visibleItems <= SHORTEN_DENSITY_LIMIT && limit.visibleItems >= SHORTEN_DENSITY_LIMIT / 2)) failures.push(`zoom #${String(index + 1)}: ${String(limit.visibleItems)} visible items at the limit, ${String(SHORTEN_DENSITY_LIMIT / 2)}-${String(SHORTEN_DENSITY_LIMIT)} required`);
    if (!(limit.notches >= 1) || !(limit.factor > 1.2)) failures.push(`zoom #${String(index + 1)}: the zoom to the limit did not happen (${String(limit.notches)} notches, ${limit.factor.toFixed(2)}x)`);
    if (limit.unsettled || run.dense?.unsettled) failures.push(`zoom #${String(index + 1)}: the label coverage did not settle at rest`);
  });
  if (zooms.length > 0 && zooms.every((run) => run.atLimit !== undefined)) {
    const share = median(zooms.map((run) => run.atLimit.labelledItems / run.atLimit.visibleItems));
    const all = zooms.map((run) => `${String(run.atLimit.labelledItems)}/${String(run.atLimit.visibleItems)} @${run.atLimit.factor.toFixed(2)}x`).join(" ");
    if (!(share >= MIN_LABELLED_SHARE)) failures.push(`at the density limit, at rest, ${(share * 100).toFixed(1)}% of the visible items carry a label, at least 50% is required (runs: ${all})`);
    else notes.push(`at the density limit, at rest, ${(share * 100).toFixed(1)}% of the visible items carry a label (runs: ${all})`);
  }
  if (pans.length > 0) {
    const share = median(pans.map((run) => run.atRest.labelledItems / run.atRest.visibleItems));
    const all = pans.map((run) => `${String(run.atRest.labelledItems)}/${String(run.atRest.visibleItems)}`).join(" ");
    notes.push(`(not judged) in the 10,000-item view, above the limit, ${(share * 100).toFixed(1)}% are labelled (runs: ${all})`);
  }
  for (const [name, runs] of [["pan", pans.map((run) => run.pan)], ["wheel zoom", zooms]]) {
    if (runs.length === 0) continue;
    const missed = median(runs.map((run) => run.missedShare));
    const longest = median(runs.map((run) => run.longestFrameMs));
    const all = runs.map((run) => `${(run.missedShare * 100).toFixed(1)}%`).join(" ");
    if (!(missed <= MAX_MISSED_SHARE) || !(longest <= MAX_LONGEST_FRAME_MS)) {
      failures.push(`${name}: median ${(missed * 100).toFixed(1)}% missed vsync, longest ${longest.toFixed(0)} ms — threshold 5% / 100 ms (runs: ${all})`);
    } else {
      notes.push(`${name}: median ${(missed * 100).toFixed(1)}% missed vsync, longest ${longest.toFixed(0)} ms (runs: ${all})`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "bench-labels: passed" : "bench-labels: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
