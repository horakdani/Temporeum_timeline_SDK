#!/usr/bin/env node
/**
 * G-PRINT: with print media, every item of the full range appears on
 * exactly one page.
 *
 * Two sources: the Playwright JSON report (every claim test ran and is
 * green), and the page's log (.print-browser-log.json), written from data
 * read in the browser: the print view's sections with print media, and the
 * browser's OWN print (page.pdf) read back with pdf.js. A missing source is a
 * FAILURE, not a skip.
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
  failures.push(`no Playwright report (${reportFile}) — the print suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < CLAIMS.length) failures.push(`${String(specs.length)} print tests ran, ${String(CLAIMS.length)} are required`);
  const green = [];
  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
    if (results.length === 0 || results.some((result) => result.status !== "passed")) failures.push(`not green: ${String(spec.title)}`);
    else green.push(String(spec.title));
  }
  for (const claim of CLAIMS) {
    if (!green.some((title) => title.includes(`[claim:${claim}]`))) failures.push(`the [claim:${claim}] claim has no green test`);
  }
}

const logFile = join(docs, ".print-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`no browser log (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const one = log.onePage ?? {};
  if (!(one.items > 0)) failures.push("according to the log there were no items");
  if (!(one.pages > 1)) failures.push(`${String(one.pages)} pages — splitting across pages is not measured`);
  if (one.missing !== 0) failures.push(`${String(one.missing)} items are on no page`);
  if (one.duplicated !== 0) failures.push(`${String(one.duplicated)} items appear on more than one page`);
  if (one.overflowing !== 0) failures.push(`${String(one.overflowing)} pages are larger than the paper's printable area`);
  if (one.hiddenOnScreen !== true) failures.push("the print view is visible on screen too");
  if (one.aloneInPrint !== true) failures.push("in print, the print view is not the only thing visible");
  const browser = log.browserPrint ?? {};
  if (browser.sheets !== one.pages) failures.push(`the browser's print has ${String(browser.sheets)} pages, the view ${String(one.pages)}`);
  if (!(browser.found === browser.labels && browser.agreeing === browser.found)) failures.push(`in the browser's print ${String(browser.agreeing)} / ${String(browser.labels)} labels are exactly on their own page`);
  if (log.leaves?.left !== true) failures.push("the print view stayed in the document after afterprint");
  const pdf = log.pdfExport ?? {};
  if (!(pdf.sheets === one.pages && pdf.agreeing === pdf.found && pdf.found === one.items)) failures.push(`exportPDF does not match the view (${JSON.stringify(pdf)})`);
  notes.push(`${String(one.items)} items, ${String(one.pages)} pages (${(one.perPage ?? []).join(" + ")}); the browser's print ${String(browser.sheets)} pages, ${String(browser.agreeing)} labels on their own page`);
}
finish("G-PRINT", failures, notes);
