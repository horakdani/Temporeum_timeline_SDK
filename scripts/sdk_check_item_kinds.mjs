#!/usr/bin/env node
/**
 * The item-kinds check: box, point and background items are drawn, box and point
 * items can be hit and get an accessible name, a background cannot be hit
 * and never covers an item — in both orientations.
 *
 * Statically: createTimeline and the server split off the backgrounds with
 * the SAME configuration function (config.ts), through the /items plugin
 * (items.ts), otherwise the server's and the client's first frames would differ.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".item-kinds-report.json"),
  label: "item-kind",
  minTests: 11,
  claims: ["drawn", "named", "hit", "never-covers"],
  orientations: true,
});
// The one configuration function (config.ts) reaches both through the /items
// plugin, whose feature (items.ts) is splitBackgrounds and itemKindHooks.
const wc = (file) => codeOf(readFileSync(join(root, "packages", "web-component", "src", file), "utf8"));
for (const needle of ["feature.split(items", "feature.hooks(config, base)"]) {
  if (!wc("config.ts").includes(needle)) failures.push(`the web-component config.ts does not use: ${needle} — the server and the client would draw by different paths`);
}
for (const needle of ["split: splitBackgrounds", "itemKindHooks(drawn"]) {
  if (!wc("items.ts").includes(needle)) failures.push(`the /items plugin (items.ts) does not use: ${needle}`);
}
finish("item-kinds", failures);
