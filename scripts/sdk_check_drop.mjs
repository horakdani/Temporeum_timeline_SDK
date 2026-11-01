#!/usr/bin/env node
/**
 * G-DROP: igazi bongeszoben egy kulso elem a mutato alatti idopontra es savra
 * kerul (legfeljebb 2 px eltéréssel), es van billentyus megfeleloje, ami a
 * fokuszalt savra, a nezet kozepere tesz.
 *
 * Ket forras: a Playwright JSON-riportja (mindket teszt lefutott es zold), es
 * a lap naploja (.drop-browser-log.json), amit a bongeszobol olvasott adat
 * irt. Egy hianyzo forras BUKAS, nem kihagyas.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "packages", "docs");
const failures = [];
const notes = [];

const reportFile = join(docs, ".e2e-drop-report.json");
if (!existsSync(reportFile)) {
  failures.push(`nincs Playwright-riport (${reportFile}) — a behuzas-keszlet NEM futott, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < 2) failures.push(`${String(specs.length)} behuzas-teszt futott, 2 kell`);
  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
    if (results.length === 0 || results.some((result) => result.status !== "passed")) failures.push(`nem zold: ${String(spec.title)}`);
  }
}

const logFile = join(docs, ".drop-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`nincs bongeszo-naplo (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const pointer = log.pointer;
  const keyboard = log.keyboard;
  if (pointer === undefined) failures.push("a naplobol hianyzik a mutatos behuzas");
  else {
    if (pointer.laneId !== pointer.expectedLane) failures.push(`a behuzott elem savja ${String(pointer.laneId)}, nem ${String(pointer.expectedLane)}`);
    if (!(pointer.errorPx <= 2)) failures.push(`a behuzott elem ${String(pointer.errorPx)} px-re esett a mutatotol (legfeljebb 2)`);
    notes.push(`mutato: sav ${String(pointer.laneId)}, eltérés ${Number(pointer.errorPx).toFixed(2)} px`);
  }
  if (keyboard === undefined) failures.push("a naplobol hianyzik a billentyus iker");
  else {
    if (keyboard.laneId === undefined || keyboard.laneId !== keyboard.expectedLane) failures.push(`a billentyus iker savja ${String(keyboard.laneId)}, nem a fokuszalt ${String(keyboard.expectedLane)}`);
    if (!(keyboard.errorMs <= 1)) failures.push(`a billentyus iker ${String(keyboard.errorMs)} ms-ra esett a nezet kozepetol`);
    notes.push(`billentyu: sav ${String(keyboard.laneId)}, eltérés ${String(keyboard.errorMs)} ms`);
  }
}
finish("G-DROP", failures, notes);
