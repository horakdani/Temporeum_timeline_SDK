#!/usr/bin/env node
/**
 * G-HIDDEN-DATES: on generated hidden ranges, in both orientations: hidden time is not on the axis (both ends of a range sit on one pixel, a tick only on the seam), an item spanning it is drawn without it (in the scene too), and the zoom anchor holds across a hidden range — in the scale's zoom and in the machine's wheel. Statically: the core knows hidden dates only as a TimeWarp (it does not import from /tools), the scale, panning and zoom receive the warp, and the machine passes it on.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".hidden-dates-report.json"),
  label: "hidden-dates",
  minTests: 14,
  claims: ["axis-skips-hidden", "item-across", "zoom-anchor"],
  orientations: true,
});

// /tools has its own entry point and imports only from the base.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("the tools entry point is missing from entries.json");
for (const file of ["hidden.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`/tools/${file} imports from outside the base: ${match[1]}`);
  }
}
const scale = codeOf(readFileSync(join(core, "src", "scale.ts"), "utf8"));
for (const needle of ["export interface TimeWarp", "warp?: TimeWarp): TimeScale", "if (warp !== undefined) return viaShown(domain, warp, (shown) => zoomDomainAt(", "if (warp !== undefined) return viaShown(domain, warp, (shown) => panDomainBy("]) {
  if (!scale.includes(needle)) failures.push(`scale.ts is missing: ${needle}`);
}
const input = codeOf(readFileSync(join(core, "src", "input.ts"), "utf8"));
const calls = [...input.matchAll(/(zoomDomainAt|panDomainBy)\(/g)].length;
const warped = [...input.matchAll(/(zoomDomainAt|panDomainBy)\((?:[^()]|\([^()]*\))*?, warp\)/g)].length;
if (calls === 0 || calls !== warped) failures.push(`of the machine's ${String(calls)} pan/zoom calls, ${String(warped)} pass the warp on`);
for (const file of ["scale.ts", "input.ts", "render.ts", "ticks.ts"]) {
  if (codeOf(readFileSync(join(core, "src", file), "utf8")).includes("/tools/")) failures.push(`the core's ${file} imports from /tools`);
}

finish("G-HIDDEN-DATES", failures);
