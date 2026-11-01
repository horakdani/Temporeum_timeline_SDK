#!/usr/bin/env node
/**
 * G-PERF-RESOURCES (P22): 500 eroforras es 10 000 hozzarendeles mellett,
 * terhelesi savokkal, a pasztazas es a gorgos zoom a G-PERF kuszobein belul
 * van (<= 5% kihagyott vsync, <= 100 ms leghosszabb kepkocka, harom friss lap
 * medianjaval) — es az erzekenysegi kontroll (`?burn=24`: minden kepkocka
 * egy gesztus alatt, masfel vsync-nyi plusz munka) BUKIK: a pasztazas
 * ES a zoom is a kuszob folott van. Kulonben a meres vak ezen a lapon.
 *
 * A P22 kapujaig a negativ kontroll a vagas nelkuli rajz volt
 * (`resourceOptions.cull: false`). Az nem bukott: 10 000 szakasz negy
 * utvonalba fuzve, minden kepkockan ujraepitve is 0,0% kihagyott vsync 4x
 * lassitassal. A felteves — vagas nelkul a reteg draga — ezen a mereten
 * hamis (mint a P17 flat kontrollje); a tulajdonos dontese (2026-10-29, „1”):
 * a kontroll azt allitja, amit bizonyitani kell — a meres nem vak —, a vagas
 * nelkuli rajz pedig jegyzet.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *   - a riport letezik, `resources`, 4x lassitassal, mindket valtozatban
 *     legalabb harom futassal, friss core- es element-disttel;
 *   - a lap 500 eroforrast es 10 000 hozzarendelest rajzol, es a culled
 *     valtozat tenyleg vagott (`cull: true`), a kontroll nem;
 *   - a culled lapon latszik terhelesi oszlop es tulfoglalas (> 0), a
 *     vagas nelkuliben legalabb 10 000 oszlop (minden eroforras minden
 *     szakasza) — kulonben a jegyzet nem azt meri, amit allit;
 *   - az erzekenysegi kontroll ugyanazt rajzolja, mint a culled lap (vagva,
 *     ugyanannyi oszlop), egyetlen kulonbsege a `burn`, es a plusz munka
 *     tenyleg lefutott (pasztazaskor >= 100, zoomnal >= 10 kepkockaban; a
 *     tobbi lapon egyszer sem) — kulonben nem a meres erzekenyseget meri;
 *   - a huzasok tenyleg mozgattak a nezetet, semmit nem szerkesztettek, es a
 *     zoom tenyleg nagyitott (csucs >= 3x).
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
  `median ${(median(runs.map((run) => run.missedShare)) * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${median(runs.map((run) => run.longestFrameMs)).toFixed(0)} ms (futasok: ${runs.map((run) => `${(run.missedShare * 100).toFixed(1)}%`).join(" ")})`;

if (!existsSync(reportFile)) {
  failures.push(`hianyzik: ${reportFile} — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "resources") failures.push(`a riport nem az eroforras-meres (${String(report.kind)})`);
  if (report.throttle !== 4) failures.push(`a lassitas ${String(report.throttle)}x, nem 4x`);
  if (report.fresh?.core !== true || report.fresh?.element !== true) failures.push(`elavult dist (${JSON.stringify(report.fresh)}) — regi kodot merne`);
  if (report.burnMs !== BURN_MS) failures.push(`az erzekenysegi kontroll ${String(report.burnMs)} ms-ot eget, ${String(BURN_MS)} kell`);
  for (const name of VARIANTS) {
    const { pan = [], zoom = [] } = report.runs?.[name] ?? {};
    if (pan.length < MIN_REPS || zoom.length < MIN_REPS) failures.push(`${name}: ${String(pan.length)}/${String(zoom.length)} futas, legalabb ${String(MIN_REPS)} kell — a nem futtathato meres BUKAS`);
    pan.forEach((run, index) => {
      const at = `${name} pasztazas #${String(index + 1)}`;
      if (run.resources !== 500 || run.assignments !== 10_000) failures.push(`${at}: ${String(run.resources)} eroforras, ${String(run.assignments)} hozzarendeles — 500 / 10 000 kell`);
      if (run.cull !== (name !== "control")) failures.push(`${at}: a lap cull=${String(run.cull)}, a valtozat ${name}`);
      if (run.burn !== (name === "sensitivity" ? BURN_MS : 0)) failures.push(`${at}: a lap burn=${String(run.burn)}, a valtozat ${name}`);
      if (name === "sensitivity" ? !(run.burned >= 100) : run.burned !== 0) failures.push(`${at}: ${String(run.burned)} kepkocka vegezte a plusz munkat — a kontrollban legalabb 100 kell, mashol 0`);
      const twin = report.runs?.culled?.pan?.[index];
      if (name === "sensitivity" && twin !== undefined && JSON.stringify(run.counts) !== JSON.stringify(twin.counts)) {
        failures.push(`${at}: ${JSON.stringify(run.counts)} a lapon, a culled ${JSON.stringify(twin.counts)} — nem ugyanazt rajzolja`);
      }
      if (name === "culled" && !(run.counts.bars > 0 && run.counts.overloads > 0)) failures.push(`${at}: ${String(run.counts.bars)} terhelesi oszlop, ${String(run.counts.overloads)} tulfoglalas a lapon — a meres ures`);
      if (name === "control" && !(run.counts.bars >= 10_000)) failures.push(`${at}: a kontroll ${String(run.counts.bars)} oszlopot rajzol, 10 000 kell — nem azt meri, amit allit`);
      if (!(Math.abs(run.midPx - TARGET_PX) <= 0.25 * TARGET_PX)) failures.push(`${at}: 12 huzas ${run.midPx.toFixed(0)} px-et mozgatott, ~${String(TARGET_PX)} kell`);
      if (run.edits !== 0) failures.push(`${at}: a pasztazas ${String(run.edits)} elemet szerkesztett`);
    });
    zoom.forEach((run, index) => {
      if (!(run.peakFactor >= 3)) failures.push(`${name} zoom #${String(index + 1)}: a csucs ${run.peakFactor.toFixed(2)}x, legalabb 3x kell`);
      if (run.cull !== (name !== "control") || run.burn !== (name === "sensitivity" ? BURN_MS : 0)) failures.push(`${name} zoom #${String(index + 1)}: a lap cull=${String(run.cull)}, burn=${String(run.burn)}`);
      if (name === "sensitivity" ? !(run.burned >= 10) : run.burned !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.burned)} kepkocka vegezte a plusz munkat — a kontrollban legalabb 10 kell, mashol 0`);
      if (run.edits !== 0) failures.push(`${name} zoom #${String(index + 1)}: ${String(run.edits)} szerkesztes`);
    });
  }
  const culled = report.runs?.culled ?? {};
  const control = report.runs?.control ?? {};
  const sensitivity = report.runs?.sensitivity ?? {};
  if ((culled.pan?.length ?? 0) > 0 && (culled.zoom?.length ?? 0) > 0) {
    for (const [what, runs] of [["pasztazas", culled.pan], ["zoom", culled.zoom]]) {
      if (within(runs)) notes.push(`${what}: ${say(runs)}`);
      else failures.push(`${what}: ${say(runs)} — a kuszob 5% es 100 ms`);
    }
  }
  if ((sensitivity.pan?.length ?? 0) > 0 && (sensitivity.zoom?.length ?? 0) > 0) {
    // Mindket mozdulaton buknia kell: kulonben az egyik meres vak, es a zoldje semmit nem mond.
    if (within(sensitivity.pan) || within(sensitivity.zoom)) {
      failures.push(`az erzekenysegi kontroll (+${String(BURN_MS)} ms kepkockankent) NEM bukik mindket mozdulaton: pasztazas ${say(sensitivity.pan)}, zoom ${say(sensitivity.zoom)} — a meres vak ezen a lapon`);
    } else {
      notes.push(`erzekenysegi kontroll (+${String(BURN_MS)} ms kepkockankent) bukik, ahogy kell: pasztazas ${say(sensitivity.pan)}; zoom ${say(sensitivity.zoom)}`);
    }
  }
  if ((control.pan?.length ?? 0) > 0 && (control.zoom?.length ?? 0) > 0) {
    // Jegyzet, nem itelet: a vagas ezen a mereten nem teherhordo.
    notes.push(`jegyzet — vagas nelkul (minden kepkockan minden terheles): pasztazas ${say(control.pan)}; zoom ${say(control.zoom)}`);
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PERF-RESOURCES: atment" : "G-PERF-RESOURCES: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
