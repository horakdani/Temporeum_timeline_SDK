#!/usr/bin/env node
/**
 * The size budgets of the element and the four components, which the core's
 * `npm run size` does not cover.
 *
 * Measured with the core's meter (`sdk_size.mjs`): a rolldown bundle of the
 * shipped ESM, minify, gzip 9 — so one regression shows here in CI, not only
 * in the 45-minute field benchmark that the README's page bytes come from.
 *
 *  - the element, `import *` with the engine it imports: what a page that
 *    uses everything the element's main entry offers downloads;
 *  - the UMD file, as shipped: the script tag's whole price, every plugin in;
 *  - each component, `import *` with the element, the engine and its framework
 *    left out: what the component itself adds. Svelte's ships as source the
 *    app's compiler builds, so its budget is the shipped files, gzipped.
 *
 * Usage: `node scripts/sdk_size_packages.mjs` on the built dist of all five.
 * A budget exceeded exits 1; `--print` prints the sizes and exits 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { rolldown } from "rolldown";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIRTUAL = "\0sdk-size-packages";

/**
 * The budgets (1 kB = 1000 B), minify + gzip 9. Each leaves room: at least 10% and at least 750 B over
 * the size when it was set (1.0.1), rounded up to the next half kB — CI's zlib reads ~1% more, and a fix
 * is not a hunt for bytes. Raised the same way when the room is used up, never to the byte.
 */
const BUDGETS = [
  { name: "element (import *, with the engine)", file: "packages/web-component/dist/index.mjs", external: [], limit: "58.5 kB" },
  { name: "element UMD (every plugin)", file: "packages/web-component/dist/timeline-element.umd.js", raw: true, limit: "116 kB" },
  { name: "react", file: "packages/react/dist/index.mjs", external: ["react", "react-dom", "react/jsx-runtime"], limit: "3 kB" },
  { name: "vue", file: "packages/vue/dist/index.mjs", external: ["vue"], limit: "2.5 kB" },
  { name: "svelte (shipped source)", files: ["packages/svelte/dist/index.js", "packages/svelte/dist/state.js", "packages/svelte/dist/Timeline.svelte"], limit: "5 kB" },
  { name: "angular", file: "packages/angular/dist/index.mjs", external: ["@angular/", "rxjs"], limit: "4 kB" },
];

/** Leave out the element and the engine too, for a component: it is measured on its own. */
const OURS = ["@temporeum/timeline-element", "@temporeum/timeline-core"];

async function measure({ file, files, raw, external = [] }, component) {
  if (files !== undefined) {
    for (const each of files) if (!existsSync(join(repo, each))) throw new Error(`not built: ${each} — run the build first`);
    return gzipSync(files.map((each) => readFileSync(join(repo, each), "utf8")).join("\n"), { level: 9 }).length;
  }
  const path = join(repo, file);
  if (!existsSync(path)) throw new Error(`not built: ${file} — run the build first`);
  if (raw === true) return gzipSync(readFileSync(path), { level: 9 }).length;
  const outside = component ? [...external, ...OURS] : external;
  const bundle = await rolldown({
    input: VIRTUAL,
    logLevel: "silent",
    external: (id) => outside.some((name) => id === name || id.startsWith(name.endsWith("/") ? name : `${name}/`)),
    plugins: [
      {
        name: "sdk-size-packages",
        resolveId: (id) => (id === VIRTUAL ? id : null),
        load: (id) => (id === VIRTUAL ? `import * as m from ${JSON.stringify(path)};\nglobalThis.__sdkSize = m;\n` : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: "es", minify: true });
  await bundle.close();
  return gzipSync(output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join(""), { level: 9 }).length;
}

const print = process.argv.includes("--print");
const problems = [];
for (const budget of BUDGETS) {
  const size = await measure(budget, !(budget.file ?? "").startsWith("packages/web-component/"));
  const limit = Math.round(Number.parseFloat(budget.limit) * 1000);
  const ok = print || size <= limit;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${budget.name.padEnd(38)} ${String(size).padStart(7)} B / ${budget.limit}`);
  if (!ok) problems.push(`${budget.name}: ${String(size)} B > ${budget.limit}`);
}
if (problems.length > 0) {
  console.error(`\nSize budget exceeded: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(print ? "size-packages: measured" : "size-packages: every package within its budget");
