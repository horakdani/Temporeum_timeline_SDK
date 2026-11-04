#!/usr/bin/env node
/**
 * The live-data check: on generated update sequences the incremental update (applyItemChanges + relayout) gives the same layout and the same frame as a full reload. Statically: the instance's live-data API (addItems, updateItems, removeItems, changeItems) draws through a single commitLive, with relayout.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".live-data-report.json"),
  label: "live-data",
  minTests: 4,
  claims: ["incremental-equals-full"],
});

// /tools has its own entry point and imports only from the base.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("the tools entry point is missing from entries.json");
// The live-data module is now the shared src/shared/live-data.ts (both /tools and
// /live export from it, the treeshake check); the claim is the same: it imports only from the base.
for (const file of ["live-data.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "shared", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`src/shared/${file} imports from outside the base: ${match[1]}`);
  }
}
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
for (const method of ["addItems", "updateItems", "removeItems", "changeItems"]) {
  if (!new RegExp(`${method}\\([a-z]+\\) \\{\\s*commitLive\\(`).test(timeline)) failures.push(`the instance's ${method} does not run through commitLive`);
}
if (!timeline.includes("relayout(result.layout")) failures.push("the instance does not draw with relayout after a live change");

finish("live-data", failures);
