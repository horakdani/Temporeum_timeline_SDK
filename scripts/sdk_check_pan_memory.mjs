#!/usr/bin/env node
/**
 * G-PAN-MEMORY (P17): bizonyitja, hogy a vis-osszevetes pasztazasa 10 000
 * elemnel a heap-novekedest a P15-os mert ertek (+10,4 MB) legfeljebb felere
 * szoritja, harom friss lap mediánjaval, es hogy a pasztazas kozben a G-PERF
 * kuszobein belul marad (<= 5% kihagyott vsync, <= 100 ms leghosszabb
 * kepkocka, mediánnal).
 *
 * A P15-os ertek a publikalt benchmark-futasbol (1.0.0-rc.3): heap a betoltes
 * utan 9,1 MB, a pasztazas utan 19,5 MB.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *   - a riport letezik, `pan-memory`, 4x lassitassal, 10 000 elemmel,
 *     legalabb harom futassal, friss core- es element-disttel;
 *   - minden futasban a huzas tenyleg mozgatta a nezetet (+2880 px +-25%,
 *     vissza egy huzason belulre), es semmit nem szerkesztett;
 *   - minden futasban a pasztazas utan TOBB elem-csomopont van, mint a
 *     betoltes utan: a rahagyas tenyleg kirajzolodott, tehat a mert novekedes
 *     az, amirol a check szol, nem egy meg ures lap.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-pan-memory.json");
const P15_GROWTH = 10.4e6;
const MAX_GROWTH = P15_GROWTH / 2;
const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MIN_REPS = 3;
const TARGET_PX = 12 * 240;

const failures = [];
const notes = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (!existsSync(reportFile)) {
  failures.push(`hianyzik: ${reportFile} — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const runs = report.panRuns ?? [];
  if (report.kind !== "pan-memory") failures.push(`a riport nem a pan-memory merese (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`a lassitas ${String(report.throttle)}x, nem 4x`);
  if (report.items !== 10_000) failures.push(`${String(report.items)} elem, nem 10 000`);
  if (runs.length < MIN_REPS) failures.push(`${String(runs.length)} futas, legalabb ${String(MIN_REPS)} kell — a nem futtathato meres BUKAS`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`elavult dist (${JSON.stringify(report.fresh)}) — regi kodot merne`);
  runs.forEach((run, index) => {
    if (!(Math.abs(run.pan.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`#${String(index + 1)}: 12 huzas ${run.pan.midPx.toFixed(0)} px-et mozgatott, ~${String(TARGET_PX)} kell`);
    if (!(Math.abs(run.pan.endPx) <= 0.25 * 240)) failures.push(`#${String(index + 1)}: 24 huzas utan ${run.pan.endPx.toFixed(0)} px-re a kezdettol`);
    if (run.edits !== 0) failures.push(`#${String(index + 1)}: a pasztazas ${String(run.edits)} elemet szerkesztett`);
    if (!(run.itemNodesAfterPan > run.itemNodesAfterLoad)) {
      failures.push(`#${String(index + 1)}: a pasztazas utan nincs tobb elem-csomopont (${String(run.itemNodesAfterLoad)} -> ${String(run.itemNodesAfterPan)}) — a rahagyas nem rajzolodott ki, a meres ures`);
    }
  });
  if (runs.length > 0) {
    const growth = median(runs.map((run) => run.heapGrowth));
    const missed = median(runs.map((run) => run.pan.missedShare));
    const longest = median(runs.map((run) => run.pan.longestFrameMs));
    const all = runs.map((run) => `+${(run.heapGrowth / 1e6).toFixed(2)}`).join(" ");
    if (!(growth <= MAX_GROWTH)) failures.push(`heap-novekedes median +${(growth / 1e6).toFixed(2)} MB > ${(MAX_GROWTH / 1e6).toFixed(1)} MB (futasok: ${all} MB)`);
    else notes.push(`heap-novekedes median +${(growth / 1e6).toFixed(2)} MB <= ${(MAX_GROWTH / 1e6).toFixed(1)} MB, a P15-os +10,4 MB fele (futasok: ${all} MB)`);
    if (!(missed <= MAX_MISSED_SHARE)) failures.push(`pasztazas: median ${(missed * 100).toFixed(1)}% kihagyott vsync > 5%`);
    if (!(longest <= MAX_LONGEST_FRAME_MS)) failures.push(`pasztazas: median leghosszabb kepkocka ${longest.toFixed(0)} ms > 100 ms`);
    if (missed <= MAX_MISSED_SHARE && longest <= MAX_LONGEST_FRAME_MS) {
      notes.push(`pasztazas: median ${(missed * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${longest.toFixed(0)} ms (futasok: ${runs.map((run) => `${(run.pan.missedShare * 100).toFixed(1)}%`).join(" ")})`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PAN-MEMORY: atment" : "G-PAN-MEMORY: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
