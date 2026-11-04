#!/usr/bin/env node
/**
 * The perf-deep check: proves that the 4x pinch (zoom-deep: from 100 px to 400 px
 * and back, two seconds) also holds the perf check's thresholds — on the core path
 * (bench.html) AND on the public path (bench-public.html, createTimeline
 * from the shipped bundle) — and that the measurement FAILS on two negative
 * controls.
 *
 * The thresholds are the same as in sdk_check_perf.mjs (recorded up front):
 *
 *   share of missed vsyncs <= 5%, longest frame <= 100 ms,
 *   the settled frame after the gesture <= 100 ms
 *
 * This scenario used to be informative only: 9-11% missed, with six
 * re-anchors. Since re-anchoring became stepped and gradual, it is gated.
 *
 * Validity — if any of these is violated, the check FAILS:
 *
 *   - the report exists, is the `deep` measurement, with 4x throttling, 10,000 items;
 *   - both pages ran from a FRESH dist (the core page with the core's, the
 *     public page with the core's AND the element's source fingerprint);
 *   - at the start of the gesture 1900-2200 items REALLY are in view;
 *   - the input is coalesced (more events than draws);
 *   - the public "space" run really drew in the item space, the "exact" one did not;
 *   - on the core page the "space" run went with steps, the "flat" one without.
 *
 * Negative controls:
 *
 *   - without the item space (exact) it must FAIL on both paths — otherwise
 *     the measurement does not tell good from bad, or the throttling has no
 *     effect;
 *   - on the core page, without steps (flat: every re-anchor in one frame)
 *     it is MEASURABLY WORSE than the stepped path: it either fails, or
 *     misses at least 1 percentage point more vsyncs — otherwise stepped
 *     re-anchoring does not matter, and the check is not about it.
 *
 * The flat control used to fail on the threshold. Then slimming the DOM
 * patcher (one attribute reference per node instead of two Maps) made full
 * re-anchoring cheaper too: the flat path stayed BELOW the threshold at
 * 2.4-3.2%, while the stepped one was at 0.0%. That disproved the
 * threshold-failure assumption — an IMPROVEMENT would have failed the
 * check — so the control claims what really has to be proven: the steps
 * are measurably better.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-deep.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
/** The flat control must miss this many more vsyncs than the stepped path. */
const MIN_FLAT_PENALTY = 0.01;

const failures = [];
const notes = [];

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
  `${(run.missedVsyncShare * 100).toFixed(1)}% missed vsyncs, longest ${run.longestFrameMs.toFixed(0)} ms, ` +
  `settled ${run.settleMs.toFixed(0)} ms, re-anchors ${String(run.reanchors ?? "-")}`;

if (!existsSync(reportFile)) {
  failures.push(`no measurement report (${reportFile}) — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "deep") {
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
  const find = (path, mode) => runs.find((run) => run.path === path && run.mode === mode && run.name === "zoom-deep");

  for (const [path, mode] of [
    ["core", "space"],
    ["public", "space"],
  ]) {
    const run = find(path, mode);
    if (run === undefined) {
      failures.push(`missing: ${path} ${mode} zoom-deep — a measurement that cannot run is a FAILURE`);
      continue;
    }
    if (run.totalItems !== 10_000) {
      failures.push(`${path}: ${String(run.totalItems)} items in the data, not 10,000`);
    }
    const visible = run.before?.visibleItems;
    if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
      failures.push(`${path}: according to the browser ${String(visible)} items are visible, not ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`);
    }
    if (!(run.inputEvents > run.draws)) {
      failures.push(`${path}: ${String(run.inputEvents)} events and ${String(run.draws)} draws — the input is not coalesced`);
    }
    if (path === "public" && run.sceneSpace !== true) {
      failures.push("public space: createTimeline did not draw in the item space — we did not measure the configuration's default");
    }
    if (path === "core" && run.levels !== true) {
      failures.push("core space: the core page ran without steps — we did not measure the recommended path");
    }
    const reasons = verdict(run);
    const line = `${path === "core" ? "core path" : "public path"}: ${String(visible)} items — ${describe(run)}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  for (const [path, mode, what] of [
    ["core", "exact", "core, without the item space"],
    ["public", "exact", "public, without the item space"],
    ["core", "flat", "core, without steps"],
  ]) {
    const run = find(path, mode);
    if (run === undefined) {
      failures.push(`negative control missing: ${what} — a control that cannot run is a FAILURE`);
      continue;
    }
    if (path === "public" && run.sceneSpace !== false) {
      failures.push("public exact: the control drew in the item space — not a control");
    }
    if (path === "core" && mode === "flat" && run.levels !== false) {
      failures.push("core flat: the control ran with steps — not a control");
    }
    if (verdict(run).length > 0) {
      notes.push(`the negative control fails, as it should — ${what}: ${describe(run)}`);
      continue;
    }
    const levelled = mode === "flat" ? find("core", "space") : undefined;
    if (levelled !== undefined && run.missedVsyncShare - levelled.missedVsyncShare >= MIN_FLAT_PENALTY) {
      notes.push(
        `the negative control is measurably worse, as it should be — ${what}: ${describe(run)}; ` +
          `the stepped path ${(levelled.missedVsyncShare * 100).toFixed(1)}%`,
      );
    } else {
      failures.push(`the negative control (${what}) does NOT fail${mode === "flat" ? ", nor is it measurably worse" : ""}: ${describe(run)} — the measurement does not distinguish what it claims`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "perf-deep: passed" : `perf-deep: FAILED (${String(failures.length)} failure(s))`);
process.exit(failures.length === 0 ? 0 : 1);
