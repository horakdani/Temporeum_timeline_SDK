#!/usr/bin/env node
/**
 * G-DEP-ROUTE: generalt projekteken, mindket orientacioban es minden
 * pakolas utan — minden nyil a tipusanak megfelelo elen indul es erkezik,
 * derekszogu, az elemek alatt rajzolodik, es a culling lathato nyilat soha
 * nem hagy el (a kontroll szerint viszont hagy el lathatatlant: a culling
 * nem ures).
 *
 * Statikusan azt is nezi, hogy a createTimeline es az SSR ugyanazon a
 * frameScene-en at rajzolja a nyilakat, a mag dependencyPaths-avel es
 * withDependencyLayer-evel —
 * nem egy masolattal.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".dep-routing-report.json"),
  label: "fuggoseg-utvonal",
  minTests: 12,
  claims: ["type-edges", "orthogonal", "under-items", "cull-keeps-visible"],
  orientations: true,
});

const wc = (file) => codeOf(readFileSync(join(root, "packages", "web-component", "src", file), "utf8"));
const config = wc("config.ts");
// A path per look since G-PERF-GANTT: the element draws through dependencyPaths
// and routePath, and the under-items claim is tested on both drawings.
for (const needle of ["routeDependencies(", "dependencyPaths(", "routePath(", "withDependencyLayer("]) {
  if (!config.includes(needle)) failures.push(`a frameScene (web-component/src/config.ts) nem hasznalja: ${needle}`);
}
if (!wc("timeline.ts").includes("frameScene(config, state, result)")) failures.push("a createTimeline nem a frameScene-en at rajzol");
if (!wc("ssr.ts").includes("frameScene(config, state, result)")) failures.push("az SSR nem a frameScene-en at rajzol");
finish("G-DEP-ROUTE", failures);
