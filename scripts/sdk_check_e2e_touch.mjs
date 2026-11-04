#!/usr/bin/env node
/**
 * The e2e-touch check: proves that the browser suite really ran — with real touch,
 * device emulation, and on the SHIPPED package.
 *
 * This check lies about itself most easily. In three ways:
 *
 *  1. not a single test runs, and "0 passed" is exit 0 too (Playwright does
 *     fail without `--pass-with-no-tests`, but next to an empty file the
 *     suite quietly withers away);
 *  2. the tests run, but in a desktop browser, without touch — and then we
 *     did not measure exactly what the check exists for;
 *  3. the page loads the SOURCE, not dist, and then the bundle's bugs stay
 *     invisible (a lesson learned the hard way, with a check of its own).
 *
 * So: every required claim must pass in the report, the project uses device
 * emulation (with touch), and the `/core/` served is dist.
 *
 * A FOURTH way, which this check once did NOT notice, and it was its own
 * fault: its `proof` field claimed "real tap/drag/long-press", but long-press
 * was not among the required claims — so the check passed a suite that did
 * not even measure a third of its own promise. A check whose claim list is
 * narrower than its proof is worth exactly what is on the list. The list now
 * holds the editing claims too, and the static half requires the two things
 * a title cannot reveal: that the hold happens with a REAL clock (that is
 * what makes the binding's timer prove anything), and that the same page is
 * driven with a mouse too (that is what makes the hybrid-device claim
 * measured, not merely stated).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsPackage = join(repoRoot, "packages", "docs");
const reportFile = join(docsPackage, ".e2e-touch-report.json");
const configFile = join(docsPackage, "playwright.config.ts");
const serverFile = join(docsPackage, "e2e", "serve.mjs");
const pageFile = join(docsPackage, "public", "index.html");
const specFile = join(docsPackage, "e2e", "touch.spec.ts");

const MIN_TESTS = 15;
/**
 * The check's proof. Each one needs a passing test.
 *
 * The first six are the gestures, the rest are editing. The long-press
 * claim is listed on its own because the proof already claimed it, but the
 * list did not ask for it — and then nobody measured it.
 */
const REQUIRED_CLAIMS = [
  "pans",
  "touch-action",
  "TAKES the gesture",
  "pinch",
  "double tap",
  "two-finger tap",
  "long press",
  "WITHOUT a hold",
  "the mouse on the same page drags at once",
  "handle",
  "host's rule",
  "locked item",
  "undo",
  "tap selects",
];

const failures = [];
const notes = [];

// --- 1. RUNTIME ---------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`no e2e report (${reportFile}) — the browser suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const stats = report.stats ?? {};
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      specs.push(spec);
    }
    for (const child of suite.suites ?? []) {
      walk(child);
    }
  };
  for (const suite of report.suites ?? []) {
    walk(suite);
  }

  if (specs.length < MIN_TESTS) {
    failures.push(`${String(specs.length)} e2e tests ran, but at least ${String(MIN_TESTS)} are required`);
  }
  if (Number(stats.unexpected ?? 0) > 0) {
    failures.push(`${String(stats.unexpected)} failed e2e tests`);
  }
  if (Number(stats.flaky ?? 0) > 0) {
    failures.push(
      `${String(stats.flaky)} flaky e2e tests — an uncertain proof is no proof`,
    );
  }
  if (Number(stats.skipped ?? 0) > 0) {
    failures.push(`${String(stats.skipped)} skipped e2e tests — a skip is a FAILURE, not neutral`);
  }
  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      if (test.status !== "expected") {
        failures.push(`failing e2e test: ${String(spec.title)} (${String(test.status)})`);
      }
    }
  }
  const titles = specs.map((spec) => String(spec.title).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    if (!titles.some((title) => title.includes(claim.toLowerCase()))) {
      failures.push(`the check claims something nobody measures in the browser: "${claim}"`);
    }
  }
  const projects = report.config?.projects ?? [];
  if (projects.length === 0) {
    failures.push("the report names no project — we do not know what it ran on");
  }
  for (const project of projects) {
    if (Number(project.retries ?? 0) > 0) {
      failures.push(
        `the ${String(project.name)} project retries (${String(project.retries)}) — that hides a flaky gesture`,
      );
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(specs.length)} browser tests, all passing, on ${String(projects.length)} devices: ` +
        projects.map((project) => project.name).join(", "),
    );
  }
}

// --- 2. STATIC: real device, real package --------------------------------------

const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
if (config === "") {
  failures.push(`no Playwright config: ${configFile}`);
} else {
  if (!/devices\[/.test(config)) {
    failures.push(
      "the config does not use device emulation (`devices[...]`) — a desktop browser has no touch",
    );
  }
  if (!/retries:\s*0/.test(config)) {
    failures.push("the config does not rule out retries");
  }
}

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (spec === "") {
  failures.push(`no browser suite: ${specFile}`);
} else {
  if (!/waitForTimeout\(/.test(spec)) {
    failures.push(
      "the suite never waits on a real clock — that is the only way to measure a long press, " +
        "and without it we have claimed nothing about the binding's timer",
    );
  }
  if (!/page\.mouse\./.test(spec)) {
    failures.push(
      "the suite does not drive the page with a mouse — a touchscreen device has a mouse too, " +
        "and the question is exactly whether the two get mixed up",
    );
  }
  if (failures.length === 0) {
    notes.push("the hold runs on a real clock, and the same page is driven with a mouse too");
  }
}

const page = existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "";
if (page === "") {
  failures.push(`no demo page: ${pageFile}`);
} else if (!/from\s*"\/core\/index\.mjs"/.test(page) || !/from\s*"\/core\/dom\.mjs"/.test(page)) {
  failures.push("the demo page does not import from the package served under `/core/`");
}

const server = existsSync(serverFile) ? readFileSync(serverFile, "utf8") : "";
if (server === "") {
  failures.push(`no static server: ${serverFile}`);
} else if (!/"core",\s*"dist"/.test(server)) {
  failures.push(
    "the server does not serve dist under `/core/` — the SHIPPED package must run in the browser",
  );
} else {
  notes.push("the browser runs the shipped dist, not the source");
}

// --- Result ------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\ne2e-touch FAILED: ${String(failures.length)} problems.`);
  process.exit(1);
}

console.log("\ne2e-touch passed: real tap, drag and pinch on an emulated touchscreen.");
