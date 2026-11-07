#!/usr/bin/env node
/**
 * The bench-field check: every number on the field benchmark page comes from
 * results.json, both workloads ran in all three browsers, and the list of what
 * goes over the frame budget is built from the data, not by hand.
 *
 *  1. IT RAN. packages/docs/site/benchmark/field/results.json exists, is not
 *     a smoke run (`smoke`), and holds the three browsers with their
 *     versions; both workloads (timeline, gantt) carry, for every size and
 *     browser, the load, pan and zoom metrics (with as many samples as
 *     repetitions), the heap in Chromium; and the bytes of both pages.
 *  2. THE NUMBERS. Every `data-field` cell of the built
 *     packages/docs/dist/benchmark-field.html is exactly the matching median
 *     in results.json (with the page's formatting), and every row of
 *     results.json appears in a cell. The page's Markdown source has no
 *     digits outside the generated blocks: no hand-written number can reach
 *     the page.
 *  3. THE LIST. The items of the "over the budget" list (`data-over-item`)
 *     are exactly the pans and zooms this checker computes from the data with
 *     its OWN code (with the same budget the page states); the stated count
 *     matches too.
 *  4. NEGATIVE CONTROL. A hand-edited cell and a forged list fail on this
 *     same checker.
 *
 * Prerequisite: sdk_bench_browsers.mjs has run, and the docs build after it
 * (`npm run bench:field` runs them in this order).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const resultsFile = join(docs, "site", "benchmark", "field", "results.json");
const pageFile = join(docs, "dist", "benchmark-field.html");
const sourceFile = join(docs, "site", "pages", "benchmark-field.md");
const failures = [];
const notes = [];

const WORKLOADS = ["timeline", "gantt"];
const BROWSERS = ["chromium", "firefox", "webkit"];
const METRICS = ["first-render", "dom-elements-after-load", "item-nodes-after-load", "visible-items-after-load", "pan-missed-frames", "pan-p95-frame", "zoom-missed-frames", "zoom-p95-frame", "zoom-peak-factor"];
// The budget of our own computation — the same one the page states in its method table; if either changes, this fails.
const BUDGET = { percent: 5, metrics: ["pan-missed-frames", "zoom-missed-frames"] };

const fmt = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
};
const keyOf = (row) => [row.library, row.workload ?? "", row.browser ?? "", String(row.n ?? ""), row.metric].join("|");
const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Our own "over the budget" computation. */
function overBudget(data) {
  return data.results.filter((row) => BUDGET.metrics.includes(row.metric) && row.median > BUDGET.percent).map(keyOf).sort();
}

/** The page's cells and list items. */
function readPage(html) {
  const cells = new Map([...html.matchAll(/data-field="([^"]+)"><span class="median">([^<]*)<\/span>/g)].map((match) => [unescape(match[1]), match[2]]));
  const listed = [...html.matchAll(/data-over-item="([^"]+)"/g)].map((match) => unescape(match[1])).sort();
  const stated = /data-over="(\d+)"/.exec(html)?.[1];
  return { cells, listed, stated: stated === undefined ? null : Number(stated) };
}

/** Where the page and the data differ. */
export function judgePage(data, page) {
  const problems = [];
  for (const row of data.results) {
    const cell = page.cells.get(keyOf(row));
    if (cell === undefined) problems.push(`no cell on the page for: ${keyOf(row)}`);
    else if (cell !== fmt(row.median)) problems.push(`${keyOf(row)}: the page says ${cell}, results.json says ${fmt(row.median)}`);
  }
  for (const key of page.cells.keys()) if (!data.results.some((row) => keyOf(row) === key)) problems.push(`the page shows a cell that is not in results.json: ${key}`);
  const expected = overBudget(data);
  if (JSON.stringify(expected) !== JSON.stringify(page.listed)) {
    const missing = expected.filter((key) => !page.listed.includes(key));
    const extra = page.listed.filter((key) => !expected.includes(key));
    problems.push(`the "over the budget" list does not come from the data: missing ${JSON.stringify(missing.slice(0, 4))}, extra ${JSON.stringify(extra.slice(0, 4))}`);
  }
  if (page.stated !== expected.length) problems.push(`the page states ${String(page.stated)} over the budget, the data gives ${String(expected.length)}`);
  return problems;
}

// --- 1. it ran --------------------------------------------------------------------------
if (!existsSync(resultsFile)) {
  failures.push("no site/benchmark/field/results.json — the field benchmark did NOT run, so this is a FAILURE");
} else {
  const data = JSON.parse(readFileSync(resultsFile, "utf8"));
  if (data.smoke) failures.push("results.json is the output of a smoke run, not a measurement");
  const reps = data.settings?.repetitions ?? 0;
  if (reps < 3) failures.push(`only ${String(reps)} repetitions, at least 3 are required`);
  if (typeof data.libraries?.temporeum?.version !== "string") failures.push("temporeum: no version");
  const others = Object.keys(data.libraries ?? {}).filter((library) => library !== "temporeum");
  if (others.length > 0) failures.push(`results.json measures other libraries too: ${others.join(", ")}`);
  for (const browser of BROWSERS) if (typeof data.browsers?.[browser] !== "string") failures.push(`${browser} did not run (no version in results.json)`);
  for (const workload of WORKLOADS) {
    if (data.capabilities?.[workload]?.wheelZoom !== true) failures.push(`${workload}: the page does not zoom on ctrl + wheel`);
    for (const browser of BROWSERS) {
      for (const n of data.settings?.ns?.[workload] ?? []) {
        for (const metric of [...METRICS, ...(browser === "chromium" ? ["heap-after-load", "heap-after-pan"] : [])]) {
          const row = data.results.find((each) => each.library === "temporeum" && each.workload === workload && each.browser === browser && each.n === n && each.metric === metric);
          if (row === undefined) failures.push(`missing: ${workload} ${browser} n=${String(n)} ${metric}`);
          else if (row.samples.length < reps) failures.push(`${workload} ${browser} n=${String(n)} ${metric}: ${String(row.samples.length)} samples, ${String(reps)} required`);
        }
      }
    }
    if (!data.results.some((row) => row.library === "temporeum" && row.workload === workload && row.browser === null && row.metric === "js-min-gz")) failures.push(`${workload}: no bytes row`);
  }
  notes.push(`${String(data.results.length)} result rows, ${String(reps)} repetitions, browsers: ${JSON.stringify(data.browsers)}, ${String(data.settings?.runSeconds)} s`);

  // --- 2-3. the page --------------------------------------------------------------------
  if (!existsSync(pageFile)) failures.push("no packages/docs/dist/benchmark-field.html — the docs build did not run after the measurement, so this is a FAILURE");
  else {
    const html = readFileSync(pageFile, "utf8");
    const page = readPage(html);
    failures.push(...judgePage(data, page));
    notes.push(`${String(page.cells.size)} cells on the page, all from results.json; ${String(page.listed.length)} over the budget, matching our own computation`);
    // --- 4. negative control ---
    const forged = new Map(page.cells);
    const first = [...forged.keys()][0];
    if (first !== undefined) forged.set(first, `${forged.get(first)}9`);
    const fakeList = page.listed.length > 0 ? page.listed.slice(1) : [keyOf(data.results.find((row) => BUDGET.metrics.includes(row.metric)) ?? { library: "x", metric: "x" })];
    const control = judgePage(data, { ...page, cells: forged }).length === 0 || judgePage(data, { ...page, listed: fakeList }).length === 0;
    if (control) failures.push("NEGATIVE CONTROL: an edited cell or a forged list does NOT fail");
    else notes.push("negative control fails, as it should — edited cell, forged list");
  }
}
const prose = readFileSync(sourceFile, "utf8")
  .replace(/^\{\{[^}]+\}\}\s*$/gm, "")
  .replace(/```[\s\S]*?```/g, "")
  .replace(/\]\([^)]*\)/g, "]");
const digits = prose.split("\n").filter((line) => /\d/.test(line));
if (digits.length > 0) failures.push(`hand-written number in the page source: ${digits.slice(0, 3).map((line) => JSON.stringify(line.slice(0, 80))).join(" | ")}`);

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures.slice(0, 60)) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "bench-field: passed" : `bench-field: FAILED (${String(failures.length)} problems)`);
process.exit(failures.length === 0 ? 0 : 1);
