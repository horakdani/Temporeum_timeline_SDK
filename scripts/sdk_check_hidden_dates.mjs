#!/usr/bin/env node
/**
 * G-HIDDEN-DATES: generalt rejtett tartomanyokon, mindket orientacioban: a rejtett ido nincs a tengelyen (egy szakasz ket vege egy kepponton, tick csak a varraton), a rajta atnyulo elem nelkule rajzolodik (a jelenetben is), es a zoom-horgony a rejtett tartomanyon at is tart — a skala zoomjaban es a gep gorgojeben. Statikusan: a mag a rejtett datumokat csak TimeWarp-kent ismeri (a /tools-bol nem importal), a skala, a pasztazas es a zoom a warp-ot kapja, a gep is tovabbadja.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".hidden-dates-report.json"),
  label: "rejtett-datumok",
  minTests: 14,
  claims: ["axis-skips-hidden", "item-across", "zoom-anchor"],
  orientations: true,
});

// A /tools a sajat belepesi pontjan van, es csak az alapbol importal.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("a tools belepesi pont hianyzik az entries.json-bol");
for (const file of ["hidden.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a /tools/${file} nem az alapbol importal: ${match[1]}`);
  }
}
const scale = codeOf(readFileSync(join(core, "src", "scale.ts"), "utf8"));
for (const needle of ["export interface TimeWarp", "warp?: TimeWarp): TimeScale", "if (warp !== undefined) return viaShown(domain, warp, (shown) => zoomDomainAt(", "if (warp !== undefined) return viaShown(domain, warp, (shown) => panDomainBy("]) {
  if (!scale.includes(needle)) failures.push(`a scale.ts-bol hianyzik: ${needle}`);
}
const input = codeOf(readFileSync(join(core, "src", "input.ts"), "utf8"));
const calls = [...input.matchAll(/(zoomDomainAt|panDomainBy)\(/g)].length;
const warped = [...input.matchAll(/(zoomDomainAt|panDomainBy)\((?:[^()]|\([^()]*\))*?, warp\)/g)].length;
if (calls === 0 || calls !== warped) failures.push(`a gep ${String(calls)} pasztazas/zoom-hivasabol ${String(warped)} adja tovabb a warp-ot`);
for (const file of ["scale.ts", "input.ts", "render.ts", "ticks.ts"]) {
  if (codeOf(readFileSync(join(core, "src", file), "utf8")).includes("/tools/")) failures.push(`a mag ${file} a /tools-bol importal`);
}

finish("G-HIDDEN-DATES", failures);
