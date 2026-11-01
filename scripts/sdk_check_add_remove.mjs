#!/usr/bin/env node
/**
 * G-ADD-REMOVE: a hozzaadas es a torles gesztussal es billentyuvel is
 * ugyanazt a parancsot adja ki, az inverz a pontos kiindulast allitja vissza,
 * es a host vetoja atomi.
 *
 * A futasideju fele a mag tiszta fuggvenyeit meri. A statikus fele azt, hogy
 * a createTimeline mindket utja tenyleg EZEKET hivja: a gesztus a
 * `addTargetAt`-ot, a billentyu a `addTargetFromFocus`-t, es mindketto
 * ugyanabba az `addCommand`-ot hivo fuggvenybe fut; a torles mindket utja a
 * `removeTargets`-en at a `removeCommand`-ba. A torlo fogantyut a gesztus a
 * lenyomas DOM-celpontjarol ismeri fel (`data-tl-remove`), nem geometriabol:
 * az elemter transzformja alatt a celpont az, amit a hasznalo latott.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".add-remove-report.json"),
  label: "hozzaadas-torles",
  minTests: 7,
  claims: ["same-command", "inverse-exact", "veto-atomic"],
});
const source = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
const count = (needle) => source.split(needle).length - 1;
for (const needle of ["addTargetAt(", "addTargetFromFocus(", "resolveItemKey(", '"[data-tl-remove]"']) {
  if (count(needle) < 1) failures.push(`a createTimeline nem hivja: ${needle}`);
}
if (count("addCommand(") !== 1) failures.push(`az addCommand-nak pontosan EGY hivasa kell a createTimeline-ban (most ${String(count("addCommand("))}): a gesztus, a billentyu es a behuzas egy uton jar`);
if (count("removeCommand(") !== 1) failures.push(`a removeCommand-nak pontosan EGY hivasa kell (most ${String(count("removeCommand("))})`);
if (count("removeTargets(") < 1) failures.push("a createTimeline nem a removeTargets-szel valasztja a torlendo elemeket");
finish("G-ADD-REMOVE", failures);
