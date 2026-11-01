#!/usr/bin/env node
/**
 * G-GANTT-A11Y: egy feladat elodjei es utodai az akadalymentes leirasban
 * vannak (a renderelt option aria-label-jeben), es billentyuvel elerhetok:
 * `[` minden elodre, `]` minden utodra eljut, korbe.
 *
 * Statikusan azt is nezi, hogy a createTimeline a mag resolveDependencyKey-
 * es dependencyKeyStep-fuggvenyet hivja, es a frame horgai a ganttHooks-on
 * mennek at.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".gantt-a11y-report.json"),
  label: "gantt-a11y",
  minTests: 4,
  claims: ["links-named", "key-jumps"],
});

const wc = (file) => codeOf(readFileSync(join(root, "packages", "web-component", "src", file), "utf8"));
for (const needle of ["resolveDependencyKey(", "dependencyKeyStep("]) {
  if (!wc("timeline.ts").includes(needle)) failures.push(`a createTimeline nem hasznalja: ${needle}`);
}
if (!wc("config.ts").includes("ganttHooks(")) failures.push("a frame horgai nem a ganttHooks-on mennek at");
finish("G-GANTT-A11Y", failures);
