#!/usr/bin/env node
/**
 * G-TEMPLATE: a HTML-sablon a kliensen es a szerveren ugyanazt adja, az elem
 * akadalymentes neve megmarad, es egy szkriptet tartalmazo sablon
 * alapertelmezesben nem fut le — NEGATIV KONTROLLAL: `sanitize: false` mellett
 * ugyanaz a sablon igenis eljut a DOM-ig.
 *
 * Ket riport: a mag vitest-keszlete (a hamis DOM-ba szerelve), es egy valodi
 * Chromium-futas a docs csomagbol, ahol a szkript es a kezelo TENYLEG lefutna,
 * ha a sablon atengedne.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".template-report.json"),
  label: "sablon",
  minTests: 6,
  claims: ["same-tree", "accessible-name", "no-script", "negative-control"],
});
const e2e = join(root, "packages", "docs", ".template-e2e.json");
if (!existsSync(e2e)) {
  failures.push(`nincs bongeszos sablon-riport (${e2e}) — a valodi Chromium-futas NEM futott, ezert BUKAS`);
} else {
  const log = JSON.parse(readFileSync(e2e, "utf8"));
  if (log.sanitized?.ran !== false) failures.push(`a tisztitott sablon szkriptje lefutott a bongeszoben: ${JSON.stringify(log.sanitized)}`);
  if (log.unsanitized?.ran !== true) failures.push(`a negativ kontroll nem mutatta ki a futast (sanitize: false): ${JSON.stringify(log.unsanitized)} — a mero vak`);
  if (log.ssrEqual !== true) failures.push("a szerver es a kliens sablon-markupja eltert a bongeszoben");
}
finish("G-TEMPLATE", failures);
