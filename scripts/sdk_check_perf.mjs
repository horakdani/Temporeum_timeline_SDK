#!/usr/bin/env node
/**
 * G-PERF: proves that 60 fps holds with 2000 visible items out of 10,000 —
 * MEASURED, in real Chromium, with 4x CPU throttling — and that the
 * measurement FAILS below the threshold.
 *
 * The measurement is the sdk_bench.mjs report (packages/core/.bench-perf.json).
 * The thresholds are HERE, in one place, and were recorded in the decisions
 * in state.json BEFORE the benchmark was written:
 *
 *   share of missed vsyncs per gesture        <= 5%   (effective >= 57 fps)
 *   the longest frame                         <= 100 ms
 *   the settled frame after the gesture       <= 100 ms (RAIL)
 *
 * Three scenarios, all three required: a pan at the budget, a 2x pinch zoom
 * from the budget's point, and a pan in the 2x view, where ~1000 items have
 * ~1000 labels. The reading of "2000 visible items": ANY view with at most
 * 2000 visible items — not only the one where the labels do not fit.
 *
 * Validity conditions — if any is violated, the measurement proves nothing,
 * and the check FAILS whatever numbers it shows:
 *
 *   - the report exists, and is about a FRESH dist (source fingerprint matches);
 *   - the throttling is 4x, and the data holds 10,000 items;
 *   - at the budget, according to the browser, 1900-2200 items REALLY are in view;
 *   - in the labelled view at least 500 labels are visible (otherwise it is not labelled);
 *   - the input really is coalesced: more events arrived than draws;
 *   - the NEGATIVE CONTROL (without the item space) FAILS at the budget. If
 *     it passed, the measurement would not tell good from bad — or the
 *     throttling has no effect.
 *
 * `node scripts/sdk_check_perf.mjs public` — G-PERF-PUBLIC: the SAME
 * thresholds and conditions on the public path's report (packages/docs/
 * .bench-public.json, on the bench-public.html page: createTimeline from the
 * shipped element bundle). Two more conditions there: the report really is
 * the public measurement (kind), and the "space" run really drew in the item
 * space and the "exact" one did not — otherwise we would be measuring
 * something other than the configuration's default.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = process.argv[2] === "public";
const GATE = PUBLIC ? "G-PERF-PUBLIC" : "G-PERF";
const reportFile = PUBLIC ? join(repoRoot, "packages", "docs", ".bench-public.json") : join(repoRoot, "packages", "core", ".bench-perf.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
const MIN_LABELS_IN_LABELLED_VIEW = 500;
const REQUIRED = ["pan", "zoom", "pan-labelled"];

const failures = [];
const notes = [];

function verdict(run) {
  const reasons = [];
  if (!(run.missedVsyncShare <= MAX_MISSED_SHARE)) {
    reasons.push(
      `missed vsyncs ${(run.missedVsyncShare * 100).toFixed(1)}% > ${String(MAX_MISSED_SHARE * 100)}% (${run.effectiveFps.toFixed(1)} fps)`,
    );
  }
  if (!(run.longestFrameMs <= MAX_LONGEST_FRAME_MS)) {
    reasons.push(`longest frame ${run.longestFrameMs.toFixed(0)} ms > ${String(MAX_LONGEST_FRAME_MS)} ms`);
  }
  if (!(run.settleMs <= MAX_SETTLE_MS)) {
    reasons.push(`settled frame ${run.settleMs.toFixed(0)} ms > ${String(MAX_SETTLE_MS)} ms`);
  }
  return reasons;
}

if (!existsSync(reportFile)) {
  failures.push(`no measurement report (${reportFile}) — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  // --- validity -----------------------------------------------------------
  if (report.kind !== (PUBLIC ? "public" : "perf")) {
    failures.push(`the report belongs to another measurement (${String(report.kind)}) — it does not measure this path`);
  }
  if (PUBLIC) {
    for (const run of Array.isArray(report.runs) ? report.runs : []) {
      if (run.sceneSpace !== (run.mode === "space")) {
        failures.push(
          `${String(run.mode)} ${String(run.name)}: createTimeline drew ${run.sceneSpace ? "in the item space" : "without the item space"} — ` +
            "not what the scenario measures",
        );
      }
    }
  }
  if (report.throttle !== 4) {
    failures.push(`the throttling is ${String(report.throttle)}x, not the fixed 4x`);
  }
  const stale = (report.builds ?? []).filter((source) => source !== report.expectedSource);
  if ((report.builds ?? []).length === 0 || stale.length > 0) {
    failures.push(
      "the browser did NOT run the fresh dist (the dist/build.json fingerprint differs from the source's) — this measures old code",
    );
  } else {
    notes.push(`fresh dist: ${String(report.expectedSource).slice(0, 12)}…`);
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const find = (mode, name) => runs.find((run) => run.mode === mode && run.name === name);

  for (const name of REQUIRED) {
    const run = find("space", name);
    if (run === undefined) {
      failures.push(`scenario missing: ${name} — a measurement that cannot run is a FAILURE`);
      continue;
    }
    if (run.totalItems !== 10_000) {
      failures.push(`${name}: ${String(run.totalItems)} items in the data, not 10,000`);
    }
    const visible = run.before?.visibleItems;
    if (name === "pan-labelled") {
      if (!(visible <= BUDGET_VISIBLE[1])) {
        failures.push(`${name}: ${String(visible)} visible items — over the budget, not valid`);
      }
      if (!(run.before?.visibleLabels >= MIN_LABELS_IN_LABELLED_VIEW)) {
        failures.push(
          `${name}: only ${String(run.before?.visibleLabels)} labels are visible — this is not the labelled view, the measurement is invalid`,
        );
      }
    } else if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
      failures.push(
        `${name}: according to the browser ${String(visible)} items are visible, not ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`,
      );
    }
    if (!(run.inputEvents > run.draws)) {
      failures.push(
        `${name}: ${String(run.inputEvents)} events and ${String(run.draws)} draws — the input is not coalesced per frame`,
      );
    }
    // --- the verdict -------------------------------------------------------
    const reasons = verdict(run);
    const line =
      `${name}: ${String(visible)} items, ${String(run.before?.visibleLabels)} labels — ` +
      `${(run.missedVsyncShare * 100).toFixed(1)}% missed vsyncs, ${run.effectiveFps.toFixed(1)} fps, ` +
      `longest ${run.longestFrameMs.toFixed(0)} ms, settled ${run.settleMs.toFixed(0)} ms, ` +
      `re-anchors ${String(run.reanchors ?? "-")}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  // --- for information, without a verdict --------------------------------
  const INFORMATIVE = { "zoom-deep": "4x pinch", "pan-long": "long pan (4 x 1200 px)" };
  for (const [name, title] of Object.entries(INFORMATIVE)) {
    for (const mode of ["space", "exact"]) {
      const run = find(mode, name);
      if (run !== undefined) {
        notes.push(
          `informative, not gated — ${mode === "space" ? "with space" : "without space"} ${title}: ` +
            `${(run.missedVsyncShare * 100).toFixed(1)}% missed vsyncs, longest ${run.longestFrameMs.toFixed(0)} ms, ` +
            `settled ${run.settleMs.toFixed(0)} ms, re-anchors ${String(run.reanchors ?? "-")}`,
        );
      }
    }
  }

  // --- the negative control ----------------------------------------------
  const control = find("exact", "pan");
  if (control === undefined) {
    failures.push("the negative control is missing (a pan without the item space) — the measurement's sensitivity is unproven");
  } else if (verdict(control).length === 0) {
    failures.push(
      `the negative control PASSED (${(control.missedVsyncShare * 100).toFixed(1)}% missed without the item space) — ` +
        "the measurement does not tell good from bad, or the throttling has no effect",
    );
  } else {
    notes.push(
      `the negative control fails, as it should: ${(control.missedVsyncShare * 100).toFixed(1)}% missed without the item space`,
    );
  }
}

for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const failure of failures) {
  console.log(`  FAIL  ${failure}`);
}
if (failures.length > 0) {
  console.log(`${GATE}: FAILED (${String(failures.length)} failure(s))`);
  process.exit(1);
}
console.log(`${GATE}: passed`);
