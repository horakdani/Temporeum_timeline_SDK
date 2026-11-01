#!/usr/bin/env node
/**
 * G-LIVE-DATA: generalt frissites-sorozatokon az inkrementalis frissites (applyItemChanges + relayout) ugyanazt az elrendezest es ugyanazt a kepkockat adja, mint a teljes ujratoltes. Statikusan: a peldany elo-adat API-ja (addItems, updateItems, removeItems, changeItems) egyetlen commitLive-on at, a relayout-tal rajzol.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".live-data-report.json"),
  label: "elo-adat",
  minTests: 4,
  claims: ["incremental-equals-full"],
});

// A /tools a sajat belepesi pontjan van, es csak az alapbol importal.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("a tools belepesi pont hianyzik az entries.json-bol");
// Az elo-adat modulja a P32 ota a megosztott src/shared/live-data.ts (a /tools es a
// /live is innen exportal, G-TREESHAKE); az allitas ugyanaz: csak az alapbol importal.
for (const file of ["live-data.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "shared", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a src/shared/${file} nem az alapbol importal: ${match[1]}`);
  }
}
const timeline = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
for (const method of ["addItems", "updateItems", "removeItems", "changeItems"]) {
  if (!new RegExp(`${method}\\([a-z]+\\) \\{\\s*commitLive\\(`).test(timeline)) failures.push(`a peldany ${method}-je nem a commitLive-on at fut`);
}
if (!timeline.includes("relayout(result.layout")) failures.push("a peldany nem a relayout-tal rajzol elo valtozas utan");

finish("G-LIVE-DATA", failures);
