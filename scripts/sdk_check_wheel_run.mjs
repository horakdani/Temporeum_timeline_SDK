#!/usr/bin/env node
/**
 * G-WHEEL-RUN (P15): bizonyitja, hogy a gorgo-lepesek sorozata a gepben EGY
 * gesztus — generalt sorozatokon, a bongeszo-kotes egyetlen ebreszto-
 * idoziotojevel, ahogy az attachInput is hajtja.
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. A PROPERTY: a riportban az "a wheel run is one gesture" zold, seeddel,
 *     legalabb MIN_CASES esettel. A riport hianya BUKAS: a csomagparancs
 *     elotte torli, tehat a jelenlete azt jelenti, hogy MOST futott.
 *  2. A KONTROLL: ugyanazokon az eseteken legalabb MIN_RESTS olyan lepes van,
 *     amely egy mar nyitott sorozatot folytat — a sorozat nelkul a hoszt
 *     ott nyugalomban lett volna, es a property a sorozatrol semmit nem
 *     bizonyitana —, es legalabb MIN_STILL olyan, amely semmit nem mozditott
 *     el (a hatarnal): a "nem nyit sorozatot" allitas nem uresen igaz.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "core");
const reportFile = join(corePackage, ".property-report-wheel-run.json");
const controlFile = join(corePackage, ".wheel-run-control.json");
const PROPERTY = "a wheel run is one gesture";
const MIN_CASES = 500;
const MIN_RESTS = 1000;
const MIN_STILL = 100;

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
  if (!(control.restsInsideARun >= MIN_RESTS)) {
    failures.push(
      `a kontroll NEM bukik: csak ${String(control.restsInsideARun)} lepes folytat nyitott sorozatot, legalabb ${String(MIN_RESTS)} kell — a property a sorozatrol semmit nem bizonyit`,
    );
  } else {
    notes.push(
      `kontroll: ${String(control.restsInsideARun)} lepes folytat nyitott sorozatot (${String(control.runsWithSeveralSteps)} tobblepeses sorozat, ` +
        `${String(control.cases)} eset) — sorozat nelkul a hoszt ott nyugalomban lett volna`,
    );
  }
  if (!(control.stillSteps >= MIN_STILL)) {
    failures.push(`csak ${String(control.stillSteps)} lepes nem mozditott semmit, legalabb ${String(MIN_STILL)} kell`);
  } else {
    notes.push(`${String(control.stillSteps)} lepes a hatarnal semmit nem mozditott, es nem nyitott sorozatot`);
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-WHEEL-RUN: atment" : "G-WHEEL-RUN: BUKOTT");
process.exit(failures.length === 0 ? 0 : 1);
