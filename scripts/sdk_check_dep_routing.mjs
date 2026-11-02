#!/usr/bin/env node
/**
 * G-DEP-ROUTE: on generated projects, in both orientations and after every
 * packing — every arrow leaves and arrives at the edge its type calls for,
 * is orthogonal, is drawn under the items, and culling never drops a visible
 * arrow (while, per the control, it does drop invisible ones: culling is not
 * a no-op).
 *
 * Statically it also checks that createTimeline and SSR draw the arrows
 * through the same frameScene, with the core's dependencyPaths and
 * withDependencyLayer —
 * not with a copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".dep-routing-report.json"),
  label: "dependency routing",
  minTests: 12,
  claims: ["type-edges", "orthogonal", "under-items", "cull-keeps-visible"],
  orientations: true,
});

const wc = (file) => codeOf(readFileSync(join(root, "packages", "web-component", "src", file), "utf8"));
const config = wc("config.ts");
// A path per look since G-PERF-GANTT: the element draws through dependencyPaths
// and routePath, and the under-items claim is tested on both drawings.
for (const needle of ["routeDependencies(", "dependencyPaths(", "routePath(", "withDependencyLayer("]) {
  if (!config.includes(needle)) failures.push(`frameScene (web-component/src/config.ts) does not use: ${needle}`);
}
if (!wc("timeline.ts").includes("frameScene(config, state, result)")) failures.push("createTimeline does not draw through frameScene");
if (!wc("ssr.ts").includes("frameScene(config, state, result)")) failures.push("SSR does not draw through frameScene");
finish("G-DEP-ROUTE", failures);
