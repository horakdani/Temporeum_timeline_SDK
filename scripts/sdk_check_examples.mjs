#!/usr/bin/env node
/**
 * The examples check — EVERY documented example really runs.
 *
 * It has three parts, because an example can go stale in three different ways:
 *
 *  1. THE CODE BLOCKS (static). Every code block on the docs pages
 *     (site/pages) AND in the READMEs of the shipped packages is either a
 *     whole live example (`::: example <id>`), or an excerpt of a running
 *     example / template (```js excerpt:example/<id>): its non-empty lines
 *     appear, in order, in the named source
 *     (packages/docs/scripts/excerpts.mjs). The only exceptions are shell and
 *     plain text. A block without a language, unmarked or drifted: FAILURE.
 *     Negative control: a changed line and a swapped line fail on the same
 *     checker.
 *  2. THE LIVE EXAMPLES (browser). e2e/examples.spec.ts on the built site:
 *     every example runs on its own page without errors, shows what it
 *     claims, and runs again after an edit. The list comes from
 *     site-manifest.json, which the builder writes from the pages. Negative
 *     control: an example that throws, one that draws nothing and one that
 *     imports a missing module must show an ERROR.
 *  3. THE TEMPLATES. scripts/sdk_check_templates.mjs: every template
 *     installs with the PACKED tarballs, builds, runs, and draws in real
 *     Chromium, without console errors.
 *
 * A part that cannot run is a FAILURE, not a skip.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXEMPT_LANGS, matchExcerpt, resolveExcerptSource } from "../packages/docs/scripts/excerpts.mjs";
import { parseMarkdown } from "../packages/docs/scripts/markdown.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const problems = [];
const notes = [];

/** The READMEs of the shipped packages: their npm page, the first thing a user reads. */
const READMES = [
  // The repo's own README: the first thing a visitor on GitHub reads.
  [
    "README.md",
  ][0],
  "packages/core/README.md",
  "packages/web-component/README.md",
  "packages/react/README.md",
  // The three framework adapters.
  "packages/vue/README.md",
  "packages/svelte/README.md",
  "packages/angular/README.md",
  "packages/docs/README.md",
];

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

// --- 1. the code blocks -------------------------------------------------------
const files = [...markdownFiles(join(docs, "site", "pages")), ...READMES.map((file) => join(repo, file))];
const examplesDir = join(docs, "site", "examples");
const exampleIds = new Set(readdirSync(examplesDir).filter((name) => statSync(join(examplesDir, name)).isDirectory()));
let checked = 0;
let exempt = 0;
let lines = 0;
let wholeExamples = 0;
let firstExcerpt;
for (const file of files) {
  const where = relative(repo, file);
  if (!existsSync(file)) {
    problems.push(`${where}: does not exist`);
    continue;
  }
  let blocks;
  try {
    blocks = parseMarkdown(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${where}: ${error.message}`);
    continue;
  }
  const flat = blocks.flatMap((block) => (block.type === "quote" ? block.blocks : [block]));
  for (const block of flat) {
    if (block.type === "example") {
      if (!exampleIds.has(block.id)) problems.push(`${where}:${String(block.line)}: no such example: ${block.id}`);
      wholeExamples += 1;
      continue;
    }
    if (block.type !== "code") continue;
    if (block.lang === "") {
      problems.push(`${where}:${String(block.line)}: code block without a language — there is no telling whether it must run`);
      continue;
    }
    if (EXEMPT_LANGS.has(block.lang)) {
      exempt += 1;
      continue;
    }
    if (block.excerpt === null) {
      problems.push(`${where}:${String(block.line)}: the ${block.lang} block is not an excerpt of any running example (mark it: \`\`\`${block.lang} excerpt:example/<id>), nor is it a live example`);
      continue;
    }
    const source = resolveExcerptSource(block.excerpt, docs);
    if (source.error) {
      problems.push(`${where}:${String(block.line)}: ${source.error}`);
      continue;
    }
    const match = matchExcerpt(block.text, source.text);
    checked += 1;
    lines += match.checked;
    firstExcerpt ??= { block, source };
    if (match.checked === 0) problems.push(`${where}:${String(block.line)}: the excerpt is empty — it claims nothing`);
    for (const miss of match.missing) {
      problems.push(`${where}:${String(block.line + miss.line)}: ${miss.reason} (${block.excerpt}): ${miss.text}`);
    }
  }
}
notes.push(`code blocks: ${String(checked)} excerpts (${String(lines)} lines in the running source), ${String(wholeExamples)} live examples, ${String(exempt)} shell/text — in ${String(files.length)} files`);

// The measurement is not blind: an edited and a swapped line fail.
if (firstExcerpt === undefined) {
  problems.push("there is not a single excerpt — the negative control cannot run, so this is a FAILURE");
} else {
  const kept = firstExcerpt.block.text.split("\n").filter((line) => line.trim() !== "");
  const changed = [...kept];
  changed[0] = `${changed[0]} // drift`;
  const swapped = kept.length >= 2 ? [kept[1], kept[0], ...kept.slice(2)] : null;
  if (matchExcerpt(changed.join("\n"), firstExcerpt.source.text).ok) problems.push("NEGATIVE CONTROL: an edited line passed too — the excerpt checker is blind");
  if (swapped !== null && kept[0].trim() !== kept[1].trim() && matchExcerpt(swapped.join("\n"), firstExcerpt.source.text).ok) {
    problems.push("NEGATIVE CONTROL: two swapped lines passed too — the excerpt checker does not see the order");
  }
  notes.push("negative control: an edited and a swapped line fail on the excerpt checker");
}

// --- 2. the live examples, in a browser --------------------------------------------
const manifestPath = join(docs, "dist", "site-manifest.json");
const resultsPath = join(docs, ".examples-results.json");
if (!existsSync(manifestPath)) {
  problems.push("no dist/site-manifest.json — the site was not built, the examples could not run: FAILURE");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Before the run, not inside it: a failed test restarts Playwright's worker.
  rmSync(resultsPath, { force: true });
  const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.examples.config.ts"], { cwd: docs, stdio: "inherit" });
  if (!existsSync(resultsPath)) {
    problems.push("the browser suite wrote no results — it did not run, so this is a FAILURE");
  } else {
    const results = readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    for (const example of manifest.examples) {
      const result = results.find((entry) => entry.kind === "example" && entry.id === example.id);
      const where = `example ${example.id} (${example.page})`;
      if (result === undefined) {
        problems.push(`${where}: no result — it did not run`);
        continue;
      }
      if (result.first.state !== "ok" || result.first.errors !== 0) problems.push(`${where}: does not run without errors: ${result.first.status}`);
      for (const claim of [...result.shown, ...result.shownAfterEdit]) {
        if (claim.count < claim.min) problems.push(`${where}: "${claim.selector}" ${String(claim.count)} matches, at least ${String(claim.min)} required`);
      }
      if (result.edited.state !== "ok" || !result.editedSeen) problems.push(`${where}: does not run again after an edit`);
      for (const error of result.pageErrors) problems.push(`${where}: error on the page: ${error}`);
    }
    const control = results.find((entry) => entry.kind === "control");
    if (control === undefined) {
      problems.push("NEGATIVE CONTROL: did not run — there is no telling whether the checker can see");
    } else {
      if (control.thrown.state !== "error") problems.push("NEGATIVE CONTROL: the throwing example did not show an error — the checker is blind");
      if (!control.emptyClaims.some((claim) => claim.count < claim.min)) problems.push("NEGATIVE CONTROL: the claims of the example that draws nothing were met — the checker is blind");
      if (control.missing.state !== "error") problems.push("NEGATIVE CONTROL: the missing module did not show an error — the checker is blind");
      notes.push("negative control: the throwing, the empty and the missing-module example show an error");
    }
    notes.push(`live examples: ${String(manifest.examples.length)} on ${String(manifest.pages.length)} pages; the suite's exit code is ${String(run.status)}`);
    if (run.status !== 0 && problems.length === 0) problems.push(`the browser suite exited with code ${String(run.status)}`);
  }
}

// --- 3. the templates ---------------------------------------------------------------
try {
  execFileSync("node", [join(repo, "scripts", "sdk_check_templates.mjs")], { cwd: repo, stdio: "inherit" });
  notes.push("templates: all build and draw with the packed tarballs (sdk_check_templates.mjs)");
} catch (error) {
  problems.push(`the template check failed (exit ${String(error.status)})`);
}

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length > 0) {
  console.error(`\nexamples FAILED — ${String(problems.length)} problems:`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("\nexamples: every code block is part of a running example, every live example runs, every template builds and draws.");
