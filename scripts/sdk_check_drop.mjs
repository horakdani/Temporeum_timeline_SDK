#!/usr/bin/env node
/**
 * G-DROP: in a real browser an external item lands at the time and lane under
 * the pointer (within 2 px), and it has a keyboard equivalent that places it
 * in the focused lane, at the middle of the view.
 *
 * Two sources: the Playwright JSON report (both tests ran and passed), and
 * the page's log (.drop-browser-log.json), written from data read in the
 * browser. A missing source is a FAILURE, not a skip.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "packages", "docs");
const failures = [];
const notes = [];

const reportFile = join(docs, ".e2e-drop-report.json");
if (!existsSync(reportFile)) {
  failures.push(`no Playwright report (${reportFile}) — the drop suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (specs.length < 2) failures.push(`${String(specs.length)} drop tests ran, 2 are required`);
  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
    if (results.length === 0 || results.some((result) => result.status !== "passed")) failures.push(`not passing: ${String(spec.title)}`);
  }
}

const logFile = join(docs, ".drop-browser-log.json");
if (!existsSync(logFile)) {
  failures.push(`no browser log (${logFile})`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const pointer = log.pointer;
  const keyboard = log.keyboard;
  if (pointer === undefined) failures.push("the pointer drop is missing from the log");
  else {
    if (pointer.laneId !== pointer.expectedLane) failures.push(`the dropped item's lane is ${String(pointer.laneId)}, not ${String(pointer.expectedLane)}`);
    if (!(pointer.errorPx <= 2)) failures.push(`the dropped item landed ${String(pointer.errorPx)} px from the pointer (at most 2)`);
    notes.push(`pointer: lane ${String(pointer.laneId)}, off by ${Number(pointer.errorPx).toFixed(2)} px`);
  }
  if (keyboard === undefined) failures.push("the keyboard twin is missing from the log");
  else {
    if (keyboard.laneId === undefined || keyboard.laneId !== keyboard.expectedLane) failures.push(`the keyboard twin's lane is ${String(keyboard.laneId)}, not the focused ${String(keyboard.expectedLane)}`);
    if (!(keyboard.errorMs <= 1)) failures.push(`the keyboard twin landed ${String(keyboard.errorMs)} ms from the middle of the view`);
    notes.push(`keyboard: lane ${String(keyboard.laneId)}, off by ${String(keyboard.errorMs)} ms`);
  }
}
finish("G-DROP", failures, notes);
