#!/usr/bin/env node
/**
 * The pan-memory check: proves that the throttled benchmark's pan at 10,000 items keeps
 * the heap growth to at most 6.5 MB — under two thirds of the earlier measured
 * value (+10.4 MB) — by the median of three fresh pages, and that during the pan it stays
 * within the perf check's thresholds (<= 5% missed vsyncs, <= 100 ms longest
 * frame, by median).
 *
 * The earlier value is from the published benchmark run (1.0.0-rc.3): heap
 * 9.1 MB after load, 19.5 MB after the pan. The limit was half of it (5.2 MB)
 * until 1.0.1, when the same pages measured +5.3 MB on 1.0.0 and 1.0.1 alike:
 * a browser's heap moves by a few per cent from one machine and version to
 * the next, so the limit leaves room for that (about a fifth over the
 * measurement), not for a leak.
 *
 * Validity — if any of these is violated, the check FAILS:
 *   - the report exists, `pan-memory`, with 4x throttling, 10,000 items,
 *     at least three runs, with a fresh core and element dist;
 *   - in every run the drag really moved the view (+2880 px +-25%, back to
 *     within one drag), and edited nothing;
 *   - in every run there are MORE item nodes after the pan than after load:
 *     the overscan really was drawn, so the measured growth is what the
 *     check is about, not a page that is still empty.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-pan-memory.json");
const P15_GROWTH = 10.4e6;
const MAX_GROWTH = 6.5e6;
const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MIN_REPS = 3;
const TARGET_PX = 12 * 240;

const failures = [];
const notes = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (!existsSync(reportFile)) {
  failures.push(`missing: ${reportFile} — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const runs = report.panRuns ?? [];
  if (report.kind !== "pan-memory") failures.push(`the report is not the pan-memory measurement (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`the throttling is ${String(report.throttle)}x, not 4x`);
  if (report.items !== 10_000) failures.push(`${String(report.items)} items, not 10,000`);
  if (runs.length < MIN_REPS) failures.push(`${String(runs.length)} runs, at least ${String(MIN_REPS)} are required — a measurement that cannot run is a FAILURE`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`stale dist (${JSON.stringify(report.fresh)}) — it would measure old code`);
  runs.forEach((run, index) => {
    if (!(Math.abs(run.pan.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`#${String(index + 1)}: 12 drags moved ${run.pan.midPx.toFixed(0)} px, ~${String(TARGET_PX)} is required`);
    if (!(Math.abs(run.pan.endPx) <= 0.25 * 240)) failures.push(`#${String(index + 1)}: after 24 drags ${run.pan.endPx.toFixed(0)} px from the start`);
    if (run.edits !== 0) failures.push(`#${String(index + 1)}: the pan edited ${String(run.edits)} items`);
    if (!(run.itemNodesAfterPan > run.itemNodesAfterLoad)) {
      failures.push(`#${String(index + 1)}: no more item nodes after the pan (${String(run.itemNodesAfterLoad)} -> ${String(run.itemNodesAfterPan)}) — the overscan was not drawn, the measurement is empty`);
    }
  });
  if (runs.length > 0) {
    const growth = median(runs.map((run) => run.heapGrowth));
    const missed = median(runs.map((run) => run.pan.missedShare));
    const longest = median(runs.map((run) => run.pan.longestFrameMs));
    const all = runs.map((run) => `+${(run.heapGrowth / 1e6).toFixed(2)}`).join(" ");
    if (!(growth <= MAX_GROWTH)) failures.push(`heap growth median +${(growth / 1e6).toFixed(2)} MB > ${(MAX_GROWTH / 1e6).toFixed(1)} MB (runs: ${all} MB)`);
    else notes.push(`heap growth median +${(growth / 1e6).toFixed(2)} MB <= ${(MAX_GROWTH / 1e6).toFixed(1)} MB, against the earlier +${(P15_GROWTH / 1e6).toFixed(1)} MB (runs: ${all} MB)`);
    if (!(missed <= MAX_MISSED_SHARE)) failures.push(`pan: median ${(missed * 100).toFixed(1)}% missed vsyncs > 5%`);
    if (!(longest <= MAX_LONGEST_FRAME_MS)) failures.push(`pan: median longest frame ${longest.toFixed(0)} ms > 100 ms`);
    if (missed <= MAX_MISSED_SHARE && longest <= MAX_LONGEST_FRAME_MS) {
      notes.push(`pan: median ${(missed * 100).toFixed(1)}% missed vsyncs, longest ${longest.toFixed(0)} ms (runs: ${runs.map((run) => `${(run.pan.missedShare * 100).toFixed(1)}%`).join(" ")})`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "pan-memory: passed" : "pan-memory: FAILED");
process.exit(failures.length === 0 ? 0 : 1);
