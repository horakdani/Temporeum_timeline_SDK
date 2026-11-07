#!/usr/bin/env node
/**
 * The perf-wheel check: proves that the throttled benchmark's zoom — on a fresh, quiet
 * page, Control + a real wheel, 8 notches in and 8 out, every 50 ms, 1.2x per
 * notch, a 4.3x peak — also holds the perf check's thresholds, on the core path
 * (bench.html, the README's loop) AND on the public path (bench-public.html,
 * createTimeline from the shipped bundle, with the throttled benchmark's page's
 * settings: editing on, the default density), and that the measurement
 * FAILS on three negative controls.
 *
 * The thresholds are the same as in sdk_check_perf.mjs (recorded up front):
 *
 *   share of missed vsyncs <= 5%, longest frame <= 100 ms,
 *   the settled frame after the wheel run <= 100 ms
 *
 * Every variant runs on three fresh pages, and the check judges the MEDIAN —
 * the controls too — because one missed vsync of the recording is 1.5%: a
 * single run near the threshold would hang on the luck of one frame. The
 * report holds every run, and the check prints the worst one as well.
 *
 * Before the wheel run was treated as one gesture, this scenario was at 9.8%
 * in the throttled benchmark on the public path; on the README's loop, which
 * settled after every wheel notch, 53%.
 *
 * Validity — if any of these is violated, the check FAILS:
 *
 *   - the report exists, is the `wheel` measurement, with 4x throttling,
 *     10,000 items, at least three runs per variant;
 *   - both pages ran from a FRESH dist;
 *   - at the start of the wheel 1900-2200 items REALLY are in view;
 *   - all 16 wheel notches reached the page, the peak is at least 4x, and the
 *     view came back (0.8-1.25x);
 *   - the public "space" run really drew in the item space, the "exact" one did not;
 *   - on the core page the "space" run went with the wheel run, the "norun" one without.
 *
 * Negative controls, all three must FAIL:
 *
 *   - without the item space (exact) on both paths — otherwise the
 *     measurement does not tell good from bad, or the throttling has no
 *     effect;
 *   - on the core page without the wheel run (norun: the host settles after
 *     every notch, as it did with the earlier machine) — otherwise it is not
 *     the wheel run that holds the threshold, and the check is not about it.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-wheel.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
const MIN_REPS = 3;
const NOTCHES = 16;

const failures = [];
const notes = [];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The runs' median, per metric. */
function summary(runs) {
  return {
    missedVsyncShare: median(runs.map((run) => run.missedVsyncShare)),
    longestFrameMs: median(runs.map((run) => run.longestFrameMs)),
    settleMs: median(runs.map((run) => run.settleMs)),
    all: runs.map((run) => `${(run.missedVsyncShare * 100).toFixed(1)}%`).join(" "),
  };
}

function verdict(run) {
  const reasons = [];
  if (!(run.missedVsyncShare <= MAX_MISSED_SHARE)) {
    reasons.push(`missed vsyncs ${(run.missedVsyncShare * 100).toFixed(1)}% > ${String(MAX_MISSED_SHARE * 100)}%`);
  }
  if (!(run.longestFrameMs <= MAX_LONGEST_FRAME_MS)) {
    reasons.push(`longest frame ${run.longestFrameMs.toFixed(0)} ms > ${String(MAX_LONGEST_FRAME_MS)} ms`);
  }
  if (!(run.settleMs <= MAX_SETTLE_MS)) {
    reasons.push(`settled frame ${run.settleMs.toFixed(0)} ms > ${String(MAX_SETTLE_MS)} ms`);
  }
  return reasons;
}

const describe = (run) =>
  `median ${(run.missedVsyncShare * 100).toFixed(1)}% missed vsyncs (runs: ${run.all}), ` +
  `longest ${run.longestFrameMs.toFixed(0)} ms, settled ${run.settleMs.toFixed(0)} ms`;

if (!existsSync(reportFile)) {
  failures.push(`no measurement report (${reportFile}) — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "wheel") {
    failures.push(`the report belongs to another measurement (${String(report.kind)})`);
  }
  if (report.throttle !== 4) {
    failures.push(`the throttling is ${String(report.throttle)}x, not the fixed 4x`);
  }
  const builds = Array.isArray(report.builds) ? report.builds : [];
  const stale = builds.filter((build) => build.actual !== build.expected);
  if (builds.length === 0 || stale.length > 0) {
    failures.push(`the browser did NOT run the fresh dist (${stale.map((build) => build.path).join(", ")}) — this measures old code`);
  } else {
    notes.push(`fresh dist on both pages (${String(builds.length)} page loads)`);
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const find = (path, mode) => runs.filter((run) => run.path === path && run.mode === mode && run.name === "zoom-wheel");

  /** The runs' validity; problems go into `failures`. */
  function valid(path, mode, found) {
    if (found.length < MIN_REPS) {
      failures.push(`${path} ${mode}: ${String(found.length)} runs, not at least ${String(MIN_REPS)} — a measurement that cannot run is a FAILURE`);
      return false;
    }
    let ok = true;
    for (const run of found) {
      const where = `${path} ${mode} #${String(run.rep + 1)}`;
      if (run.totalItems !== 10_000) {
        failures.push(`${where}: ${String(run.totalItems)} items in the data, not 10,000`);
        ok = false;
      }
      const visible = run.before?.visibleItems;
      if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
        failures.push(`${where}: according to the browser ${String(visible)} items are visible, not ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`);
        ok = false;
      }
      if (run.inputEvents !== NOTCHES) {
        failures.push(`${where}: ${String(run.inputEvents)} wheel events arrived, not ${String(NOTCHES)}`);
        ok = false;
      }
      if (!(run.peakFactor >= 4) || !(run.finalFactor > 0.8 && run.finalFactor < 1.25)) {
        failures.push(`${where}: peak ${String(run.peakFactor)}x, end ${String(run.finalFactor)}x — not the fixed zoom`);
        ok = false;
      }
      if (path === "public" && run.sceneSpace !== (mode === "space")) {
        failures.push(`${where}: createTimeline drew ${run.sceneSpace ? "in" : "outside"} the item space — not what the variant claims`);
        ok = false;
      }
      if (path === "core" && run.wheelRun !== (mode !== "norun")) {
        failures.push(`${where}: the page ${run.wheelRun ? "did" : "did not"} treat the wheel run as a gesture — not what the variant claims`);
        ok = false;
      }
      if (path === "core" && mode !== "exact" && run.levels !== true) {
        failures.push(`${where}: the core page ran without steps — we did not measure the recommended path`);
        ok = false;
      }
    }
    return ok;
  }

  for (const [path, mode] of [
    ["core", "space"],
    ["public", "space"],
  ]) {
    const found = find(path, mode);
    if (!valid(path, mode, found)) {
      continue;
    }
    const run = summary(found);
    const reasons = verdict(run);
    const line = `${path === "core" ? "core path" : "public path"}: ${describe(run)}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  for (const [path, mode, what] of [
    ["core", "exact", "core, without the item space"],
    ["public", "exact", "public, without the item space"],
    ["core", "norun", "core, without the wheel run"],
  ]) {
    const found = find(path, mode);
    if (!valid(path, mode, found)) {
      continue;
    }
    const run = summary(found);
    if (verdict(run).length === 0) {
      failures.push(`the negative control (${what}) does NOT fail: ${describe(run)} — the measurement does not distinguish what it claims`);
    } else {
      notes.push(`the negative control fails, as it should — ${what}: ${describe(run)}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "perf-wheel: passed" : `perf-wheel: FAILED (${String(failures.length)} failure(s))`);
process.exit(failures.length === 0 ? 0 : 1);
