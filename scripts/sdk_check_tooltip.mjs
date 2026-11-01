#!/usr/bin/env node
/**
 * G-TOOLTIP: a tooltip egerrel, fokusszal es hosszu nyomassal is megjelenik,
 * Esc-re eltunik (a fokusz es a kijeloles nem valtozik), es a mutato
 * viheto ra — WCAG 1.4.13: elvetheto, viheto ra, tartos.
 *
 * Ket forras: a Playwright JSON-riportja (minden allitas-teszt lefutott es
 * zold), es a lap naploja (.tooltip-browser-log.json), amit a bongeszobol
 * olvasott adat irt. Egy hianyzo forras BUKAS, nem kihagyas.
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
  failures.push(`nincs Playwright-riport (${reportFile}) — a tooltip-keszlet NEM futott, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < 4) failures.push(`${String(specs.length)} tooltip-teszt futott, 4 kell`);
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

const logFile = join(docs, ".tooltip-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`nincs bongeszo-naplo (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  if (log.hover?.shown !== true) failures.push("egerre nem jelent meg");
  if (log.focus?.shown !== true) failures.push("fokuszra nem jelent meg");
  if (log.longPress?.shown !== true) failures.push("hosszu nyomasra nem jelent meg");
  if (log.dismiss?.hidden !== true) failures.push("Esc-re nem tunt el");
  if (log.dismiss?.focusKept !== true) failures.push("az Esc elvitte a fokuszt");
  if (log.dismiss?.selectionKept !== true) failures.push("az Esc megvaltoztatta a kijelolest");
  if (log.hoverable?.stayedOnTooltip !== true) failures.push("a mutato nem viheto ra: eltunt, amikor rament");
  if (!(Number(log.hoverable?.heldMs) >= 1000)) failures.push("a tartossag nincs merve (legalabb 1 s a tooltipen)");
  notes.push(`eger: ${JSON.stringify(log.hover?.text ?? "")}; fokusz: ${String(log.focus?.focused)}; hosszu nyomas: ${JSON.stringify(log.longPress?.text ?? "")}`);
}
finish("G-TOOLTIP", failures, notes);
