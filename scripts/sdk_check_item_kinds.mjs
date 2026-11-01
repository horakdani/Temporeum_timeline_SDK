#!/usr/bin/env node
/**
 * G-ITEM-KINDS: a box, a point es a background elem rajzolodik, a box es a
 * point eltalalhato es akadalymentes nevet kap, a background nem talalhato
 * el, es soha nem takar elemet — mindket orientacioban.
 *
 * Statikusan: a createTimeline es a szerver UGYANAZZAL a konfiguracios
 * fuggvennyel (config.ts) bontja le a hattereket, kulonben a szerver es a
 * kliens elso kepkockaja eltérne.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".item-kinds-report.json"),
  label: "elemtipus",
  minTests: 11,
  claims: ["drawn", "named", "hit", "never-covers"],
  orientations: true,
});
const config = codeOf(readFileSync(join(root, "packages", "web-component", "src", "config.ts"), "utf8"));
for (const needle of ["splitBackgrounds", "itemKindHooks"]) {
  if (!config.includes(needle)) failures.push(`a web-component config.ts nem hasznalja: ${needle} — a szerver es a kliens kulon uton rajzolna`);
}
finish("G-ITEM-KINDS", failures);
