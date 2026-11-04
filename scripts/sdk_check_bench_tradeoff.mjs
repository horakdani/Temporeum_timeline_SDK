#!/usr/bin/env node
/**
 * The bench-tradeoff check: the field benchmark page states the trade-off — we load
 * more bytes, but on large data we are often faster —, and every number in
 * the trade-off section is a median from results.json.
 *
 *  1. THE SOURCE. results.json exists and is not a smoke run; the
 *     `{{bench:field-tradeoff}}` block appears exactly once in the page source.
 *  2. THE CELLS. In the trade-off block of the built
 *     packages/docs/dist/benchmark-field.html every `data-tradeoff` number is
 *     exactly the matching median in results.json (with the page's
 *     formatting). The checker computes with its OWN code what must be
 *     there: per workload the largest size, every library, the bytes, and
 *     per browser the first render, the DOM elements and the pan's missed
 *     frames. Anything missing, or not in results.json, is a FAILURE. The
 *     stated size (`data-tradeoff-n`) is the largest size.
 *  3. THE WORDS. Every comparison word (`data-claim`: lower, higher,
 *     "about") matches the checker's own computation, with the same noise
 *     rule the page states for the list of losses.
 *  4. NO HAND-WRITTEN NUMBERS. The block's text has no digits apart from the
 *     marked numbers and the library names (with their versions).
 *  5. NEGATIVE CONTROL. An edited cell, a flipped word and a typed-in number
 *     FAIL on this same checker.
 *
 * Prerequisite: the docs build ran after results.json (`npm run
 * bench:field` runs them in this order; in the gate, the docs check does too).
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

const BROWSERS = ["chromium", "firefox", "webkit"];
const PER_BROWSER = ["first-render", "dom-elements-after-load", "pan-missed-frames"];
// Our own rule — the same one the page states in its method table.
const RULE = { relative: 0.1, absolute: { ms: 10, "%": 1, MB: 0.5, elements: 0, kB: 1 } };

const fmt = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
};
const keyOf = (row) => [row.library, row.workload ?? "", row.browser ?? "", String(row.n ?? ""), row.metric].join("|");
const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function verdict(ours, theirs, unit) {
  const bar = RULE.absolute[unit] ?? 0;
  const margin = Math.abs(ours - theirs);
  if (margin > bar && margin > RULE.relative * Math.max(ours, theirs)) return ours < theirs ? "lower" : "higher";
  return "same";
}

/** What the checker says must be visible in the block. */
export function expected(data) {
  const cells = new Map();
  const claims = new Map();
  const sizes = new Map();
  for (const [workload, libraries] of Object.entries(data.workloads)) {
    const n = Math.max(...data.settings.ns[workload]);
    sizes.set(workload, String(n));
    const find = (library, browser, metric) => data.results.find((row) => row.library === library && row.workload === workload && row.browser === browser && row.metric === metric && (browser === null || row.n === n));
    for (const library of libraries) {
      const rows = [find(library, null, "js-min-gz"), ...BROWSERS.flatMap((browser) => PER_BROWSER.map((metric) => find(library, browser, metric)))];
      for (const row of rows) if (row !== undefined) cells.set(keyOf(row), fmt(row.median));
    }
    const [ours, ...rivals] = libraries;
    for (const rival of rivals) {
      for (const [browser, metric] of [[null, "js-min-gz"], ...PER_BROWSER.map((metric) => [BROWSERS[0], metric])]) {
        const mine = find(ours, browser, metric);
        const theirs = find(rival, browser, metric);
        if (mine !== undefined && theirs !== undefined) claims.set(keyOf(theirs), verdict(mine.median, theirs.median, mine.unit));
      }
    }
  }
  return { cells, claims, sizes };
}

/** The trade-off block of the built page. */
export function readBlock(html) {
  const start = html.indexOf('<div class="bench-tradeoff-block">');
  if (start < 0) return null;
  let depth = 0;
  let end = start;
  for (const match of html.slice(start).matchAll(/<\/?div\b[^>]*>/g)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = start + match.index + match[0].length;
      break;
    }
  }
  const block = html.slice(start, end);
  return {
    block,
    cells: [...block.matchAll(/<span data-tradeoff="([^"]+)">([^<]*)<\/span>/g)].map((m) => [unescape(m[1]), m[2]]),
    claims: [...block.matchAll(/data-claim="([^"]+)"/g)].map((m) => {
      const value = unescape(m[1]);
      const cut = value.lastIndexOf("|");
      return [value.slice(0, cut), value.slice(cut + 1)];
    }),
    sizes: [...block.matchAll(/<span data-tradeoff-n="([^"]+)">([^<]*)<\/span>/g)].map((m) => [unescape(m[1]), m[2]]),
  };
}

export function judge(data, page) {
  const problems = [];
  const want = expected(data);
  const seen = new Set();
  for (const [key, value] of page.cells) {
    seen.add(key);
    if (!want.cells.has(key)) problems.push(`the block shows a number that does not belong in the trade-off section or is not in results.json: ${key}`);
    else if (want.cells.get(key) !== value) problems.push(`${key}: the page says ${value}, results.json says ${want.cells.get(key)}`);
  }
  for (const key of want.cells.keys()) if (!seen.has(key)) problems.push(`missing from the block: ${key}`);
  const claimed = new Map(page.claims);
  for (const [key, word] of want.claims) {
    if (!claimed.has(key)) problems.push(`missing comparison: ${key}`);
    else if (claimed.get(key) !== word) problems.push(`${key}: the page says "${claimed.get(key)}", our own computation says "${word}"`);
  }
  for (const key of claimed.keys()) if (!want.claims.has(key)) problems.push(`extra comparison: ${key}`);
  const sizes = new Map(page.sizes);
  for (const [workload, n] of want.sizes) if (sizes.get(workload) !== n) problems.push(`${workload}: the page's size is ${String(sizes.get(workload))}, the largest size is ${n}`);
  // Hand-written numbers: without the marked numbers and the library names, no digit may remain.
  const names = Object.entries(data.libraries).map(([library, info]) => `${info?.name ?? library} ${info?.version ?? ""}`.trim()).sort((a, b) => b.length - a.length);
  let text = page.block.replace(/<span data-tradeoff(?:-n)?="[^"]*">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ");
  text = unescape(text);
  for (const name of names) text = text.split(name).join(" ");
  const stray = text.match(/[^\s]*\d[^\s]*/g);
  if (stray !== null) problems.push(`unmarked number in the block: ${stray.slice(0, 4).join(", ")}`);
  return problems;
}

if (!existsSync(resultsFile)) failures.push("no site/benchmark/field/results.json — the field benchmark did NOT run, so this is a FAILURE");
else {
  const data = JSON.parse(readFileSync(resultsFile, "utf8"));
  if (data.smoke) failures.push("results.json is the output of a smoke run, not a measurement");
  const source = readFileSync(sourceFile, "utf8");
  const slots = source.match(/^\{\{bench:field-tradeoff\}\}\s*$/gm) ?? [];
  if (slots.length !== 1) failures.push(`{{bench:field-tradeoff}} appears ${String(slots.length)}x in the page source, exactly once is required`);
  if (!existsSync(pageFile)) failures.push("no packages/docs/dist/benchmark-field.html — the docs build did not run, so this is a FAILURE");
  else {
    const page = readBlock(readFileSync(pageFile, "utf8"));
    if (page === null) failures.push("the built page has no trade-off block");
    else {
      const problems = judge(data, page);
      failures.push(...problems);
      const want = expected(data);
      if (problems.length === 0) notes.push(`${String(page.cells.length)} numbers, all medians from results.json; ${String(page.claims.length)} comparison words, all matching our own computation; sizes: ${[...want.sizes].map(([w, n]) => `${w} ${n}`).join(", ")}`);
      // --- negative control ---
      const forged = page.cells.map(([key, value], index) => [key, index === 0 ? `${value}9` : value]);
      const flipped = page.claims.map(([key, word], index) => [key, index === 0 ? (word === "lower" ? "higher" : "lower") : word]);
      const typed = page.block.replace("</ul>", "<li>Temporeum is 3x faster.</li></ul>");
      const controls = [
        ["edited cell", judge(data, { ...page, cells: forged })],
        ["flipped word", judge(data, { ...page, claims: flipped })],
        ["typed-in number", judge(data, { ...page, block: typed })],
      ];
      const blind = controls.filter(([, found]) => found.length === 0).map(([name]) => name);
      if (page.cells.length === 0 || blind.length > 0) failures.push(`NEGATIVE CONTROL: does not fail — ${blind.join(", ") || "empty block"}`);
      else notes.push(`negative control fails, as it should — ${controls.map(([name, found]) => `${name}: ${found[0]}`).join(" | ")}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures.slice(0, 40)) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "bench-tradeoff: passed" : `bench-tradeoff: FAILED (${String(failures.length)} problems)`);
process.exit(failures.length === 0 ? 0 : 1);
