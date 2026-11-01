#!/usr/bin/env node
/**
 * G-TASK-GRID: a tablazat sorai minden gorgetes es osszecsukas utan a
 * savokkal egy vonalban vannak (a renderelt kepkocka savjaihoz merve), es
 * 10 000 soron is virtualizalva: a DOM-ba csak a nezet sorai es a raharhagyas
 * kerul.
 *
 * Statikusan azt is nezi, hogy a mountTaskGrid a mag taskGridRows-at,
 * resolveGridKey-et es gridKeyStep-et hivja, role="grid"-et ad
 * aria-rowcount-tal es aria-rowindex-szel.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".task-grid-report.json"),
  label: "feladattablazat",
  minTests: 9,
  claims: ["rows-aligned", "aligned-after-collapse", "virtualized"],
  orientations: true,
});

const grid = codeOf(readFileSync(join(root, "packages", "web-component", "src", "task-grid.ts"), "utf8"));
for (const needle of ["taskGridRows(", "resolveGridKey(", "gridKeyStep(", '"grid"', '"aria-rowcount"', '"aria-rowindex"']) {
  if (!grid.includes(needle)) failures.push(`a feladattablazat (web-component/src/task-grid.ts) nem hasznalja: ${needle}`);
}
finish("G-TASK-GRID", failures);
