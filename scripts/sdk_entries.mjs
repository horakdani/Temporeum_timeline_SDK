#!/usr/bin/env node
/**
 * The core's entry points: entries.json -> package.json fields.
 *
 *   node scripts/sdk_entries.mjs --write   # writes the package.json fields from entries.json
 *   node scripts/sdk_entries.mjs --check   # exits 1 on a mismatch, and says what differs
 *
 * Why it is generated. An entry point lives in four places: in the
 * conditional branches of exports (ESM and CJS, each with its own types), in
 * typesVersions (for node10 resolution), in size-limit and in rollup. Four
 * hand-written lists can each miss something — at one point /dom found no
 * types under node10 for exactly that reason. So there is one source, and
 * the four places follow from it; the entries check (sdk_check_entries.mjs) proves
 * on the shipped package that this really holds.
 *
 * What it writes:
 *  - exports: an `import` and a `require` branch for every entry point, each
 *    with `types` first (TypeScript takes the first matching condition). The
 *    `./package.json` branch is kept.
 *  - main / module / types / unpkg / jsdelivr: for the base entry point.
 *  - typesVersions: for the non-base entry points.
 *  - size-limit: ONLY the base entry point, measured on its own. The budget
 *    of every other entry point is a marginal cost (base + entry minus base),
 *    measured by scripts/sdk_size.mjs — size-limit cannot subtract.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORE_DIR = join(repo, "packages", "core");

/** The entry points, validated. Throws on an invalid source. */
export function readEntries(coreDir = CORE_DIR) {
  const raw = JSON.parse(readFileSync(join(coreDir, "entries.json"), "utf8"));
  const entries = raw.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries.json: no `entries` array");
  const names = new Set();
  for (const entry of entries) {
    for (const key of ["name", "input", "umd", "limit", "label"]) {
      if (typeof entry[key] !== "string" || entry[key] === "") throw new Error(`entries.json: the ${JSON.stringify(entry.name)} entry point has no \`${key}\` field`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name)) throw new Error(`entries.json: invalid name: ${entry.name}`);
    if (names.has(entry.name)) throw new Error(`entries.json: listed twice: ${entry.name}`);
    names.add(entry.name);
    if (entry.name !== "index" && !/^src\/[a-z][a-z0-9-]*\/index\.ts$/.test(entry.input)) {
      // The build factory recognises a non-base entry point's own code by its
      // folder (src/<name>/). The code of an entry point at the root of src
      // would merge into the core, and the treeshake check's proof would lose its meaning.
      throw new Error(`entries.json: the source of ${entry.name} is not of the form src/<name>/index.ts: ${entry.input}`);
    }
    if (!/^\d+(\.\d+)? kB$/.test(entry.limit)) throw new Error(`entries.json: the budget of ${entry.name} is not "<number> kB": ${entry.limit}`);
  }
  if (!names.has("index")) throw new Error("entries.json: no base (`index`) entry point");
  return entries;
}

/** The entry point's declaration file in dist, derived from the source. */
export function typesPath(entry, ext = "d.ts") {
  return `./${entry.input.replace(/^src\//, "dist/").replace(/\.ts$/, `.${ext}`)}`;
}

export function subpath(entry) {
  return entry.name === "index" ? "." : `./${entry.name}`;
}

/** The package.json fields as they should be according to entries.json. */
export function expectedFields(entries) {
  const exports = {};
  for (const entry of entries) {
    exports[subpath(entry)] = {
      import: { types: typesPath(entry), default: `./dist/${entry.name}.mjs` },
      require: { types: typesPath(entry, "d.cts"), default: `./dist/${entry.name}.cjs` },
    };
  }
  exports["./package.json"] = "./package.json";
  const typesVersions = { "*": {} };
  for (const entry of entries) {
    if (entry.name !== "index") typesVersions["*"][entry.name] = [typesPath(entry, "d.cts")];
  }
  const base = entries.find((entry) => entry.name === "index");
  return {
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    types: typesPath(base, "d.cts"),
    unpkg: "./dist/index.umd.js",
    jsdelivr: "./dist/index.umd.js",
    exports,
    typesVersions,
    "size-limit": [{ name: base.label, path: "dist/index.mjs", import: "*", limit: base.limit, gzip: true }],
  };
}

/** Differences between package.json and the expected fields, in readable form. */
export function drift(manifest, entries) {
  const expected = expectedFields(entries);
  const problems = [];
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(value)) {
      problems.push(`package.json "${key}": ${JSON.stringify(manifest[key])} — according to entries.json: ${JSON.stringify(value)}`);
    }
  }
  return problems;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  const manifestPath = join(CORE_DIR, "package.json");
  const text = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(text);
  const entries = readEntries();
  if (mode === "--write") {
    // The fields are replaced in place: the key order and the other fields stay.
    Object.assign(manifest, expectedFields(entries));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`sdk_entries: ${String(entries.length)} entry points -> packages/core/package.json`);
  } else if (mode === "--check") {
    const problems = drift(manifest, entries);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`  ERROR ${problem}`);
      console.error("\npackage.json differs from entries.json. Fix: node scripts/sdk_entries.mjs --write");
      process.exit(1);
    }
    console.log(`sdk_entries: package.json matches entries.json (${String(entries.length)} entry points)`);
  } else {
    console.error("Usage: node scripts/sdk_entries.mjs --write | --check");
    process.exit(2);
  }
}
