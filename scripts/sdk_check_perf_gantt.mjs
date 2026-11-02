#!/usr/bin/env node
/**
 * G-PERF-GANTT: with 10,000 tasks and 10,000 dependencies, pan and wheel
 * zoom are within the G-PERF thresholds (<= 5% missed vsyncs, <= 100 ms
 * longest frame, by the median of three fresh pages) — and without arrow
 * culling (`gantt.cull: false`, the negative control) it FAILS: the pan or
 * the zoom is over the threshold.
 *
 * Validity — if any of these is violated, the check FAILS:
 *   - the report exists, `gantt`, with 4x throttling, at least three runs in
 *     both variants, with a fresh core and element dist;
 *   - the page draws 10,000 tasks and 10,000 dependencies, and the culled
 *     variant really culled (`cull: true`), the control did not;
 *   - arrows are visible on the culled page (> 0), at least 10,000 in the
 *     control — otherwise the control does not measure what it claims;
 *   - the drags really moved the view, edited nothing, and the zoom really
 *     magnified (peak >= 3x).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-gantt.json");
const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MIN_REPS = 3;
const TARGET_PX = 12 * 240;

const failures = [];
const notes = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const within = (runs) => median(runs.map((run) => run.missedShare)) <= MAX_MISSED_SHARE && median(runs.map((run) => run.longestFrameMs)) <= MAX_LONGEST_FRAME_MS;
const say = (runs) =>
  `median ${(median(runs.map((run) => run.missedShare)) * 100).toFixed(1)}% missed vsyncs, longest ${median(runs.map((run) => run.longestFrameMs)).toFixed(0)} ms (runs: ${runs.map((run) => `${(run.missedShare * 100).toFixed(1)}%`).join(" ")})`;

if (!existsSync(reportFile)) {
  failures.push(`missing: ${reportFile} — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "gantt") failures.push(`the report is not the Gantt measurement (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`the throttling is ${String(report.throttle)}x, not 4x`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`stale dist (${JSON.stringify(report.fresh)}) — it would measure old code`);
  for (const name of ["culled", "control"]) {
    const { pan = [], zoom = [] } = report.runs?.[name] ?? {};
    if (pan.length < MIN_REPS || zoom.length < MIN_REPS) failures.push(`${name}: ${String(pan.length)}/${String(zoom.length)} runs, at least ${String(MIN_REPS)} are required — a measurement that cannot run is a FAILURE`);
    pan.forEach((run, index) => {
      const at = `${name} pan #${String(index + 1)}`;
      if (run.tasks !== 10_000 || run.dependencies !== 10_000) failures.push(`${at}: ${String(run.tasks)} tasks, ${String(run.dependencies)} dependencies — 10,000 / 10,000 are required`);
      if (run.cull !== (name === "culled")) failures.push(`${at}: the page has cull=${String(run.cull)}, the variant is ${name}`);
      if (name === "culled" && !(run.counts.arrows > 0)) failures.push(`${at}: not a single arrow on the page — the measurement is empty`);
      if (name === "control" && !(run.counts.arrows >= 10_000)) failures.push(`${at}: the control draws ${String(run.counts.arrows)} arrows, 10,000 are required — it does not measure what it claims`);
      if (!(Math.abs(run.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`${at}: 12 drags moved ${run.midPx.toFixed(0)} px, ~${String(TARGET_PX)} is required`);
      if (run.edits !== 0) failures.push(`${at}: the pan edited ${String(run.edits)} items`);
    });
    zoom.forEach((run, index) => {
      if (!(run.peakFactor >= 3)) failures.push(`${name} zoom #${String(index + 1)}: the peak is ${run.peakFactor.toFixed(2)}x, at least 3x is required`);
      if (run.edits !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.edits)} edits`);
    });
  }
  const culled = report.runs?.culled ?? {};
  const control = report.runs?.control ?? {};
  if ((culled.pan?.length ?? 0) > 0 && (culled.zoom?.length ?? 0) > 0) {
    for (const [what, runs] of [["pan", culled.pan], ["zoom", culled.zoom]]) {
      if (within(runs)) notes.push(`${what}: ${say(runs)}`);
      else failures.push(`${what}: ${say(runs)} — the threshold is 5% and 100 ms`);
    }
  }
  if ((control.pan?.length ?? 0) > 0 && (control.zoom?.length ?? 0) > 0) {
    if (within(control.pan) && within(control.zoom)) {
      failures.push(`the negative control (without culling) does NOT fail: pan ${say(control.pan)}, zoom ${say(control.zoom)} — the measurement cannot see what culling saves`);
    } else {
      notes.push(`the control (without culling) fails, as it should: pan ${say(control.pan)}; zoom ${say(control.zoom)}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "G-PERF-GANTT: passed" : "G-PERF-GANTT: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
