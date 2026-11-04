#!/usr/bin/env node
/**
 * The async check: proves that during fast zooming the results of cancelled requests
 * NEVER reach the canvas.
 *
 * Two independent proofs, both required — a missing report is a FAILURE:
 *
 *  1. THE CORE (packages/core, test/async-window/): hundreds of seeded
 *     schedules, with fast zoom sequences, against a hand-answered source that
 *     also answers aborted requests. After every step it reads back the scene
 *     rendered the way a host renders it (the option names carry the request
 *     number), half of the time through scene space, with the tile cache.
 *     From the log: zero leaks, and NOT empty (there were aborted requests
 *     that answered anyway, and there were drawn items). The NEGATIVE CONTROL
 *     (a naive loader that keeps every answer) must leak on the same checker.
 *  2. THE BROWSER (packages/docs, e2e/async.spec.ts): real Chromium, real
 *     timers, fast Ctrl+wheel zoom; a MutationObserver records EVERY option
 *     name ever inserted, not just the final state. Two servers: one that
 *     aborts and one that does not (there the answer really arrives). There
 *     is a negative control here too.
 *
 * The third is STATIC: the core test drives the real loader and the real
 * renderer (no mocks), and the demo page uses the shipped bundle's loader.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(repoRoot, "packages", "core");
const docs = join(repoRoot, "packages", "docs");
const coreReport = join(core, ".async-window-report.json");
const coreLog = join(core, ".async-window-log.json");
const browserReport = join(docs, ".e2e-async-report.json");
const browserLog = join(docs, ".async-browser-log.json");
const noStaleTest = join(core, "test", "async-window", "no-stale.test.ts");
const asyncPage = join(docs, "public", "async.html");

/** Claim -> how many passing tests it requires (per orientation, where there are two). */
const CORE_CLAIMS = [
  "windows-nest",
  "zoom-in-reuse",
  "abort-on-leave",
  "discard-late",
  "failure-retry",
  "merge",
  "evict",
  "apply-replay",
  "invalidate",
  "array-source",
  "destroy",
  "reduced-motion",
  "negative-control",
];
/** Required in both orientations. */
const ORIENTED_CLAIMS = ["axis-mark", "aria-busy", "no-stale"];
const BROWSER_CLAIMS = [
  "browser-no-stale",
  "browser-negative-control",
  "browser-loading-mark",
  "browser-reduced-motion",
  "browser-failure",
];
const MIN_SCHEDULES = 100;
const MIN_FRAMES = 10_000;

const failures = [];
const notes = [];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// --- 1. The core --------------------------------------------------------------
if (!existsSync(coreReport)) {
  failures.push(`no vitest report (${coreReport}) — the core suite did NOT run, so this is a FAILURE`);
} else {
  const tests = (read(coreReport).testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  for (const test of tests.filter((each) => each.status === "failed")) failures.push(`failed: ${test.fullName}`);
  for (const test of tests.filter((each) => each.status !== "passed" && each.status !== "failed")) {
    failures.push(`did not run (${test.status}): ${test.fullName}`);
  }
  const green = (claim, orientation) =>
    tests.some(
      (test) =>
        test.status === "passed" &&
        test.title.includes(`[claim:${claim}]`) &&
        (orientation === undefined ||
          test.title.includes(orientation) ||
          (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`))),
    );
  for (const claim of CORE_CLAIMS) {
    if (!green(claim)) failures.push(`no passing test in the core for: [claim:${claim}]`);
  }
  for (const claim of ORIENTED_CLAIMS) {
    for (const orientation of ["horizontal", "vertical"]) {
      if (!green(claim, orientation)) failures.push(`no passing test in the core for: [claim:${claim}] ${orientation}`);
    }
  }
  notes.push(`core: ${tests.filter((test) => test.status === "passed").length} passing tests under test/async-window/`);
}

if (!existsSync(coreLog)) {
  failures.push(`no schedule log (${coreLog}) — there is no telling what the checker saw`);
} else {
  const log = read(coreLog);
  for (const orientation of ["horizontal", "vertical"]) {
    const run = log[`loader:${orientation}`];
    if (run === undefined) {
      failures.push(`missing from the log: loader:${orientation}`);
      continue;
    }
    if (run.leaks !== 0) failures.push(`${orientation}: ${run.leaks} leaks — ${JSON.stringify(run.firstLeaks)}`);
    if (run.schedules < MIN_SCHEDULES) failures.push(`${orientation}: only ${run.schedules} schedules (at least ${MIN_SCHEDULES})`);
    if (run.frames < MIN_FRAMES) failures.push(`${orientation}: only ${run.frames} frames (at least ${MIN_FRAMES})`);
    if (!(run.answeredAfterAbort >= run.schedules)) {
      failures.push(`${orientation}: hardly any aborted request answered anyway (${run.answeredAfterAbort}) — the measurement is empty`);
    }
    if (!(run.drawn > run.frames)) failures.push(`${orientation}: hardly any items were drawn (${run.drawn}) — the measurement is empty`);
    notes.push(
      `core ${orientation}: ${run.schedules} schedules, ${run.frames} frames, ${run.zoomSteps} zoom steps, ${run.fetches} requests, ${run.aborted} of them aborted, ${run.answeredAfterAbort} answered anyway; ${run.drawn} drawn item names, 0 leaks`,
    );
  }
  const control = log.control;
  if (control === undefined) {
    failures.push("the negative control is missing from the log — the checker's blindness is not ruled out");
  } else {
    if (!(control.schedulesWithLeaks > control.schedules / 2)) {
      failures.push(`the negative control leaked in only ${control.schedulesWithLeaks}/${control.schedules} schedules — the checker may be blind`);
    }
    notes.push(`core negative control: found ${control.leaks} leaks in ${control.schedulesWithLeaks}/${control.schedules} schedules (as it should)`);
  }
}

// --- 2. The browser -----------------------------------------------------------
if (!existsSync(browserReport)) {
  failures.push(`no Playwright report (${browserReport}) — the browser suite did NOT run, so this is a FAILURE`);
} else {
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        results.push({ title: spec.title, project: test.projectName, status: test.results?.at(-1)?.status ?? "missing" });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of read(browserReport).suites ?? []) walk(suite);
  for (const result of results.filter((each) => each.status !== "passed")) {
    failures.push(`browser: ${result.status}: ${result.title} [${result.project}]`);
  }
  for (const claim of BROWSER_CLAIMS) {
    if (!results.some((result) => result.status === "passed" && result.title.includes(`[claim:${claim}]`))) {
      failures.push(`no passing test in the browser for: [claim:${claim}]`);
    }
  }
  notes.push(`browser: ${results.filter((result) => result.status === "passed").length}/${results.length} passed`);
}

if (!existsSync(browserLog)) {
  failures.push(`no browser log (${browserLog})`);
} else {
  const log = read(browserLog);
  for (const mode of ["abort", "ignore-abort"]) {
    const run = log[mode];
    if (run === undefined) {
      failures.push(`missing from the browser log: ${mode}`);
      continue;
    }
    if (run.leaks.length !== 0) failures.push(`browser ${mode}: leaks — ${run.leaks.slice(0, 3).join("; ")}`);
    if (!(run.aborted > 5)) failures.push(`browser ${mode}: only ${run.aborted} aborted requests — the fast zoom was not fast`);
    if (!(run.namesSeen > 50)) failures.push(`browser ${mode}: only ${run.namesSeen} names seen — the measurement is empty`);
    if (mode === "ignore-abort" && !(run.answeredAfterAbort > 5)) {
      failures.push(`browser ignore-abort: only ${run.answeredAfterAbort} aborted requests answered — the hard case did not occur`);
    }
    notes.push(
      `browser ${mode}: ${run.requests} requests, ${run.aborted} aborted, ${run.answeredAfterAbort} answered anyway, ${run.namesSeen} distinct names seen in ${run.draws} draws, 0 leaks`,
    );
  }
  const control = log.control;
  if (control === undefined || !(control.leaks > 0)) {
    failures.push("the browser negative control found no leak — the MutationObserver checker may be blind");
  } else {
    notes.push(`browser negative control: ${control.leaks} leaking names (as it should)`);
  }
}

// --- 3. Static ------------------------------------------------------------------
const testSource = existsSync(noStaleTest) ? readFileSync(noStaleTest, "utf8") : "";
for (const needle of ['from "../../src/data.js"', 'from "../../src/render.js"', "renderTimeline(", "fetchesShown(", "planSceneSpace("]) {
  if (!testSource.includes(needle)) failures.push(`the no-stale test does not take the real path (missing: ${needle})`);
}
if (/vi\.mock\(|vi\.fn\(/.test(testSource)) failures.push("the no-stale test mocks — so it does not measure the loader's behaviour");
const page = existsSync(asyncPage) ? readFileSync(asyncPage, "utf8") : "";
if (!page.includes('from "/core/index.mjs"') || !page.includes("createItemLoader({ source })") || !page.includes("MutationObserver")) {
  failures.push("the demo page does not use the shipped loader, or does not watch the DOM");
}

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nasync FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\nasync: during fast zoom no item of a cancelled request reached the canvas — neither in the core nor in a real browser, and both checkers can see (the negative controls leak).");
