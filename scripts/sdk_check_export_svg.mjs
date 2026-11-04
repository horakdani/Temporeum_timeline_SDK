#!/usr/bin/env node
/**
 * The export-svg check: in every case of the visual matrix the exported standalone
 * SVG is pixel for pixel the same as the frame drawn on screen.
 *
 * Two sources: the vitest JSON report (every test passes, the
 * [claim:pixel-identical] claim for every case), and the test's log
 * (.export-svg-log.json), written from the pixel difference MEASURED in the
 * browser. The size of the matrix is computed from matrix.json and the
 * core's ORIENTATIONS/THEMES — it does not trust the log's own "expected"
 * field. A missing source is a FAILURE, not a skip.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const matrix = JSON.parse(readFileSync(join(core, "test", "visual", "matrix.json"), "utf8"));
// Two orientations, two themes: from the core's code, not from the log.
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
if (expected < 12) failures.push(`the matrix is only ${String(expected)} cases (widths x orientations x themes) — at least 12 are required`);
if (!existsSync(logFile)) {
  failures.push(`no log (${logFile}) — the pixel comparison did NOT run, so this is a FAILURE`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const cases = log.cases ?? [];
  const names = new Set(cases.map((each) => each.name));
  if (names.size !== expected) failures.push(`${String(names.size)} cases measured, ${String(expected)} required`);
  for (const each of cases) {
    if (each.differing !== 0) failures.push(`${String(each.name)}: ${String(each.differing)} pixels differ`);
  }
  notes.push(`${String(names.size)} cases, all with 0 differences: ${String(cases.every((each) => each.differing === 0))}`);
}
finish("export-svg", failures, notes);
