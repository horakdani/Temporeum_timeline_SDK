#!/usr/bin/env node
/**
 * The size budget of the non-base entry points: marginal cost.
 *
 * The base entry point's (`index`) budget is a standalone measurement,
 * enforced by size-limit (the "size-limit" field of package.json, generated
 * from entries.json). Another entry point (/dom, /gantt, /schedule…), however,
 * cannot be used without the base: it imports the core from there. So its
 * price is how much MORE someone downloads who pulls it in next to the base:
 *
 *     marginal cost = size(base + entry) − size(base)
 *
 * both terms with `import *`, with the same meter: a rolldown bundle of the
 * shipped ESM, minify, gzip 9. It prints the standalone size too, for information.
 *
 * Why not the standalone size (a budget decision):
 * in the chunked build the /dom code is byte-identical to the earlier one
 * (9712 B minified), only the order of the functions differs, and that makes
 * the gzip 41 B larger — the standalone measurement measured the order, not
 * the code. And a standalone measurement of /gantt would include half the
 * core, and say nothing about what the Gantt adds.
 *
 * Usage: `node ../../scripts/sdk_size.mjs` (part of `npm run size`), on the
 * built dist. Exceeding any budget exits 1.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { CORE_DIR, readEntries } from "./sdk_entries.mjs";

const VIRTUAL = "\0sdk-size-entry";

/** The combined `import *` cost of the `names` entry points, minify + gzip 9. */
export async function measure(coreDir, names) {
  const files = names.map((name) => join(coreDir, "dist", `${name}.mjs`));
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`no built entry point: ${file} — run the build first`);
  }
  const source = files.map((file, i) => `import * as m${String(i)} from ${JSON.stringify(file)};`).join("\n") + `\nglobalThis.__sdkSize = [${files.map((_, i) => `m${String(i)}`).join(", ")}];\n`;
  const bundle = await rolldown({
    input: VIRTUAL,
    logLevel: "silent",
    plugins: [
      {
        name: "sdk-size-entry",
        resolveId: (id) => (id === VIRTUAL ? id : null),
        load: (id) => (id === VIRTUAL ? source : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: "es", minify: true });
  await bundle.close();
  const code = output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join("");
  return gzipSync(code, { level: 9 }).length;
}

export function parseLimit(limit) {
  return Math.round(Number.parseFloat(limit) * 1000);
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith("sdk_size.mjs");
if (isMain) {
  const entries = readEntries();
  const base = await measure(CORE_DIR, ["index"]);
  console.log(`  base      index  ${String(base).padStart(6)} B  (its budget is in size-limit: ${entries.find((e) => e.name === "index").limit})`);
  const problems = [];
  for (const entry of entries.filter((e) => e.name !== "index")) {
    const together = await measure(CORE_DIR, ["index", entry.name]);
    const alone = await measure(CORE_DIR, [entry.name]);
    const marginal = together - base;
    const limit = parseLimit(entry.limit);
    const ok = marginal <= limit;
    console.log(`  ${ok ? "ok  " : "FAIL"}      ${entry.name.padEnd(6)} ${String(marginal).padStart(6)} B marginal cost / ${entry.limit} budget  (alone ${String(alone)} B, together with the base ${String(together)} B)`);
    if (!ok) problems.push(`${entry.name}: marginal cost ${String(marginal)} B > ${entry.limit}`);
  }
  if (problems.length > 0) {
    console.error(`\nSize budget exceeded: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("\nsdk_size: every non-base entry point is within its marginal-cost budget.");
}
