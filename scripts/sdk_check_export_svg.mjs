#!/usr/bin/env node
/**
 * G-EXPORT-SVG: az exportalt onallo SVG a vizualis matrix minden eseteben
 * kepre pontosan ugyanaz, mint a kepernyon rajzolt kepkocka.
 *
 * Ket forras: a vitest JSON-riportja (minden teszt zold, a [claim:pixel-identical]
 * allitas minden esetre), es a teszt naploja (.export-svg-log.json), amit a
 * bongeszoben MERT kepponteltérés irt. A matrix meretet a matrix.json-bol es
 * a mag ORIENTATIONS/THEMES-ebol szamolja — a naplo sajat "expected" mezojet
 * nem hiszi el. Egy hianyzo forras BUKAS, nem kihagyas.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const matrix = JSON.parse(readFileSync(join(core, "test", "visual", "matrix.json"), "utf8"));
// Ket orientacio, ket tema: a mag kodjabol, nem a naplobol.
const orientations = (readFileSync(join(core, "src", "geometry.ts"), "utf8").match(/ORIENTATIONS[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").filter((part) => part.trim() !== "").length;
const themes = (readFileSync(join(core, "src", "theme.ts"), "utf8").match(/THEMES[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").filter((part) => part.trim() !== "").length;
const expected = matrix.widths.length * orientations * themes;

const failures = checkReport({
  file: join(core, ".export-svg-report.json"),
  label: "export-svg",
  minTests: expected + 4,
  claims: ["pixel-identical"],
});
const notes = [];
const logFile = join(core, ".export-svg-log.json");
if (expected < 12) failures.push(`a matrix csak ${String(expected)} eset (widths x orientaciok x temak) — legalabb 12 kell`);
if (!existsSync(logFile)) {
  failures.push(`nincs naplo (${logFile}) — a kepponti osszevetes NEM futott, ezert BUKAS`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const cases = log.cases ?? [];
  const names = new Set(cases.map((each) => each.name));
  if (names.size !== expected) failures.push(`${String(names.size)} eset merve, ${String(expected)} kell`);
  for (const each of cases) {
    if (each.differing !== 0) failures.push(`${String(each.name)}: ${String(each.differing)} keppont elter`);
  }
  notes.push(`${String(names.size)} eset, mind 0 elteres: ${String(cases.every((each) => each.differing === 0))}`);
}
finish("G-EXPORT-SVG", failures, notes);
