#!/usr/bin/env node
/**
 * G-RANGE-SELECT: a tartomany-kijeloles gesztussal es billentyuvel is ugyanazt az esemenyt adja (selectRange mindket uton). Statikusan: az eszkozreteg a huzast (rangeFromDrag) es a billentyuket (rangeKeyStep) is a commitRange-be viszi, a peldany rangeSelected-et ad.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".range-select-report.json"),
  label: "tartomany",
  minTests: 6,
  claims: ["gesture", "keyboard", "same-event"],
  orientations: true,
});

// A /tools a sajat belepesi pontjan van, es csak az alapbol importal.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("a tools belepesi pont hianyzik az entries.json-bol");
for (const file of ["range.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a /tools/${file} nem az alapbol importal: ${match[1]}`);
  }
}
const tools = codeOf(readFileSync(join(root, "packages", "web-component", "src", "tools.ts"), "utf8"));
for (const needle of ["rangeFromDrag(", "rangeKeyStep(", "commitRange(rangeFromDrag(", "commitRange(selectRange("]) if (!tools.includes(needle)) failures.push(`az eszkozretegbol hianyzik: ${needle}`);
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
if (!timeline.includes('emitter.emit("rangeSelected"')) failures.push("a peldany nem ad rangeSelected esemenyt");

finish("G-RANGE-SELECT", failures);
