#!/usr/bin/env node
/**
 * The axe check: proves that axe found 0 violations in EVERY measured state of the
 * pages, with the WCAG 2.2 AA tags, in a real browser — and that the harness
 * is not blind.
 *
 * An axe check can lie in three ways, and each has its own check against it:
 *
 *  1. axe does not run, or runs with the wrong tags (e.g. only wcag2a), and
 *     zero violations means nothing. -> Every run in the results file carries
 *     the exact tag set, the version, and at least 10 passing rules.
 *  2. axe only sees the initial state, or only the demo pages. Every page and
 *     live example of the docs site is required too, per its manifest.
 *     axe only sees the initial state. Focus, selection and the dialog are
 *     exactly the states where ARIA bugs live. -> Every required state must
 *     be present, in the required project.
 *  3. The harness is blind: it would find nothing even on a broken page. ->
 *     The NEGATIVE CONTROL runs with the same harness, and it MUST find three
 *     known bugs (an aria-activedescendant that points nowhere, an orphan
 *     option, a button without a name).
 *
 * The fourth is contrast: axe cannot decide the contrast of SVG text
 * (incomplete). SVG text belongs to the core token test
 * (packages/core/test/a11y/contrast.test.ts, part of the unit tests); HTML text that
 * axe did not decide is measured by the spec from the computed colours, and
 * it must be above 4.5:1. Any other incomplete result is a FAILURE.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repoRoot, "packages", "docs");
const reportFile = join(docs, ".e2e-a11y-report.json");
const resultsFile = join(docs, ".axe-results.json");
const specFile = join(docs, "e2e", "a11y.spec.ts");
const pageFile = join(docs, "public", "index.html");
const responsiveFile = join(docs, "public", "responsive.html");
const serverFile = join(docs, "e2e", "serve.mjs");
const contrastTest = join(repoRoot, "packages", "core", "test", "a11y", "contrast.test.ts");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MIN_PASSES = 10;
/** State -> the projects in which it is required. */
const REQUIRED_STATES = {
  "index:initial": ["desktop", "pixel-7"],
  "index:vertical": ["desktop", "pixel-7"],
  "index:focused": ["desktop"],
  "index:selected": ["desktop"],
  "index:multi": ["desktop"],
  "index:jump-dialog": ["desktop"],
  "index:dark-edited": ["desktop"],
  "responsive:initial": ["desktop", "pixel-7"],
  "responsive:detail-popover": ["desktop"],
  "responsive:detail-sheet": ["pixel-7"],
  // In the reader's own palette, light and dark (forced colours).
  "index:forced-colors-light": ["desktop"],
  "index:forced-colors-dark": ["desktop"],
};
const CONTROL_FINDINGS = ["aria-valid-attr-value", "aria-required-parent", "button-name"];
/** The claims of the keyboard path (the spec's titles), in the desktop project. */
const REQUIRED_CLAIMS = [
  "Tab onto the timeline",
  "Alt+arrow moves",
  "the host's rule holds for the keyboard too",
  "g, date, Enter",
  "Esc releases",
  "does not scroll the page",
  "reduced-motion: paging arrives in one frame",
  "a change of the media setting",
  "NEGATIVE CONTROL",
  // What axe cannot judge (WCAG 1.4.12, 1.4.4, 1.4.11, 2.4.7): the conformance report cites these.
  "text spacing (1.4.12): on the demo",
  "text spacing (1.4.12): on the element",
  "NEGATIVE CONTROL: text spacing",
  "text-only enlargement (1.4.4)",
  "forced colours, light",
  "forced colours, dark",
  "the focus outline is drawn inside the timeline",
];

const failures = [];
const notes = [];

// --- 1. The Playwright report ------------------------------------------------
if (!existsSync(reportFile)) {
  failures.push(`no Playwright report (${reportFile}) — the suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const results = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) {
        const last = run.results?.at(-1);
        results.push({ title: [...trail, spec.title].join(" › "), project: run.projectName, status: last?.status ?? "none" });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  const failed = results.filter((r) => r.status !== "passed" && r.status !== "skipped");
  for (const r of failed) failures.push(`[${r.project}] ${r.title}: ${r.status}`);
  for (const claim of REQUIRED_CLAIMS) {
    const hit = results.find((r) => r.project === "desktop" && r.title.includes(claim) && r.status === "passed");
    if (hit === undefined) failures.push(`no passing test in the desktop project for: "${claim}"`);
  }
  // Only the keyboard tests may be skipped, and only on the phone.
  for (const r of results.filter((r) => r.status === "skipped")) {
    if (r.project !== "pixel-7") failures.push(`skipped test in the desktop project: ${r.title}`);
  }
  notes.push(`${results.filter((r) => r.status === "passed").length} passed, ${results.filter((r) => r.status === "skipped").length} skipped (keyboard on the phone)`);
}

// --- 2. The axe results -----------------------------------------------------
if (!existsSync(resultsFile)) {
  failures.push(`no axe results file (${resultsFile}) — axe did NOT run, so this is a FAILURE`);
} else {
  const runs = readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const real = runs.filter((run) => !run.control);
  const controls = runs.filter((run) => run.control);
  const versions = new Set(runs.map((run) => run.version));
  if (versions.size !== 1 || [...versions][0] === undefined) failures.push(`the axe version is ambiguous: ${[...versions].join(", ")}`);
  for (const run of real) {
    const where = `[${run.project}] ${run.state}`;
    if (JSON.stringify(run.tags) !== JSON.stringify(TAGS)) failures.push(`${where}: the tags are not the WCAG 2.2 AA set: ${JSON.stringify(run.tags)}`);
    if (run.violations.length > 0) failures.push(`${where}: ${run.violations.length} violations: ${run.violations.map((v) => v.id).join(", ")}`);
    if (run.passes.length < MIN_PASSES) failures.push(`${where}: only ${run.passes.length} rules passed — axe barely saw anything`);
    const other = run.incomplete.filter((rule) => rule.id !== "color-contrast");
    if (other.length > 0) failures.push(`${where}: undecided rule: ${other.map((rule) => rule.id).join(", ")}`);
    for (const node of run.undecided ?? []) {
      if (!node.svg && !(node.ratio >= 4.5)) failures.push(`${where}: the HTML text contrast is ${String(node.ratio)} < 4.5: ${node.target}`);
    }
  }
  for (const [state, projects] of Object.entries(REQUIRED_STATES)) {
    for (const project of projects) {
      if (!real.some((run) => run.state === state && run.project === project)) failures.push(`axe did not see this state: [${project}] ${state}`);
    }
  }
  // The docs site: every page and every live example, in both projects. The
  // list is the builder's manifest, not this file: a new page is required automatically.
  const siteManifest = join(docs, "dist", "site-manifest.json");
  if (!existsSync(siteManifest)) {
    failures.push("no dist/site-manifest.json — the docs site was not built, axe could not see it: FAILURE");
  } else {
    const site = JSON.parse(readFileSync(siteManifest, "utf8"));
    const wanted = [...site.pages.map((page) => `site:${page.id}`), ...site.examples.map((example) => `site-example:${example.id}`)];
    for (const state of wanted) {
      for (const project of ["desktop", "pixel-7"]) {
        if (!real.some((run) => run.state === state && run.project === project)) failures.push(`axe did not see this part of the docs site: [${project}] ${state}`);
      }
    }
    notes.push(`docs site: ${String(site.pages.length)} pages and ${String(site.examples.length)} live examples, in both projects`);
  }
  for (const project of ["desktop", "pixel-7"]) {
    const control = controls.find((run) => run.project === project);
    if (control === undefined) {
      failures.push(`[${project}] no negative control — there is no telling whether the harness can see`);
      continue;
    }
    const found = control.violations.map((v) => v.id);
    for (const id of CONTROL_FINDINGS) {
      if (!found.includes(id)) failures.push(`[${project}] axe did NOT find on the negative control: ${id} — the harness is blind`);
    }
  }
  const svgUndecided = real.reduce((sum, run) => sum + (run.undecided ?? []).filter((node) => node.svg).length, 0);
  const htmlUndecided = real.reduce((sum, run) => sum + (run.undecided ?? []).filter((node) => !node.svg).length, 0);
  notes.push(`axe ${[...versions][0]}: ${real.length} states with 0 violations, ${controls.length} negative controls with findings`);
  notes.push(`contrast axe did not decide: ${svgUndecided} SVG nodes (left to the token test), ${htmlUndecided} HTML nodes measured >= 4.5`);
}

// --- 3. Static: what we measure -----------------------------------------------
const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (!spec.includes('require.resolve("axe-core/axe.min.js")')) failures.push("the spec does not inject the installed axe-core");
const docsManifest = JSON.parse(readFileSync(join(docs, "package.json"), "utf8"));
if (docsManifest.devDependencies?.["axe-core"] === undefined) failures.push("axe-core is not among the docs devDependencies");
const server = readFileSync(serverFile, "utf8");
if (!/core.*dist/.test(server)) failures.push("the server's /core/ route does not point to dist — we would not be measuring the shipped package");
for (const file of [pageFile, responsiveFile]) {
  const page = readFileSync(file, "utf8");
  if (!page.includes("focusedId: machine.focusedId") || !page.includes("createNavigator(")) {
    failures.push(`${file}: the page is not wired to the keyboard — axe would measure half a page`);
  }
}
if (!existsSync(contrastTest)) failures.push("the core contrast test is missing: so nobody measures the contrast of SVG text");

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\naxe FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\naxe: 0 axe violations at WCAG 2.2 AA, in every measured state; the negative control finds its bugs.");
