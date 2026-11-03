#!/usr/bin/env node
/**
 * G-RANGE-SELECT: range selection by gesture and by keyboard emits the same event (selectRange on both paths). Statically: the tools layer routes both the drag (rangeFromDrag) and the keys (rangeKeyStep) into commitRange, and the instance emits rangeSelected.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".range-select-report.json"),
  label: "range",
  minTests: 6,
  claims: ["gesture", "keyboard", "same-event"],
  orientations: true,
});

// /tools lives on its own entry point and imports only from the base.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("the tools entry point is missing from entries.json");
for (const file of ["range.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`/tools/${file} imports from outside the base: ${match[1]}`);
  }
}
const tools = codeOf(readFileSync(join(root, "packages", "web-component", "src", "tools", "layer.ts"), "utf8"));
for (const needle of ["rangeFromDrag(", "rangeKeyStep(", "commitRange(rangeFromDrag(", "commitRange(selectRange("]) if (!tools.includes(needle)) failures.push(`missing from the tools layer: ${needle}`);
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
if (!timeline.includes('emitter.emit("rangeSelected"')) failures.push("the instance does not emit a rangeSelected event");

finish("G-RANGE-SELECT", failures);
