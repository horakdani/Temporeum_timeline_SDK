#!/usr/bin/env node
/**
 * The memory check: proves that after a long pan the node count does not grow
 * monotonically — that is, that the pool REALLY recycles, and does not merely
 * exist.
 *
 * The measurement is the sdk_bench.mjs report (packages/core/.bench-memory.json):
 * 24 drags in real Chromium, across ~4 views' width of data, with the
 * patcher's counters AND the browser's own counters per drag (CDP Performance
 * "Nodes", after garbage collection). Two independent sources, because the
 * patcher's counter is the patcher's claim about itself — CDP is not.
 *
 * Criteria:
 *
 *  1. Once the pool is warm (the second half of the pan) practically no new
 *     node is created: the increase is <= 0.5% of the live DOM — plus as
 *     much as the number of live label nodes grew in the second half.
 *     (A label straddling a tile boundary is no longer dropped, so the pan
 *     goes from 0 to 48 labels at the sparse end of the data. The pool
 *     cannot give those back: until then no label had been released, and a
 *     rect cannot be turned into text. The criterion used to charge every
 *     creation to the pool, including that of the growing live set.)
 *  2. The live DOM and the CDP Nodes do not grow with distance: the maximum
 *     of the last third <= the maximum of the first third x 1.05 (DOM) /
 *     x 1.10 (CDP, because it also counts detached nodes held in the pool) —
 *     without the label nodes. That is the view's content, not the pool: at
 *     the sparse end of the data "auto" truncation goes from 0 to ~400
 *     labels, two elements per label (foreignObject + HTML row) and one text
 *     node. Criterion 1 already subtracts the GROWTH of labels; criterion 2
 *     used not to, and counted one node per label.
 *  3. In the second half the pool handed out at least as many reused nodes
 *     (x 0.9) as the control without a pool created at the same point — that
 *     is, what is a new node for the control comes from the pool here. (The
 *     first version of this criterion asked for an aggregate "reuse >
 *     creation" ratio, which put the initial build on the creation side too:
 *     whether it held depended on the length of the measurement and the size
 *     of the live set, not on the pool. The drawn range grew threefold, and
 *     the criterion failed, while in the second half 0 new nodes were
 *     created and the pool handed out exactly as many as the control
 *     created.)
 *  4. NEGATIVE CONTROL: the same without a pool (poolLimit: 0) keeps creating
 *     nodes in the second half (>= 25% of the live DOM). If not, the
 *     measurement cannot see the pool's effect, and criterion 1 proves
 *     nothing.
 *
 * Validity: a fresh dist (source fingerprint), at least 20 samples, and
 * >= 1800 visible items in every sample — a pan that runs into an empty area
 * trivially "does not grow" the node count.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "core", ".bench-memory.json");

const MIN_SAMPLES = 20;
const MIN_VISIBLE = 1800;
const MAX_LATE_CREATION_SHARE = 0.005;
const MAX_DOM_GROWTH = 1.05;
const MAX_CDP_GROWTH = 1.1;
const MIN_CONTROL_CREATION_SHARE = 0.25;
const MIN_REUSE_OF_CONTROL_CREATION = 0.9;

const failures = [];
const notes = [];

const max = (values) => Math.max(...values);

function lateCreation(samples) {
  const middle = samples[Math.floor(samples.length / 2)];
  const last = samples[samples.length - 1];
  return {
    created: last.created - middle.created,
    reused: last.reused - middle.reused,
    live: last.domNodes,
    labelGrowth: Math.max(0, last.labelNodes - middle.labelNodes),
    labelsKnown: Number.isInteger(last.labelNodes) && Number.isInteger(middle.labelNodes),
  };
}

if (!existsSync(reportFile)) {
  failures.push(`no measurement report (${reportFile}) — the measurement did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const stale = (report.builds ?? []).filter((source) => source !== report.expectedSource);
  if ((report.builds ?? []).length === 0 || stale.length > 0) {
    failures.push("the browser did NOT run the fresh dist — this measures old code");
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const pooled = runs.find((run) => run.poolLimit === null);
  const control = runs.find((run) => run.poolLimit === 0);

  for (const [name, run] of [
    ["pool", pooled],
    ["control", control],
  ]) {
    if (run === undefined) {
      failures.push(`the ${name} run is missing — a measurement that cannot run is a FAILURE`);
      continue;
    }
    const samples = run.samples ?? [];
    if (samples.length < MIN_SAMPLES) {
      failures.push(`${name}: ${String(samples.length)} samples, at least ${String(MIN_SAMPLES)} are required`);
    }
    const thin = samples.filter((sample) => !(sample.visibleItems >= MIN_VISIBLE));
    if (thin.length > 0) {
      failures.push(
        `${name}: ${String(thin.length)} samples show fewer than ${String(MIN_VISIBLE)} items — the pan ran out of data, the measurement is invalid`,
      );
    }
  }

  if (pooled !== undefined && (pooled.samples ?? []).length >= MIN_SAMPLES) {
    const samples = pooled.samples;
    const third = Math.floor(samples.length / 3);
    const late = lateCreation(samples);
    const lateLine =
      `${String(late.created)} new nodes in the second half (with ${String(late.live)} live, ` +
      `label nodes grew by ${String(late.labelGrowth)})`;
    if (!late.labelsKnown) {
      failures.push("pool: the samples do not report the live label nodes (labelNodes) — what cannot be measured is a FAILURE");
    } else if (late.created > late.live * MAX_LATE_CREATION_SHARE + late.labelGrowth) {
      failures.push(`pool: ${lateLine} — the pool does not recycle`);
    } else {
      notes.push(`pool: ${lateLine}`);
    }
    if (!samples.every((sample) => Number.isInteger(sample.labelNodes) && Number.isInteger(sample.labelTree))) {
      failures.push("pool: the samples do not report the label nodes (labelNodes, labelTree) — what cannot be measured is a FAILURE");
    }
    const domEarly = max(samples.slice(0, third).map((sample) => sample.domNodes - sample.labelNodes));
    const domLate = max(samples.slice(-third).map((sample) => sample.domNodes - sample.labelNodes));
    if (domLate > domEarly * MAX_DOM_GROWTH) {
      failures.push(`pool: the live DOM (without labels) ${String(domEarly)} -> ${String(domLate)} — it grows with distance`);
    } else {
      notes.push(`pool: live DOM (without labels) first third max ${String(domEarly)}, last third max ${String(domLate)}`);
    }
    const cdpEarly = max(samples.slice(0, third).map((sample) => sample.cdpNodes - sample.labelTree));
    const cdpLate = max(samples.slice(-third).map((sample) => sample.cdpNodes - sample.labelTree));
    if (!(cdpLate <= cdpEarly * MAX_CDP_GROWTH)) {
      failures.push(`pool: CDP Nodes (without labels) ${String(cdpEarly)} -> ${String(cdpLate)} — it grows according to the browser`);
    } else {
      notes.push(`pool: CDP Nodes (after GC, without labels) ${String(cdpEarly)} -> ${String(cdpLate)}`);
    }
    const last = samples[samples.length - 1];
    if (control !== undefined && (control.samples ?? []).length >= MIN_SAMPLES) {
      const controlLate = lateCreation(control.samples);
      const reuseLine =
        `${String(late.reused)} reuses in the second half, while the control created ` +
        `${String(controlLate.created)} nodes at the same point`;
      if (!(late.reused >= controlLate.created * MIN_REUSE_OF_CONTROL_CREATION)) {
        failures.push(`pool: ${reuseLine} — the pool does not supply what the control has to create`);
      } else {
        notes.push(`pool: ${reuseLine}`);
      }
    }
    notes.push(`pool: ${String(last.reused)} reuses, ${String(last.created)} creations in total (report only)`);
    notes.push(
      `JS heap (after GC, report only): ${(samples[0].jsHeapUsed / 1e6).toFixed(1)} -> ${(last.jsHeapUsed / 1e6).toFixed(1)} MB`,
    );
  }

  if (control !== undefined && (control.samples ?? []).length >= MIN_SAMPLES) {
    const late = lateCreation(control.samples);
    if (late.created < late.live * MIN_CONTROL_CREATION_SHARE) {
      failures.push(
        `the negative control created only ${String(late.created)} nodes even without a pool — the measurement cannot see the pool's effect`,
      );
    } else {
      notes.push(`negative control: ${String(late.created)} new nodes in the second half without a pool, as it should be`);
    }
  }
}

for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const failure of failures) {
  console.log(`  FAIL  ${failure}`);
}
if (failures.length > 0) {
  console.log(`memory: FAILED (${String(failures.length)} failure(s))`);
  process.exit(1);
}
console.log("memory: passed");
