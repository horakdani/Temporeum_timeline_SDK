#!/usr/bin/env node
/**
 * The resources check: on generated assignments, utilisation in every time slot is
 * the sum of the assignments, overallocation is marked exactly where it is
 * over capacity, and dragging an item across is an undoable command.
 *
 * Three runtime claims (load-sum, overload-exact, reassign): the load is
 * checked against a reference sum read straight from the items; the markings
 * (lane, red column, overallocated item) against the reference, not against
 * the sweep; reassignment through the real input machine, by dragging onto
 * any row (the load lane stands for its resource) and with Alt+arrow.
 * Statically: /resources lives on its own entry point and pulls in no other
 * entry point's code — it imports only from the base.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".resources-report.json"),
  label: "resources",
  minTests: 9,
  claims: ["load-sum", "overload-exact", "reassign"],
});

const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "resources" && entry.input === "src/resources/index.ts")) {
  failures.push("the resources entry point is missing from entries.json");
}
const source = codeOf(readFileSync(join(core, "src", "resources", "index.ts"), "utf8"));
for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
  const target = match[1];
  // Only the base: ../a11y.js, ../render.js ... — not another entry point's code (../gantt/, ../items/ ...).
  if (!/^\.\.\/[a-z0-9-]+\.js$/.test(target)) failures.push(`/resources imports from outside the base: ${target}`);
}
finish("resources", failures);
