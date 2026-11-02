#!/usr/bin/env node
/**
 * G-TOOLTIP: the tooltip appears on mouse hover, on focus and on long press,
 * disappears on Esc (focus and selection do not change), and the pointer can
 * be moved onto it — WCAG 1.4.13: dismissible, hoverable, persistent.
 *
 * Two sources: the Playwright JSON report (every claim test ran and passed),
 * and the page's log (.tooltip-browser-log.json), written from data read in
 * the browser. A missing source FAILS; it is not skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "packages", "docs");
const failures = [];
const notes = [];
const CLAIMS = ["hover", "hoverable", "persistent", "focus", "dismiss", "long-press"];

const reportFile = join(docs, ".e2e-tooltip-report.json");
if (!existsSync(reportFile)) {
  failures.push(`no Playwright report (${reportFile}) — the tooltip suite did NOT run, so this FAILS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < 4) failures.push(`${String(specs.length)} tooltip tests ran, 4 are required`);
  const green = [];
  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
    if (results.length === 0 || results.some((result) => result.status !== "passed")) failures.push(`not passing: ${String(spec.title)}`);
    else green.push(String(spec.title));
  }
  for (const claim of CLAIMS) {
    if (!green.some((title) => title.includes(`[claim:${claim}]`))) failures.push(`the [claim:${claim}] claim has no passing test`);
  }
}

const logFile = join(docs, ".tooltip-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`no browser log (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  if (log.hover?.shown !== true) failures.push("did not appear on mouse hover");
  if (log.focus?.shown !== true) failures.push("did not appear on focus");
  if (log.longPress?.shown !== true) failures.push("did not appear on long press");
  if (log.dismiss?.hidden !== true) failures.push("did not disappear on Esc");
  if (log.dismiss?.focusKept !== true) failures.push("Esc moved the focus");
  if (log.dismiss?.selectionKept !== true) failures.push("Esc changed the selection");
  if (log.hoverable?.stayedOnTooltip !== true) failures.push("the pointer cannot be moved onto it: it disappeared when the pointer reached it");
  if (!(Number(log.hoverable?.heldMs) >= 1000)) failures.push("persistence is not measured (at least 1 s on the tooltip)");
  notes.push(`hover: ${JSON.stringify(log.hover?.text ?? "")}; focus: ${String(log.focus?.focused)}; long press: ${JSON.stringify(log.longPress?.text ?? "")}`);
}
finish("G-TOOLTIP", failures, notes);
