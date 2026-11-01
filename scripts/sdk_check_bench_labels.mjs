#!/usr/bin/env node
/**
 * G-BENCH-LABELS (P17): bizonyitja, hogy a vis-osszevetes 10 000 elemes
 * lapjan a pasztazas es a gorgos zoom a G-PERF kuszobein belul marad
 * (<= 5% kihagyott vsync, <= 100 ms leghosszabb kepkocka), es hogy ugyanazon
 * a lapon, valodi gorgovel a surusegi hatarig (a core SHORTEN_DENSITY_LIMIT-je,
 * 1000 elem egy nezetszelessegen) nagyitva nyugalomban a lathato elemek
 * legalabb fele cimket visel — harom friss lap mediánjaval.
 *
 * Miert a hataron, es nem a 10 000 elemes nezetben (P17, 2. kor utan, a
 * tulajdonos "cel" dontese): a 10 000 elemes nezetben ~2000 elem jut 1440 px-re,
 * elemenkent ~0,7 px. Ott minden roviditett cimke "Ite…" lenne — nem
 * kulonbozteti meg az elemeket —, es a 2. kor raszteres cimkereteg-kiserlete
 * (sdk/p17-raszter-wip) a zoomot 16,9%-ra rontotta. A cimke-allitas igy oda
 * szol, ahol a cimke olvashato; a 10 000 elemes nezet a teljesitmenyt
 * bizonyitja. A suru nezet cimkeit a check kiirja, de nem itel rajtuk.
 *
 * A "lathato elem" a bongeszo szerint lathato rect.tl-item; a "cimket
 * visel", ha van .tl-label csomopontja (data-tl-label = az elem), ami szinten
 * lathato. A P15-ben (1.0.0-rc.4-ig) itt 0 cimke volt.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *   - a riport letezik, `labels`, 4x lassitassal, 10 000 elemmel, legalabb
 *     harom pasztazo es harom zoom-futassal, friss core- es element-disttel;
 *   - a nezetben 1900-2200 elem latszik (a kozolt benchmark nezete);
 *   - a huzas mozgatta a nezetet, a zoom 4x fole ert es visszajott, semmi
 *     nem szerkesztett elemet;
 *   - a hataron a nezetben legfeljebb SHORTEN_DENSITY_LIMIT, de legalabb a
 *     fele elem latszik (a hatar kozeleben merunk, nem egy konnyu, mely
 *     nagyitasban), a nagyitas tenyleg megtortent, es a lefedettseg
 *     nyugalomban, ket egyezo olvasattal allt be.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SHORTEN_DENSITY_LIMIT } from "../packages/core/dist/index.mjs";

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
  failures.push(`hianyzik: ${reportFile} — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const pans = report.panRuns ?? [];
  const zooms = report.zoomRuns ?? [];
  if (report.kind !== "labels") failures.push(`a riport nem a labels merese (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`a lassitas ${String(report.throttle)}x, nem 4x`);
  if (report.items !== 10_000) failures.push(`${String(report.items)} elem, nem 10 000`);
  if (pans.length < MIN_REPS || zooms.length < MIN_REPS) failures.push(`${String(pans.length)} pasztazo / ${String(zooms.length)} zoom-futas, legalabb ${String(MIN_REPS)}-${String(MIN_REPS)} kell — a nem futtathato meres BUKAS`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`elavult dist (${JSON.stringify(report.fresh)})`);
  pans.forEach((run, index) => {
    if (!(run.atRest.visibleItems >= VISIBLE[0] && run.atRest.visibleItems <= VISIBLE[1])) failures.push(`#${String(index + 1)}: ${String(run.atRest.visibleItems)} lathato elem, ${String(VISIBLE[0])}-${String(VISIBLE[1])} kell`);
    if (!(Math.abs(run.pan.midPx - TARGET_PX) <= 0.25 * TARGET_PX) || !(Math.abs(run.pan.endPx) <= 60)) failures.push(`#${String(index + 1)}: a huzas nem a vart utat tette meg (${run.pan.midPx.toFixed(0)} / ${run.pan.endPx.toFixed(0)} px)`);
    if (run.edits !== 0) failures.push(`#${String(index + 1)}: a pasztazas szerkesztett`);
  });
  if (report.densityLimit !== SHORTEN_DENSITY_LIMIT) failures.push(`a meres ${String(report.densityLimit)} elemes hatarral futott, a core-ban ${String(SHORTEN_DENSITY_LIMIT)}`);
  zooms.forEach((run, index) => {
    if (!(run.peakFactor >= 4) || !(run.finalFactor > 0.8 && run.finalFactor < 1.25)) failures.push(`zoom #${String(index + 1)}: csucs ${run.peakFactor.toFixed(2)}x, vege ${run.finalFactor.toFixed(2)}x`);
    if (run.edits !== 0) failures.push(`zoom #${String(index + 1)}: a zoom szerkesztett`);
    const limit = run.atLimit;
    if (limit === undefined) {
      failures.push(`zoom #${String(index + 1)}: nincs hatar-meres — a nem futtathato meres BUKAS`);
      return;
    }
    if (!(limit.visibleItems <= SHORTEN_DENSITY_LIMIT && limit.visibleItems >= SHORTEN_DENSITY_LIMIT / 2)) failures.push(`zoom #${String(index + 1)}: a hataron ${String(limit.visibleItems)} lathato elem, ${String(SHORTEN_DENSITY_LIMIT / 2)}-${String(SHORTEN_DENSITY_LIMIT)} kell`);
    if (!(limit.notches >= 1) || !(limit.factor > 1.2)) failures.push(`zoom #${String(index + 1)}: a hatarra nagyitas nem tortent meg (${String(limit.notches)} lepes, ${limit.factor.toFixed(2)}x)`);
    if (limit.unsettled || run.dense?.unsettled) failures.push(`zoom #${String(index + 1)}: a cimke-lefedettseg nem allt be nyugalomra`);
  });
  if (zooms.length > 0 && zooms.every((run) => run.atLimit !== undefined)) {
    const share = median(zooms.map((run) => run.atLimit.labelledItems / run.atLimit.visibleItems));
    const all = zooms.map((run) => `${String(run.atLimit.labelledItems)}/${String(run.atLimit.visibleItems)} @${run.atLimit.factor.toFixed(2)}x`).join(" ");
    if (!(share >= MIN_LABELLED_SHARE)) failures.push(`a surusegi hataron nyugalomban a lathato elemek ${(share * 100).toFixed(1)}%-a visel cimket, legalabb 50% kell (futasok: ${all})`);
    else notes.push(`a surusegi hataron nyugalomban a lathato elemek ${(share * 100).toFixed(1)}%-a visel cimket (futasok: ${all})`);
  }
  if (pans.length > 0) {
    const share = median(pans.map((run) => run.atRest.labelledItems / run.atRest.visibleItems));
    const all = pans.map((run) => `${String(run.atRest.labelledItems)}/${String(run.atRest.visibleItems)}`).join(" ");
    notes.push(`(nem itelet) a 10 000 elemes nezetben, a hatar folott ${(share * 100).toFixed(1)}% cimkes (futasok: ${all})`);
  }
  for (const [name, runs] of [["pasztazas", pans.map((run) => run.pan)], ["gorgos zoom", zooms]]) {
    if (runs.length === 0) continue;
    const missed = median(runs.map((run) => run.missedShare));
    const longest = median(runs.map((run) => run.longestFrameMs));
    const all = runs.map((run) => `${(run.missedShare * 100).toFixed(1)}%`).join(" ");
    if (!(missed <= MAX_MISSED_SHARE) || !(longest <= MAX_LONGEST_FRAME_MS)) {
      failures.push(`${name}: median ${(missed * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${longest.toFixed(0)} ms — kuszob 5% / 100 ms (futasok: ${all})`);
    } else {
      notes.push(`${name}: median ${(missed * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${longest.toFixed(0)} ms (futasok: ${all})`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-BENCH-LABELS: atment" : "G-BENCH-LABELS: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
