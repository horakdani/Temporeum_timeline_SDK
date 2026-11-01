#!/usr/bin/env node
/**
 * G-GROUPS: generalt csoportfakon, mindket orientacioban — az osszecsukott
 * csoport leszarmazottai sem a layoutban, sem az akadalymentessegi faban
 * nincsenek, a kibontas ugyanazt a layoutot adja vissza, es az atrendezes
 * visszafordithato parancs (a huzas es a billentyu ugyanazt adja).
 *
 * Statikusan azt is nezi, hogy a createTimeline a csoportfejleceket a
 * listboxon kivul, `role="tree"`-ben rajzolja, es a huzas meg a billentyu is
 * a mag `moveGroupCommand`-jat hivja — nem egy masolatot.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".groups-report.json"),
  label: "csoport",
  minTests: 12,
  claims: ["collapsed-hidden", "expand-restores", "reorder-inverse", "drag-equals-key"],
  orientations: true,
});

const header = codeOf(readFileSync(join(root, "packages", "web-component", "src", "groups.ts"), "utf8"));
for (const needle of ['"tree"', '"treeitem"', '"aria-expanded"', '"aria-level"', "moveGroupCommand", "dropPosition", "groupKeyStep", "resolveGroupKey"]) {
  if (!header.includes(needle)) failures.push(`a csoportfejlec-reteg (web-component/src/groups.ts) nem hasznalja: ${needle}`);
}
finish("G-GROUPS", failures);
