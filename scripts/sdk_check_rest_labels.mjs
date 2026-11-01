#!/usr/bin/env node
/**
 * G-REST-LABELS: bizonyitja, hogy nyugalomban az elemterben minden cimke
 * latszik, amit a pontos kepkocka megtart — generalt adaton, mindket
 * orientacioban.
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. A PROPERTY: a riportban a "rest labels match the exact frame" zold,
 *     seeddel, legalabb MIN_CASES esettel. A riport hianya BUKAS: a
 *     csomagparancs elotte torli, tehat a jelenlete azt jelenti, hogy MOST
 *     futott.
 *  2. A KONTROLL: ugyanazokon az eseteken a gesztus alatti kepkocka — ugyanazok
 *     a csempek, a nyugalmi potlas nelkul — legalabb egy esetben elveszit
 *     egy cimket, amit a pontos kepkocka megtart. Ha nem veszitene, a
 *     property a potlas nelkul is atmenne, es semmit nem bizonyitana rola.
 *     Es az esetekben osszesen legalabb MIN_LABELS pontos cimke van: egy
 *     property, ami cimke nelkuli eseteken fut, uresen igaz.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-rest-labels.json");
const controlFile = join(corePackage, ".rest-labels-control.json");
const PROPERTY = "rest labels match the exact frame";
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
  if (!(control.exactLabels >= MIN_LABELS)) {
    failures.push(`az esetekben csak ${String(control.exactLabels)} pontos cimke van, legalabb ${String(MIN_LABELS)} kell`);
  }
  if (!(control.missedDuringGesture > 0)) {
    failures.push("a kontroll NEM bukik: a csempek cimkei a potlas nelkul is mindent megmutatnak — a property a potlasrol semmit nem bizonyit");
  } else {
    notes.push(
      `kontroll: a gesztus alatti kepkocka ${String(control.missedDuringGesture)} / ${String(control.exactLabels)} pontos cimket nem mutat ` +
        `(${String(control.casesMissing)} / ${String(control.cases)} esetben) — a nyugalmi potlas nelkul a property bukna`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-REST-LABELS: atment" : "G-REST-LABELS: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
