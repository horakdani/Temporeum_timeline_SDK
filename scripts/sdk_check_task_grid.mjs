#!/usr/bin/env node
/**
 * G-TASK-GRID: after every scroll and collapse the grid rows line up with
 * the lanes (measured against the lanes of the rendered frame), and on
 * 10 000 rows too it is virtualised: only the rows in view plus the overscan
 * go into the DOM.
 *
 * Statically it also checks that mountTaskGrid calls the core's
 * taskGridRows, resolveGridKey and gridKeyStep, and sets role="grid" with
 * aria-rowcount and aria-rowindex.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".task-grid-report.json"),
  label: "task-grid",
  minTests: 9,
  claims: ["rows-aligned", "aligned-after-collapse", "virtualized"],
  orientations: true,
});

const grid = codeOf(readFileSync(join(root, "packages", "web-component", "src", "task-grid.ts"), "utf8"));
for (const needle of ["taskGridRows(", "resolveGridKey(", "gridKeyStep(", '"grid"', '"aria-rowcount"', '"aria-rowindex"']) {
  if (!grid.includes(needle)) failures.push(`the task grid (web-component/src/task-grid.ts) does not use: ${needle}`);
}
finish("G-TASK-GRID", failures);
