#!/usr/bin/env node
/**
 * G-PERF-RESOURCES: with 500 resources and 10,000 assignments, with load
 * bands, pan and wheel zoom are within the G-PERF thresholds (<= 5% missed
 * vsyncs, <= 100 ms longest frame, by the median of three fresh pages) — and
 * the sensitivity control (`?burn=24`: one and a half vsyncs of extra work on
 * every frame during a gesture) FAILS: both the pan AND the zoom are over the
 * threshold. Otherwise the measurement is blind on this page.
 *
 * Originally the negative control was drawing without culling
 * (`resourceOptions.cull: false`). That did not fail: 10,000 segments joined
 * into four paths, rebuilt on every frame, still gave 0.0% missed vsyncs at
 * 4x throttling. The assumption — that the layer is expensive without
 * culling — is false at this size (like the earlier flat control of
 * G-PERF-DEEP); so by design the control claims what has to be proven — that
 * the measurement is not blind — and drawing without culling is a note.
 *
 * Validity — if any of these is violated, the check FAILS:
 *   - the report exists, `resources`, with 4x throttling, at least three runs
 *     in both variants, with a fresh core and element dist;
 *   - the page draws 500 resources and 10,000 assignments, and the culled
 *     variant really culled (`cull: true`), the control did not;
 *   - load bars and overloads are visible on the culled page (> 0), and at
 *     least 10,000 bars without culling (every segment of every resource) —
 *     otherwise the note does not measure what it claims;
 *   - the sensitivity control draws the same as the culled page (culled, the
 *     same number of bars), its only difference is `burn`, and the extra work
 *     really ran (in >= 100 frames when panning, >= 10 when zooming; never on
 *     the other pages) — otherwise it does not measure the measurement's
 *     sensitivity;
 *   - the drags really moved the view, edited nothing, and the zoom really
 *     magnified (peak >= 3x).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-resources.json");
const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MIN_REPS = 3;
const TARGET_PX = 12 * 240;
const BURN_MS = 24;
const VARIANTS = ["culled", "control", "sensitivity"];

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
  if (report.kind !== "resources") failures.push(`the report is not the resource measurement (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`the throttling is ${String(report.throttle)}x, not 4x`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`stale dist (${JSON.stringify(report.fresh)}) — it would measure old code`);
  if (report.burnMs !== BURN_MS) failures.push(`the sensitivity control burned ${String(report.burnMs)} ms, ${String(BURN_MS)} are required`);
  for (const name of VARIANTS) {
    const { pan = [], zoom = [] } = report.runs?.[name] ?? {};
    if (pan.length < MIN_REPS || zoom.length < MIN_REPS) failures.push(`${name}: ${String(pan.length)}/${String(zoom.length)} runs, at least ${String(MIN_REPS)} are required — a measurement that cannot run is a FAILURE`);
    pan.forEach((run, index) => {
      const at = `${name} pan #${String(index + 1)}`;
      if (run.resources !== 500 || run.assignments !== 10_000) failures.push(`${at}: ${String(run.resources)} resources, ${String(run.assignments)} assignments — 500 / 10,000 are required`);
      if (run.cull !== (name !== "control")) failures.push(`${at}: the page has cull=${String(run.cull)}, the variant is ${name}`);
      if (run.burn !== (name === "sensitivity" ? BURN_MS : 0)) failures.push(`${at}: the page has burn=${String(run.burn)}, the variant is ${name}`);
      if (name === "sensitivity" ? !(run.burned >= 100) : run.burned !== 0) failures.push(`${at}: ${String(run.burned)} frames did the extra work — the control needs at least 100, elsewhere 0`);
      const twin = report.runs?.culled?.pan?.[index];
      if (name === "sensitivity" && twin !== undefined && JSON.stringify(run.counts) !== JSON.stringify(twin.counts)) {
        failures.push(`${at}: ${JSON.stringify(run.counts)} on the page, culled has ${JSON.stringify(twin.counts)} — it does not draw the same`);
      }
      if (name === "culled" && !(run.counts.bars > 0 && run.counts.overloads > 0)) failures.push(`${at}: ${String(run.counts.bars)} load bars, ${String(run.counts.overloads)} overloads on the page — the measurement is empty`);
      if (name === "control" && !(run.counts.bars >= 10_000)) failures.push(`${at}: the control draws ${String(run.counts.bars)} bars, 10,000 are required — it does not measure what it claims`);
      if (!(Math.abs(run.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`${at}: 12 drags moved ${run.midPx.toFixed(0)} px, ~${String(TARGET_PX)} is required`);
      if (run.edits !== 0) failures.push(`${at}: the pan edited ${String(run.edits)} items`);
    });
    zoom.forEach((run, index) => {
      if (!(run.peakFactor >= 3)) failures.push(`${name} zoom #${String(index + 1)}: the peak is ${run.peakFactor.toFixed(2)}x, at least 3x is required`);
      if (run.cull !== (name !== "control") || run.burn !== (name === "sensitivity" ? BURN_MS : 0)) failures.push(`${name} zoom #${String(index + 1)}: the page has cull=${String(run.cull)}, burn=${String(run.burn)}`);
      if (name === "sensitivity" ? !(run.burned >= 10) : run.burned !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.burned)} frames did the extra work — the control needs at least 10, elsewhere 0`);
      if (run.edits !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.edits)} edits`);
    });
  }
  const culled = report.runs?.culled ?? {};
  const control = report.runs?.control ?? {};
  const sensitivity = report.runs?.sensitivity ?? {};
  if ((culled.pan?.length ?? 0) > 0 && (culled.zoom?.length ?? 0) > 0) {
    for (const [what, runs] of [["pan", culled.pan], ["zoom", culled.zoom]]) {
      if (within(runs)) notes.push(`${what}: ${say(runs)}`);
      else failures.push(`${what}: ${say(runs)} — the threshold is 5% and 100 ms`);
    }
  }
  if ((sensitivity.pan?.length ?? 0) > 0 && (sensitivity.zoom?.length ?? 0) > 0) {
    // It must fail on both motions: otherwise one of the measurements is blind, and its green says nothing.
    if (within(sensitivity.pan) || within(sensitivity.zoom)) {
      failures.push(`the sensitivity control (+${String(BURN_MS)} ms per frame) does NOT fail on both motions: pan ${say(sensitivity.pan)}, zoom ${say(sensitivity.zoom)} — the measurement is blind on this page`);
    } else {
      notes.push(`the sensitivity control (+${String(BURN_MS)} ms per frame) fails, as it should: pan ${say(sensitivity.pan)}; zoom ${say(sensitivity.zoom)}`);
    }
  }
  if ((control.pan?.length ?? 0) > 0 && (control.zoom?.length ?? 0) > 0) {
    // A note, not a verdict: at this size culling is not load-bearing.
    notes.push(`note — without culling (every load on every frame): pan ${say(control.pan)}; zoom ${say(control.zoom)}`);
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "G-PERF-RESOURCES: passed" : "G-PERF-RESOURCES: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
