#!/usr/bin/env node
/**
 * A mag belépési pontjai: az entries.json -> package.json mezők.
 *
 *   node scripts/sdk_entries.mjs --write   # a package.json mezőit az entries.json-ból írja
 *   node scripts/sdk_entries.mjs --check   # eltérésnél exit 1, és megmondja, mi tér el
 *
 * Miért generált. A P11 óta egy belépési pont négy helyen él: az exports
 * feltételes ágaiban (ESM és CJS, mindkettő a saját típusával), a
 * typesVersions-ben (a node10-feloldásnak), a size-limit-ben és a rollupban.
 * Négy kézi felsorolás négy helyen hiányozhat — a P11 nyitásakor a /dom
 * node10-ben pontosan ezért nem talált típust. Ezért egy forrás van, és a
 * négy hely ebből következik; a G-ENTRIES (sdk_check_entries.mjs) a kiadott
 * csomagon bizonyítja, hogy tényleg így van.
 *
 * Amit ír:
 *  - exports: minden belépési pontra `import` és `require` ág, mindkettőben
 *    elöl a `types` (a TypeScript az első egyező feltételt veszi). A
 *    `./package.json` ág megmarad.
 *  - main / module / types / unpkg / jsdelivr: az alap belépési pontra.
 *  - typesVersions: a nem-alap belépési pontokra.
 *  - size-limit: CSAK az alap belépési pont, önállóan mérve. A többi
 *    belépési pont kerete határköltség (alap + pont mínusz alap), azt a
 *    scripts/sdk_size.mjs méri — a size-limit nem tud kivonni.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORE_DIR = join(repo, "packages", "core");

/** A belépési pontok, ellenőrzött alakban. Hibás forrásnál dob. */
export function readEntries(coreDir = CORE_DIR) {
  const raw = JSON.parse(readFileSync(join(coreDir, "entries.json"), "utf8"));
  const entries = raw.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries.json: nincs `entries` tömb");
  const names = new Set();
  for (const entry of entries) {
    for (const key of ["name", "input", "umd", "limit", "label"]) {
      if (typeof entry[key] !== "string" || entry[key] === "") throw new Error(`entries.json: a(z) ${JSON.stringify(entry.name)} belépési pontnak nincs \`${key}\` mezője`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name)) throw new Error(`entries.json: érvénytelen név: ${entry.name}`);
    if (names.has(entry.name)) throw new Error(`entries.json: kétszer szerepel: ${entry.name}`);
    names.add(entry.name);
    if (entry.name !== "index" && !/^src\/[a-z][a-z0-9-]*\/index\.ts$/.test(entry.input)) {
      // A build-gyár a nem-alap belépési pont saját kódját a mappájáról
      // ismeri fel (src/<név>/). Egy src gyökerében álló belépési pont kódja
      // a magba olvadna, és a G-TREESHAKE bizonyítása értelmét vesztené.
      throw new Error(`entries.json: a(z) ${entry.name} forrása nem src/<név>/index.ts alakú: ${entry.input}`);
    }
    if (!/^\d+(\.\d+)? kB$/.test(entry.limit)) throw new Error(`entries.json: a(z) ${entry.name} kerete nem "<szám> kB": ${entry.limit}`);
  }
  if (!names.has("index")) throw new Error("entries.json: nincs alap (`index`) belépési pont");
  return entries;
}

/** A belépési pont deklarációs fájlja a dist-ben, a forrásból levezetve. */
export function typesPath(entry, ext = "d.ts") {
  return `./${entry.input.replace(/^src\//, "dist/").replace(/\.ts$/, `.${ext}`)}`;
}

export function subpath(entry) {
  return entry.name === "index" ? "." : `./${entry.name}`;
}

/** A package.json mezői, ahogy az entries.json szerint lenniük kell. */
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

/** Eltérések a package.json és az elvárt mezők között, olvasható alakban. */
export function drift(manifest, entries) {
  const expected = expectedFields(entries);
  const problems = [];
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(value)) {
      problems.push(`package.json "${key}": ${JSON.stringify(manifest[key])} — az entries.json szerint: ${JSON.stringify(value)}`);
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
    // A mezők a helyükön cserélődnek: a kulcssorrend és a többi mező marad.
    Object.assign(manifest, expectedFields(entries));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`sdk_entries: ${String(entries.length)} belépési pont -> packages/core/package.json`);
  } else if (mode === "--check") {
    const problems = drift(manifest, entries);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`  HIBA ${problem}`);
      console.error("\nA package.json eltér az entries.json-tól. Javítás: node scripts/sdk_entries.mjs --write");
      process.exit(1);
    }
    console.log(`sdk_entries: a package.json egyezik az entries.json-nal (${String(entries.length)} belépési pont)`);
  } else {
    console.error("Használat: node scripts/sdk_entries.mjs --write | --check");
    process.exit(2);
  }
}
