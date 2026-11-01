#!/usr/bin/env node
/**
 * G-NARROW-LABELS: bizonyitja, hogy minden elem, amelynel a roviditett
 * felirat (legalabb 3 karakter es ellipszis) az elem lathato reszeben vagy az
 * utana kovetkezo szabad helyen elfer, kap cimket — generalt, suru adaton,
 * mindket orientacioban, a pontos kepkockan ES a nyugalmi elemterben; a
 * latszo cimkek nem fednek at, egyik sem kerul masik elemre, a szoveg az elem
 * sajat szovege (egeszben vagy az eleje ellipszissel), es a teljes szoveg az
 * elem akadalymentes neveben van.
 *
 * Az "elfer" orakulum a layoutbol szamol, nem az elhelyezesbol (a tesztfajl
 * fejkommentje reszletesen).
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. A PROPERTY: a riportban a "narrow items get a label" zold, seeddel,
 *     legalabb MIN_CASES esettel. A riport hianya BUKAS: a csomagparancs
 *     elotte torli, tehat a jelenlete azt jelenti, hogy MOST futott.
 *  2. A KONTROLL: ugyanazok az esetek a P15-os strategiaval (labelOverflow:
 *     "drop") az esetek TOBBSEGEBEN legalabb egy olyan elemet cimke nelkul
 *     hagynak, amelynek az orakulum szerint jar — kulonben az adat tul ritka,
 *     es a property a rovidites nelkul is atmenne. Es az esetekben osszesen
 *     legalabb MIN_REQUIRED ilyen elem van.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-narrow-labels.json");
const controlFile = join(corePackage, ".narrow-labels-control.json");
const PROPERTY = "narrow items get a label";
const MIN_CASES = 500;
const MIN_REQUIRED = 1000;

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
  if (!(control.required >= MIN_REQUIRED)) {
    failures.push(`az esetekben csak ${String(control.required)} cimkere jogosult elem van, legalabb ${String(MIN_REQUIRED)} kell`);
  }
  if (!(control.casesMissedByDrop > control.cases / 2)) {
    failures.push(
      `a kontroll NEM bukik az esetek tobbsegeben: a P15-os strategia csak ${String(control.casesMissedByDrop)} / ${String(control.cases)} esetben hagy cimkere jogosult elemet cimke nelkul`,
    );
  } else {
    notes.push(
      `kontroll: a P15-os strategia (drop) ${String(control.casesMissedByDrop)} / ${String(control.cases)} esetben hagy cimkere jogosult elemet cimke nelkul ` +
        `(${String(control.missedByDrop)} / ${String(control.required)} elem); a roviditett cimkek szama ${String(control.shortened)}`,
    );
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-NARROW-LABELS: atment" : "G-NARROW-LABELS: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
