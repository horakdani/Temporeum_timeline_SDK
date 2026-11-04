#!/usr/bin/env node
/**
 * The responsive check: proves that at 320 / 375 / 768 / 1440 px the orientation and the
 * density switch to the EXPECTED values, and there is no horizontal page
 * scroll — in a real browser, on the SHIPPED package.
 *
 * This check could lie about itself in three ways, and each one is locked:
 *
 *  1. the suite computes its own expectation from the code under test — then
 *     it always agrees with it. So the table must be WRITTEN OUT in the spec
 *     (width, orientation, density), and the spec may not import from the core;
 *  2. the page uses its own breakpoint, and the core's decision never runs in
 *     the browser — then the check measures the page, not the library. So the
 *     page must decide through the core's resolveOrientation / fitDensity /
 *     resolveDetailSurface / observeSize functions, and may not contain its
 *     own 640 or matchMedia;
 *  3. the decision is made at load time, and a rotated phone stays in the
 *     old projection. So the claim about LIVE resizing is mandatory, and so
 *     is its hysteresis.
 *
 * Plus what holds for every browser check: a missing report, or a skipped,
 * flaky or retried test FAILS.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsPackage = join(repoRoot, "packages", "docs");
const reportFile = join(docsPackage, ".e2e-responsive-report.json");
const configFile = join(docsPackage, "playwright.responsive.config.ts");
const specFile = join(docsPackage, "e2e", "responsive.spec.ts");
const pageFile = join(docsPackage, "public", "responsive.html");
const serverFile = join(docsPackage, "e2e", "serve.mjs");

const WIDTHS = [320, 375, 768, 1440];
const MIN_TESTS = 22;
/** Required claims per width; `{w}` is replaced by the width. The strings match the spec's test titles. */
const PER_WIDTH_CLAIMS = ["{w} px: ", "{w} px: no horizontal page scroll", "{w} px: the detail"];
/** Required claims independent of width (matched against the spec's test titles). */
const REQUIRED_CLAIMS = [
  "live resizing",
  "without a reload",
  "hysteresis",
  "bottom sheet closes with its own button",
  "2 px moment can be hit",
  "by mouse at the same spot it cannot",
  "explicit orientation overrides",
  "popover closes",
  // WCAG 1.4.10 and 1.4.4 on the element (public/a11y.html), and 2.4.11 under the sheet: the conformance report cites these.
  "320 px reflow",
  "256 px tall reflow",
  "page zoom 200%",
  "the bottom sheet never hides the focused item",
];
/** The contract. It must appear WRITTEN OUT in the spec, not computed. */
const CONTRACT = [
  { width: 320, orientation: "vertical", density: "dense", surface: "sheet" },
  { width: 375, orientation: "vertical", density: "dense", surface: "sheet" },
  { width: 768, orientation: "horizontal", density: "compact", surface: "popover" },
  { width: 1440, orientation: "horizontal", density: "comfortable", surface: "popover" },
];
/** The page must decide through these — from the core, not its own code. */
const CORE_DECISIONS = ["resolveOrientation", "fitDensity", "resolveDensity", "resolveDetailSurface"];
const DOM_BINDINGS = ["observeSize", "openDetail", "attachInput"];

const failures = [];
const notes = [];

const codeOf = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// --- 1. RUNTIME ---------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`no e2e report (${reportFile}) — the responsive suite did NOT run, so this FAILS`);
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
  for (const [key, label] of [
    ["unexpected", "failed"],
    ["flaky", "flaky"],
    ["skipped", "skipped"],
  ]) {
    if (Number(stats[key] ?? 0) > 0) {
      failures.push(`${String(stats[key])} ${label} e2e tests — this FAILS, it is not neutral`);
    }
  }
  const green = [];
  for (const spec of specs) {
    const ok = (spec.tests ?? []).length > 0 && spec.tests.every((test) => test.status === "expected");
    if (!ok) {
      failures.push(`e2e test not passing: ${String(spec.title)}`);
    } else {
      green.push(String(spec.title).toLowerCase());
    }
  }
  for (const width of WIDTHS) {
    for (const template of PER_WIDTH_CLAIMS) {
      const claim = template.replace("{w}", String(width)).toLowerCase();
      if (!green.some((title) => title.includes(claim))) {
        failures.push(`no passing test for: "${claim.trim()}"`);
      }
    }
  }
  for (const claim of REQUIRED_CLAIMS) {
    if (!green.some((title) => title.includes(claim.toLowerCase()))) {
      failures.push(`the check claims something nobody measures in the browser: "${claim}"`);
    }
  }
  for (const project of report.config?.projects ?? []) {
    if (Number(project.retries ?? 0) > 0) {
      failures.push(`the ${String(project.name)} project retries — that hides flakiness`);
    }
  }
  if (failures.length === 0) {
    notes.push(`${String(specs.length)} browser tests, all passing, at ${WIDTHS.join(" / ")} px`);
  }
}

// --- 2. STATIC: a written contract, not a computed one ------------------------

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (spec === "") {
  failures.push(`no responsive suite: ${specFile}`);
} else {
  if (/from\s*["'][^"']*(core|timeline-core)[^"']*["']/.test(spec)) {
    failures.push("the spec imports from the core — it would compute its own expectation from the code under test");
  }
  for (const row of CONTRACT) {
    const pattern = new RegExp(
      `width:\\s*${String(row.width)}\\b[^}]*orientation:\\s*"${row.orientation}"[^}]*density:\\s*"${row.density}"[^}]*surface:\\s*"${row.surface}"`,
    );
    if (!pattern.test(spec)) {
      failures.push(
        `not written out in the spec's contract table: ${String(row.width)} px -> ${row.orientation} / ${row.density} / ${row.surface}`,
      );
    }
  }
  if (!/setViewportSize\(/.test(spec)) {
    failures.push("the spec never resizes a live page — the decision could then come from the size at load time");
  }
  if (failures.length === 0) {
    notes.push("the contract is written out in the spec, and the spec does not ask the core for it");
  }
}

const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
if (config === "") {
  failures.push(`no responsive config: ${configFile}`);
} else {
  if (!/retries:\s*0/.test(config)) {
    failures.push("the responsive config does not rule out retries");
  }
  if (!/reuseExistingServer:\s*false/.test(config)) {
    failures.push("the responsive config would accept a foreign server");
  }
  if (!/\.e2e-responsive-report\.json/.test(config)) {
    failures.push("the responsive report does not go to its own file — it could overwrite the touch report");
  }
}

// --- 3. STATIC: the page decides through the core ----------------------------

const page = existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "";
if (page === "") {
  failures.push(`no responsive demo page: ${pageFile}`);
} else {
  const code = codeOf(page);
  if (!/from\s*"\/core\/index\.mjs"/.test(code) || !/from\s*"\/core\/dom\.mjs"/.test(code)) {
    failures.push("the responsive page does not import from the package served under `/core/`");
  }
  for (const name of [...CORE_DECISIONS, ...DOM_BINDINGS]) {
    if (!new RegExp(`\\b${name}\\(`).test(code)) {
      failures.push(`the page does not call the core's ${name}() — it makes the decision itself`);
    }
  }
  if (/\b640\b/.test(code) || /matchMedia/.test(code) || /new\s+ResizeObserver/.test(code)) {
    failures.push(
      "the page has its own breakpoint, matchMedia or its own ResizeObserver — measuring and deciding belong to the library",
    );
  }
  if (failures.length === 0) {
    notes.push("the page runs on the core's decisions and bindings, without its own breakpoint");
  }
}

const server = existsSync(serverFile) ? readFileSync(serverFile, "utf8") : "";
if (!/"core",\s*"dist"/.test(server)) {
  failures.push("the server does not serve dist under `/core/`");
}

// --- Result -------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}
if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\nresponsive FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}
console.log(
  "\nresponsive passed: the expected projection at 320 / 375 / 768 / 1440 px, with live resizing, without horizontal scroll.",
);
