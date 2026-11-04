#!/usr/bin/env node
/**
 * The compat check: the vis-timeline documentation's examples, run through the
 * compatibility layer, put the same items at the same time and in the same
 * group.
 *
 * From the vitest report: every claim has a passing test, and every
 * documentation example passes as a test of its own (the number of examples
 * in the vector file + 1). From the vector file: it was written by
 * vis-timeline 8.5.6 (the generator is scripts/sdk_vis_compat_vectors.mjs),
 * it holds at least 80 examples and 2000 items, there is an example with
 * groups and a page carrying our own edge cases; the reason for each skipped
 * example is printed. Statically: the layer is our own code (it imports
 * neither vis nor moment), and the /vis-compat entry point is in
 * entries.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const reportFile = join(core, ".vis-compat-report.json");
const vectors = JSON.parse(readFileSync(join(core, "test", "vis-compat", "vectors.json"), "utf8"));
const docs = (vectors.vectors ?? []).filter((vector) => !String(vector.page).startsWith("edge/"));
const failures = checkReport({
  file: reportFile,
  label: "vis-compat",
  minTests: docs.length + 8,
  claims: ["docs-examples", "group-order", "edge-times", "warnings", "options", "negative-control"],
});
const notes = [];
try {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const green = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []).filter((test) => test.status === "passed" && String(test.title).includes("[claim:docs-examples]"));
  if (green.length < docs.length + 1) failures.push(`only ${String(green.length)} passing [claim:docs-examples] tests, ${String(docs.length + 1)} are required (one per example, plus completeness)`);
} catch {
  // checkReport has already counted the missing report as a failure.
}

if (vectors.visTimeline !== "8.5.6") failures.push(`the vectors were not written by vis-timeline 8.5.6: ${String(vectors.visTimeline)}`);
if (!String(vectors.$comment ?? "").includes("sdk_vis_compat_vectors.mjs")) failures.push("the vector file is not the generator's output");
const items = docs.reduce((sum, vector) => sum + (vector.vis?.items?.length ?? 0), 0);
if (docs.length < 80) failures.push(`only ${String(docs.length)} documentation examples, at least 80 are required`);
if (items < 2000) failures.push(`only ${String(items)} items, at least 2000 are required`);
if (!docs.some((vector) => vector.vis?.groupOrder !== null)) failures.push("no example with groups among the vectors");
if (!(vectors.vectors ?? []).some((vector) => String(vector.page).startsWith("edge/"))) failures.push("the edge-case page is missing");
notes.push(`${String(docs.length)} vis examples, ${String(items)} items, zone ${String(vectors.timeZone)}; skipped: ${(vectors.skipped ?? []).map((each) => `${each.page} (${each.reason})`).join(", ")}`);

for (const file of ["index.ts", "convert.ts", "time.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "vis-compat", file), "utf8"));
  for (const line of source.split("\n").filter((each) => /^\s*import /.test(each))) {
    if (!/from "\.\.?\//.test(line)) failures.push(`vis-compat imports from outside its own code (${file}): ${line.trim()}`);
  }
}
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "vis-compat" && entry.input === "src/vis-compat/index.ts")) failures.push("/vis-compat is not among the entry points (entries.json)");
finish("compat", failures, notes);
