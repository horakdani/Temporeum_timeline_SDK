#!/usr/bin/env node
/**
 * G-PRINT: nyomtatasi mediaval a teljes tartomany minden eleme pontosan egy
 * oldalon jelenik meg.
 *
 * Ket forras: a Playwright JSON-riportja (minden allitas-teszt lefutott es
 * zold), es a lap naploja (.print-browser-log.json), amit a bongeszobol
 * olvasott adat irt: a nyomtatasi nezet szakaszai print mediaval, es a
 * bongeszo SAJAT nyomtatasa (page.pdf) pdf.js-sel visszaolvasva. Egy hianyzo
 * forras BUKAS, nem kihagyas.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "packages", "docs");
const failures = [];
const notes = [];
const CLAIMS = ["one-page", "browser-print", "leaves", "pdf-export"];

const reportFile = join(docs, ".e2e-print-report.json");
if (!existsSync(reportFile)) {
  failures.push(`nincs Playwright-riport (${reportFile}) — a nyomtatasi keszlet NEM futott, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < CLAIMS.length) failures.push(`${String(specs.length)} nyomtatasi teszt futott, ${String(CLAIMS.length)} kell`);
  const green = [];
  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
    if (results.length === 0 || results.some((result) => result.status !== "passed")) failures.push(`nem zold: ${String(spec.title)}`);
    else green.push(String(spec.title));
  }
  for (const claim of CLAIMS) {
    if (!green.some((title) => title.includes(`[claim:${claim}]`))) failures.push(`a(z) [claim:${claim}] allitasnak nincs zold tesztje`);
  }
}

const logFile = join(docs, ".print-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`nincs bongeszo-naplo (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const one = log.onePage ?? {};
  if (!(one.items > 0)) failures.push("a naplo szerint nem volt elem");
  if (!(one.pages > 1)) failures.push(`${String(one.pages)} lap — a tobb oldalra bontas nincs merve`);
  if (one.missing !== 0) failures.push(`${String(one.missing)} elem egyik lapon sincs`);
  if (one.duplicated !== 0) failures.push(`${String(one.duplicated)} elem tobb lapon is megjelenik`);
  if (one.overflowing !== 0) failures.push(`${String(one.overflowing)} lap nagyobb a papir nyomtathato teruletenel`);
  if (one.hiddenOnScreen !== true) failures.push("a nyomtatasi nezet a kepernyon is latszik");
  if (one.aloneInPrint !== true) failures.push("nyomtatasban nem egyedul a nyomtatasi nezet latszik");
  const browser = log.browserPrint ?? {};
  if (browser.sheets !== one.pages) failures.push(`a bongeszo nyomtatasa ${String(browser.sheets)} lap, a nezet ${String(one.pages)}`);
  if (!(browser.found === browser.labels && browser.agreeing === browser.found)) failures.push(`a bongeszo nyomtatasaban ${String(browser.agreeing)} / ${String(browser.labels)} cimke van pontosan a sajat lapjan`);
  if (log.leaves?.left !== true) failures.push("a nyomtatasi nezet az afterprint utan a dokumentumban maradt");
  const pdf = log.pdfExport ?? {};
  if (!(pdf.sheets === one.pages && pdf.agreeing === pdf.found && pdf.found === one.items)) failures.push(`az exportPDF nem egyezik a nezettel (${JSON.stringify(pdf)})`);
  notes.push(`${String(one.items)} elem, ${String(one.pages)} lap (${(one.perPage ?? []).join(" + ")}); a bongeszo nyomtatasa ${String(browser.sheets)} lap, ${String(browser.agreeing)} cimke a sajat lapjan`);
}
finish("G-PRINT", failures, notes);
