#!/usr/bin/env node
/**
 * G-TIME-BARS: a custom time bar can be moved by gesture and by keyboard, and the same move emits the same event (moveTimeBar on both paths). Statically: the element's tools layer routes both the drag (dragTimeBarTime) and the key (timeBarKeyTime) into host.moveBar, and the instance emits timeBarMoved.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".time-bars-report.json"),
  label: "time-bar",
  minTests: 10,
  claims: ["gesture", "keyboard", "same-event"],
  orientations: true,
});

// /tools lives on its own entry point and imports only from the base.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("the tools entry point is missing from entries.json");
for (const file of ["time-bars.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`/tools/${file} imports from outside the base: ${match[1]}`);
  }
}
const tools = codeOf(readFileSync(join(root, "packages", "web-component", "src", "tools", "layer.ts"), "utf8"));
for (const needle of ["dragTimeBarTime(", "timeBarKeyTime(", "host.moveBar("]) if (!tools.includes(needle)) failures.push(`missing from the tools layer: ${needle}`);
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
if (!timeline.includes('emitter.emit("timeBarMoved"')) failures.push("the instance does not emit a timeBarMoved event");

finish("G-TIME-BARS", failures);
