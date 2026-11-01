#!/usr/bin/env node
/**
 * G-ZOOM-LABELS: bizonyitja, hogy egy cimke, ami a zoom elott es utan is
 * latszik, a zoom egyetlen kepkockajan sem hianyzik — generalt, monoton
 * zoom-gesztusokon, a README ciklusaval hajtva (lepcsos ujrahorgonyzas,
 * pendingTiles-ig ujrarajzolas, nyugalomban a rahagyas kiteljesedeseig).
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. A PROPERTY: a riportban a "zoom keeps the labels on both ends" zold,
 *     seeddel, legalabb MIN_CASES esettel. A riport hianya BUKAS: a
 *     csomagparancs elotte torli, tehat a jelenlete azt jelenti, hogy MOST
 *     futott.
 *  2. A KONTROLL: ugyanazok az esetek az 1.0.0-rc.4 modjan rajzolva — a
 *     gesztus minden kepkockaja `bare`: az uj csempek cimke nelkul, a szelek
 *     cimkeje nincs kituzve — legalabb egy, az elejen es a vegen is latszo
 *     cimket elveszitenek. Ha nem, a property a valtoztatas nelkul is
 *     atmenne, es semmit nem bizonyitana rola. Es az esetekben osszesen
 *     legalabb MIN_LABELS ilyen cimke van: egy property, ami cimke nelkuli
 *     eseteken fut, uresen igaz.
 *
 * Miert csak monoton zoom (a tesztfajl fejkommentje reszletesen): minden
 * cimke a sajat elemenek helyen el, es ez a hely egy monoton zoom alatt
 * sosem kisebb kozben, mint a ket vegen; oda-vissza zoomnal egy cimke kozben
 * joggal nem ferhet el. A maxLabels-plafon es a furtozes nincs lefedve.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-zoom-labels.json");
const controlFile = join(corePackage, ".zoom-labels-control.json");
const PROPERTY = "zoom keeps the labels on both ends";
const MIN_CASES = 500;
const MIN_LABELS = 1000;

const failures = [];
const notes = [];
const read = (file) => {
  if (!existsSync(file)) {
    failures.push(`hianyzik: ${file} — a keszlet NEM futott le, ezert BUKAS`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`olvashatatlan: ${file}: ${String(error)}`);
    return undefined;
  }
};

const report = read(reportFile);
if (report !== undefined) {
  const entry = Array.isArray(report) ? report.find((candidate) => candidate?.name === PROPERTY) : undefined;
  if (entry === undefined) {
    failures.push(`a property hianyzik a riportbol: "${PROPERTY}"`);
  } else {
    if (entry.passed !== true) failures.push(`bukott: ${PROPERTY} — ${JSON.stringify(entry.counterexample ?? null)}`);
    if (!Number.isInteger(entry.cases) || entry.cases < MIN_CASES) {
      failures.push(`${PROPERTY}: ${String(entry.cases)} eset, de legalabb ${String(MIN_CASES)} kell`);
    }
    if (!Number.isFinite(entry.seed)) failures.push(`${PROPERTY}: nincs seed`);
    if (entry.passed === true) notes.push(`${PROPERTY}: ${String(entry.cases)} eset, seed ${String(entry.seed)}`);
  }
}

const control = read(controlFile);
if (control !== undefined) {
  if (!(control.cases >= MIN_CASES)) {
    failures.push(`a kontroll csak ${String(control.cases)} esetet futott, legalabb ${String(MIN_CASES)} kell`);
  }
  if (!(control.labelsBeforeAndAfter >= MIN_LABELS)) {
    failures.push(`az esetekben csak ${String(control.labelsBeforeAndAfter)} cimke latszik elotte es utana, legalabb ${String(MIN_LABELS)} kell`);
  }
  if (!(control.lostByOld > 0)) {
    failures.push("a kontroll NEM bukik: az rc.4-es mod is minden cimket megtart — a property a valtoztatasrol semmit nem bizonyit");
  } else {
    notes.push(
      `kontroll: az rc.4-es mod ${String(control.lostByOld)} / ${String(control.labelsBeforeAndAfter)} elotte-utana latszo cimket elveszit ` +
        `(${String(control.casesLostByOld)} / ${String(control.cases)} esetben, ${String(control.gestureFrames)} gesztus-kepkockan)`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-ZOOM-LABELS: atment" : "G-ZOOM-LABELS: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
