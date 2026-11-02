#!/usr/bin/env node
/**
 * G-CLUSTER: proves that the sum of the clusters' counts ALWAYS equals the
 * number of visible items — no item is lost.
 *
 * Two independent proofs, both required — a missing report is a FAILURE:
 *
 *  1. THE CORE (packages/core, test/cluster/): hundreds of seeded schedules,
 *     with zoom sequences, panning, lane scrolling and density changes, half
 *     of the time through scene space, with the tile cache. After every step
 *     the clustered frame is read back from the scene and compared with its
 *     unclustered twin: every visible item is represented EXACTLY once, the
 *     marker's count is the cluster's members, and the only surplus is the
 *     far members of a cluster that straddles the culling edge. From the
 *     log: zero problems, and NOT empty (many markers, many reused tiles,
 *     many pan comparisons). The NEGATIVE CONTROLS (a forgetful and a
 *     doubling drawing) must ALWAYS fail on the same checker. Alongside
 *     them: the rules (what clusters, what the marker covers), the tap and
 *     its keyboard twin, the hit test and a11y — in both orientations.
 *  2. THE BROWSER (packages/docs, e2e/cluster.spec.ts): real Chromium, the
 *     shipped bundle, the patching mount. After Ctrl+wheel and drag, in
 *     every step, the markers and items of the LIVE DOM; a tap in Pixel 7
 *     emulation, a click, the keyboard; axe on the clustered page. There is a
 *     negative control here too.
 *
 * The third is STATIC: the core test drives the real renderer and the real
 * scene space (no mocks), and the demo page measures the shipped bundle and
 * the live DOM.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(repoRoot, "packages", "core");
const docs = join(repoRoot, "packages", "docs");
const coreReport = join(core, ".cluster-report.json");
const coreLog = join(core, ".cluster-log.json");
const browserReport = join(docs, ".e2e-cluster-report.json");
const browserLog = join(docs, ".cluster-browser-log.json");
const conservationTest = join(core, "test", "cluster", "conservation.test.ts");
const clusterPage = join(docs, "public", "cluster.html");

/** Claim -> at least one passing test. */
const CORE_CLAIMS = [
  "joins",
  "item-size",
  "breakers",
  "min-count",
  "rows",
  "contiguous",
  "room",
  "zoom-factor",
  "space",
  "negative-control",
];
/** Required in both orientations. */
const ORIENTED_CLAIMS = ["conservation", "marker", "pan-invariant", "off", "tap-zoom", "keyboard-twin", "hit-test", "a11y", "hooks"];
const BROWSER_CLAIMS = [
  "browser-conservation",
  "browser-tap-zoom",
  "browser-click",
  "browser-keyboard",
  "browser-negative-control",
  "browser-axe",
];
const CONTROLS = ["forgetful", "doubling"];
/** The same floors that conservation.test.ts requires. */
const MIN_FRAMES = 10_000;
const MIN_FRAMES_WITH_MARKERS = 1500;
const MIN_MARKERS = 10_000;
const MIN_TAMPERED = 1000;
const MIN_BROWSER_STEPS = 50;

const failures = [];
const notes = [];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// --- 1. The core --------------------------------------------------------------
if (!existsSync(coreReport)) {
  failures.push(`no vitest report (${coreReport}) — the core suite did NOT run, so this is a FAILURE`);
} else {
  const tests = (read(coreReport).testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  if (tests.length === 0) failures.push("the core report has not a single test");
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
  notes.push(`core: ${tests.filter((test) => test.status === "passed").length} passing tests under test/cluster/`);
}

if (!existsSync(coreLog)) {
  failures.push(`no schedule log (${coreLog}) — there is no telling what the checker saw`);
} else {
  const log = read(coreLog);
  for (const orientation of ["horizontal", "vertical"]) {
    const run = log[`conservation:${orientation}`];
    if (run === undefined) {
      failures.push(`missing from the log: conservation:${orientation}`);
      continue;
    }
    if (run.problems !== 0) failures.push(`${orientation}: ${run.problems} problems — ${JSON.stringify(run.firstProblems)}`);
    if (run.frames < MIN_FRAMES) failures.push(`${orientation}: only ${run.frames} frames (at least ${MIN_FRAMES})`);
    if (run.framesWithMarkers < MIN_FRAMES_WITH_MARKERS) {
      failures.push(`${orientation}: only ${run.framesWithMarkers} frames had a marker (at least ${MIN_FRAMES_WITH_MARKERS}) — the measurement is empty`);
    }
    if (run.markers < MIN_MARKERS) failures.push(`${orientation}: only ${run.markers} markers (at least ${MIN_MARKERS})`);
    if (!(run.reusedTiles > run.spacedFrames)) {
      failures.push(`${orientation}: hardly any reused tiles (${run.reusedTiles}/${run.spacedFrames}) — the cache path is not measured`);
    }
    if (!(run.panChecks > run.frames)) failures.push(`${orientation}: too few pan comparisons (${run.panChecks})`);
    if (run.exactFrames + run.straddleFrames !== run.frames) {
      failures.push(`${orientation}: ${run.frames - run.exactFrames - run.straddleFrames} frames sum to neither the visible set nor the visible + straddling members`);
    }
    if (run.sum !== run.visible + run.extras) failures.push(`${orientation}: the sums do not match (${run.sum} != ${run.visible} + ${run.extras})`);
    if (!(run.straddleFrames > 0)) failures.push(`${orientation}: there was not a single straddling cluster — the edge case is not measured`);
    notes.push(
      `core ${orientation}: ${run.schedules} schedules, ${run.frames} frames (${run.spacedFrames} in scene space, ${run.reusedTiles} reused tiles), ${run.markers} markers in ${run.framesWithMarkers} frames; ` +
        `${run.exactFrames} frames sum to EXACTLY the number of visible items, ${run.straddleFrames} to the visible + ${run.extras} straddling members; ${run.panChecks} pan comparisons; 0 problems`,
    );
  }
  for (const name of CONTROLS) {
    const control = log[`control:${name}`];
    if (control === undefined) {
      failures.push(`the negative control is missing from the log: ${name} — the checker's blindness is not ruled out`);
      continue;
    }
    if (!(control.tampered >= MIN_TAMPERED)) failures.push(`${name}: only ${control.tampered} tampered frames (at least ${MIN_TAMPERED})`);
    if (control.caught !== control.tampered) failures.push(`${name}: of ${control.tampered} tampered frames the checker found only ${control.caught} — it may be blind`);
    notes.push(`core negative control (${name}): ${control.caught}/${control.tampered} tampered frames caught (as it should)`);
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
  // A skipped test is a failure here too: every test runs only on its own device.
  for (const result of results.filter((each) => each.status !== "passed")) {
    failures.push(`browser: ${result.status}: ${result.title} [${result.project}]`);
  }
  for (const claim of BROWSER_CLAIMS) {
    if (!results.some((result) => result.status === "passed" && result.title.includes(`[claim:${claim}]`))) {
      failures.push(`no passing test in the browser for: [claim:${claim}]`);
    }
  }
  if (!results.some((result) => result.status === "passed" && result.project === "pixel-7" && result.title.includes("[claim:browser-tap-zoom]"))) {
    failures.push("the tap did not pass on a touch device");
  }
  notes.push(`browser: ${results.filter((result) => result.status === "passed").length}/${results.length} passed`);
}

if (!existsSync(browserLog)) {
  failures.push(`no browser log (${browserLog})`);
} else {
  const log = read(browserLog);
  const run = log.conservation;
  if (run === undefined) {
    failures.push("missing from the browser log: conservation");
  } else {
    if (run.problemCount !== 0) failures.push(`browser: ${run.problemCount} problems — ${JSON.stringify(run.problems)}`);
    if (run.steps < MIN_BROWSER_STEPS) failures.push(`browser: only ${run.steps} steps (at least ${MIN_BROWSER_STEPS})`);
    if (!(run.withMarkers > run.steps / 3)) failures.push(`browser: only ${run.withMarkers}/${run.steps} steps had a marker — the measurement is empty`);
    if (run.sum !== run.visible + run.extras) failures.push(`browser: the sums do not match (${run.sum} != ${run.visible} + ${run.extras})`);
    notes.push(`browser: ${run.steps} steps (Ctrl+wheel, drag), ${run.markers} markers in the live DOM in ${run.withMarkers} steps; ${run.sum} = ${run.visible} visible + ${run.extras} straddling members; 0 problems`);
  }
  const tap = log.tap;
  if (tap === undefined || !(tap.taps?.length >= 2)) {
    failures.push(`browser: opening by tap took fewer than two steps (${JSON.stringify(tap?.taps ?? null)}) — gradual opening is not measured`);
  } else {
    notes.push(`browser tap: clusters of ${tap.taps.map((each) => each.count).join(" → ")} members, then ${tap.target} itself`);
  }
  if (log.axe === undefined || log.axe.violations.length !== 0 || !(log.axe.markers > 0)) {
    failures.push(`browser axe: ${JSON.stringify(log.axe ?? null)}`);
  } else {
    notes.push(`browser axe: 0 violations, ${log.axe.markers} markers as options on the page`);
  }
  if (log.control === undefined || !(log.control.problemCount > 0)) {
    failures.push("the browser negative control found no problem — the DOM checker may be blind");
  } else {
    notes.push(`browser negative control: ${log.control.problemCount} problems on a page that drops an item (as it should)`);
  }
}

// --- 3. Static ------------------------------------------------------------------
const testSource = existsSync(conservationTest) ? readFileSync(conservationTest, "utf8") : "";
for (const needle of ['from "../../src/render.js"', 'from "../../src/scene-space.js"', "renderTimeline(", "planSceneSpace(", "readFrame(", "measure("]) {
  if (!testSource.includes(needle)) failures.push(`the conservation test does not take the real path (missing: ${needle})`);
}
if (/vi\.mock\(|vi\.fn\(/.test(testSource)) failures.push("the conservation test mocks — so it does not measure the renderer");
const page = existsSync(clusterPage) ? readFileSync(clusterPage, "utf8") : "";
for (const needle of ['from "/core/index.mjs"', "mountScene(", "cluster: true", "clusterZoom(", 'querySelectorAll("[data-tl-cluster]")']) {
  if (!page.includes(needle)) failures.push(`the demo page does not measure the shipped bundle or the live DOM (missing: ${needle})`);
}

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nG-CLUSTER FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\nG-CLUSTER: in every frame the sum of the clusters' counts is the number of visible items (with the far members of a cluster straddling the culling edge) — in the core and in the live DOM alike, no item was lost and none showed twice; the checkers can see (the negative controls fail).");
