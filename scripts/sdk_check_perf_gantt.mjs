#!/usr/bin/env node
/**
 * G-PERF-GANTT (P20): 10 000 feladat es 10 000 fuggoseg mellett a
 * pasztazas es a gorgos zoom a G-PERF kuszobein belul van (<= 5% kihagyott
 * vsync, <= 100 ms leghosszabb kepkocka, harom friss lap medianjaval) — es
 * nyil-culling nelkul (`gantt.cull: false`, negativ kontroll) BUKIK: a
 * pasztazas vagy a zoom a kuszob folott van.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *   - a riport letezik, `gantt`, 4x lassitassal, mindket valtozatban
 *     legalabb harom futassal, friss core- es element-disttel;
 *   - a lap 10 000 feladatot es 10 000 fuggoseget rajzol, es a culled
 *     valtozat tenyleg cullingolt (`cull: true`), a kontroll nem;
 *   - a culled lapon latszik nyil (> 0), a kontrollban legalabb 10 000 —
 *     kulonben a kontroll nem azt meri, amit allit;
 *   - a huzasok tenyleg mozgattak a nezetet, semmit nem szerkesztettek, es a
 *     zoom tenyleg nagyitott (csucs >= 3x).
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
  `median ${(median(runs.map((run) => run.missedShare)) * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${median(runs.map((run) => run.longestFrameMs)).toFixed(0)} ms (futasok: ${runs.map((run) => `${(run.missedShare * 100).toFixed(1)}%`).join(" ")})`;

if (!existsSync(reportFile)) {
  failures.push(`hianyzik: ${reportFile} — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "gantt") failures.push(`a riport nem a Gantt-meres (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`a lassitas ${String(report.throttle)}x, nem 4x`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`elavult dist (${JSON.stringify(report.fresh)}) — regi kodot merne`);
  for (const name of ["culled", "control"]) {
    const { pan = [], zoom = [] } = report.runs?.[name] ?? {};
    if (pan.length < MIN_REPS || zoom.length < MIN_REPS) failures.push(`${name}: ${String(pan.length)}/${String(zoom.length)} futas, legalabb ${String(MIN_REPS)} kell — a nem futtathato meres BUKAS`);
    pan.forEach((run, index) => {
      const at = `${name} pasztazas #${String(index + 1)}`;
      if (run.tasks !== 10_000 || run.dependencies !== 10_000) failures.push(`${at}: ${String(run.tasks)} feladat, ${String(run.dependencies)} fuggoseg — 10 000 / 10 000 kell`);
      if (run.cull !== (name === "culled")) failures.push(`${at}: a lap cull=${String(run.cull)}, a valtozat ${name}`);
      if (name === "culled" && !(run.counts.arrows > 0)) failures.push(`${at}: egyetlen nyil sincs a lapon — a meres ures`);
      if (name === "control" && !(run.counts.arrows >= 10_000)) failures.push(`${at}: a kontroll ${String(run.counts.arrows)} nyilat rajzol, 10 000 kell — nem azt meri, amit allit`);
      if (!(Math.abs(run.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`${at}: 12 huzas ${run.midPx.toFixed(0)} px-et mozgatott, ~${String(TARGET_PX)} kell`);
      if (run.edits !== 0) failures.push(`${at}: a pasztazas ${String(run.edits)} elemet szerkesztett`);
    });
    zoom.forEach((run, index) => {
      if (!(run.peakFactor >= 3)) failures.push(`${name} zoom #${String(index + 1)}: a csucs ${run.peakFactor.toFixed(2)}x, legalabb 3x kell`);
      if (run.edits !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.edits)} szerkesztes`);
    });
  }
  const culled = report.runs?.culled ?? {};
  const control = report.runs?.control ?? {};
  if ((culled.pan?.length ?? 0) > 0 && (culled.zoom?.length ?? 0) > 0) {
    for (const [what, runs] of [["pasztazas", culled.pan], ["zoom", culled.zoom]]) {
      if (within(runs)) notes.push(`${what}: ${say(runs)}`);
      else failures.push(`${what}: ${say(runs)} — a kuszob 5% es 100 ms`);
    }
  }
  if ((control.pan?.length ?? 0) > 0 && (control.zoom?.length ?? 0) > 0) {
    if (within(control.pan) && within(control.zoom)) {
      failures.push(`a negativ kontroll (culling nelkul) NEM bukik: pasztazas ${say(control.pan)}, zoom ${say(control.zoom)} — a meres nem latja, amit a culling megsporol`);
    } else {
      notes.push(`kontroll (culling nelkul) bukik, ahogy kell: pasztazas ${say(control.pan)}; zoom ${say(control.zoom)}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PERF-GANTT: atment" : "G-PERF-GANTT: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
