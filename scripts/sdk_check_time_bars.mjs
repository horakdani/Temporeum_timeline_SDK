#!/usr/bin/env node
/**
 * G-TIME-BARS: a sajat idovonal gesztussal es billentyuvel is mozgathato, es ugyanazt az esemenyt adja ugyanarra a mozgatasra (moveTimeBar mindket uton). Statikusan: az elem eszkozretege a huzast (dragTimeBarTime) es a billentyut (timeBarKeyTime) is a host.moveBar-ba viszi, es a peldany timeBarMoved-ot ad.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".time-bars-report.json"),
  label: "idovonalak",
  minTests: 10,
  claims: ["gesture", "keyboard", "same-event"],
  orientations: true,
});

// A /tools a sajat belepesi pontjan van, es csak az alapbol importal.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("a tools belepesi pont hianyzik az entries.json-bol");
for (const file of ["time-bars.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a /tools/${file} nem az alapbol importal: ${match[1]}`);
  }
}
const tools = codeOf(readFileSync(join(root, "packages", "web-component", "src", "tools.ts"), "utf8"));
for (const needle of ["dragTimeBarTime(", "timeBarKeyTime(", "host.moveBar("]) if (!tools.includes(needle)) failures.push(`az eszkozretegbol hianyzik: ${needle}`);
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
if (!timeline.includes('emitter.emit("timeBarMoved"')) failures.push("a peldany nem ad timeBarMoved esemenyt");

finish("G-TIME-BARS", failures);
