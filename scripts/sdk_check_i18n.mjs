#!/usr/bin/env node
/**
 * G-I18N: pszeudo-nyelven egyetlen beegetett szoveg sincs; legalabb ot
 * nyelven es harom nem-Gergely naptarban a tickek a naptar egysegeihez
 * igazodnak.
 *
 * Ket riportbol all, mert a konyvtar ket helyen beszel:
 *
 *  1. a mag vitest-riportja (test/i18n/): pszeudo-szotarral rajzolt keretek
 *     mindket orientacioban — nevek, furtok, Gantt-feladatok, terheles,
 *     terhelesi savok, savfejlecek —, amelyekben a jelolt kifejezesek, a host
 *     szavai es az Intl datumai utan nem marad latin betu (pseudo); ot
 *     naptar (heber, umm al-qura, perzsa, kinai, etiop) harom zonaban, napi
 *     teljes pasztazassal: minden honap- es evkezdet tick, es minden tick az
 *     (calendar-units); hat nyelv tickcimkei az Intl sajatjai
 *     (five-locales); a szotar angolja betura a beepitett (english-equal);
 *     tobbes szam a nyelv szabalya szerint (plurals); rejtett datumokkal is
 *     (hidden-calendar);
 *  2. az elem bongeszos riportja (p26.browser.test.ts): az eszkozreteg, a
 *     csoportfa, a feladattablazat es a varolista szavai is a szotarbol
 *     jonnek (pseudo-element). Ezt a check maga futtatja, friss buildre —
 *     a G-ALL elott fut, es egy elavult dist hamis zold volna.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const element = join(root, "packages", "web-component");

const failures = checkReport({
  file: join(core, ".i18n-report.json"),
  label: "i18n",
  minTests: 25,
  claims: ["pseudo", "calendar-units", "five-locales", "english-equal", "plurals", "hidden-calendar"],
});

// Az elem fele: friss build, majd a P26-os bongeszos keszlet, sajat riportba.
const elementReport = join(element, ".i18n-element-report.json");
rmSync(elementReport, { force: true });
try {
  execFileSync("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-core"], { cwd: root, stdio: "pipe" });
  execFileSync("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-element"], { cwd: root, stdio: "pipe" });
  execFileSync("npx", ["vitest", "run", "--project", "browser", "test/p26.browser.test.ts", "--reporter=json", `--outputFile.json=${elementReport}`], { cwd: element, stdio: "pipe" });
} catch (error) {
  if (!existsSync(elementReport)) failures.push(`az elem P26-os keszlete nem futott le: ${String(error).split("\n")[0]}`);
}
failures.push(...checkReport({ file: elementReport, label: "elem-i18n", minTests: 5, claims: ["pseudo-element", "rtl-element", "calendar-element"] }));

finish("G-I18N", failures);
