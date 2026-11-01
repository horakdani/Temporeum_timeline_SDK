#!/usr/bin/env node
/**
 * G-DEPS — bizonyítja, hogy a magnak NULLA futásidejű függősége van.
 *
 * Két független módon, mert a kettő más hibát fog meg:
 *
 *  1. A manifesztek: a core-ban nincs dependencies / peerDependencies /
 *     optionalDependencies. Ez a szándékot ellenőrzi.
 *  2. A lefordított bundle-ök: egyetlen "bare" import- vagy require-specifier
 *     sem maradt bennük. Ez a valóságot ellenőrzi — egy deklarálatlan import
 *     a manifesztben nem látszik, a kimenetben igen. VALÓDI PARSERREL, nem
 *     szövegmintával: hogy miért, azt a 2. szakasz kommentje mondja el.
 *
 * Ha a dist nem létezik, az BUKÁS, nem kihagyás: a 2. ellenőrzés nem futott le,
 * tehát a kapu nem mondhatja, hogy bizonyított.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A rollup már a build eszköze: a parsere nem új függőség.
import { parseAst } from "rollup/parseAst";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "@temporeum/timeline-core";
const WORKSPACE_SCOPE = "@temporeum/";

const problems = [];
const notes = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const rootManifest = readJson(join(repoRoot, "package.json"));
const workspaceDirs = (rootManifest.workspaces ?? []).map((w) =>
  join(repoRoot, w),
);
if (workspaceDirs.length === 0) {
  problems.push("A gyökér package.json nem deklarál workspace-eket.");
}

// --- 1. A manifesztek -------------------------------------------------------
let coreDir;
for (const dir of workspaceDirs) {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`Nincs package.json a workspace-ben: ${dir}`);
    continue;
  }
  const manifest = readJson(manifestPath);
  const name = manifest.name ?? dir;
  if (name === CORE) coreDir = dir;

  const runtime = Object.keys(manifest.dependencies ?? {});
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const optional = Object.keys(manifest.optionalDependencies ?? {});

  if (name === CORE) {
    for (const [kind, list] of [
      ["dependencies", runtime],
      ["peerDependencies", peers],
      ["optionalDependencies", optional],
    ]) {
      if (list.length > 0) {
        problems.push(
          `${name}: ${kind} nem üres (${list.join(", ")}) — a magnak nulla futásidejű függősége van.`,
        );
      }
    }
    notes.push(`${name}: 0 futásidejű függőség a manifesztben`);
    continue;
  }

  // A többi csomag peer-függősége legitim (react, pl.), de futásidejű
  // dependency csak workspace-testvér lehet.
  const foreign = runtime.filter((d) => !d.startsWith(WORKSPACE_SCOPE));
  if (foreign.length > 0) {
    problems.push(
      `${name}: külső futásidejű függőség (${foreign.join(", ")}) — csak workspace-testvér engedett.`,
    );
  }
  notes.push(
    `${name}: ${runtime.length} futásidejű dep (${runtime.join(", ") || "nincs"}), ${peers.length} peer`,
  );
}

if (coreDir === undefined) {
  problems.push(`A ${CORE} csomag nincs a workspace-ek között.`);
}

// --- 2. A lefordított bundle-ök --------------------------------------------
/**
 * A specifierek VALÓDI PARSERREL, nem szövegmintával.
 *
 * Volt itt egy regex (`from\s*["']([^"']+)["']`), és hazudott. A P5-ben ez a
 * mondat került az `editing.ts`-be:
 *
 *     // ... which is the shortest path from "it
 *     // happened" to "it lasted".
 *
 * A minta illeszkedett rá, és a check mindhárom bundle-ben egy `it\n//
 * happened` nevű "külső függőséget" jelentett — miközben a manifeszt-oldal
 * ugyanabban a futásban 0 függőséget mondott. Nem a bundle volt rossz: a
 * CHECK volt rossz.
 *
 * Az első javításom egy kézi komment-stripper volt. Az is rossz volt, és ezt
 * egy roncsolásos próba mondta meg: egy blokk-kommentbe írt `import x from
 * "lodash"` MÉGIS bukást okozott, mert a stripper valahol a bundle-ben
 * elcsúszott (egy idézőjelet tartalmazó regex-literálon), és onnantól a fájl
 * többi részét nyersen átengedte. Egy kézi lexer rossz válasz egy olyan
 * kérdésre, amire van parser.
 *
 * Ezért most a rollup `parseAst`-ja parsol — **nem új függőség**, a rollup már
 * a build eszköze. Egy parser számára a komment definíció szerint nem létezik,
 * tehát ez az osztály hiba többé nem lehetséges, nem csak valószínűtlen.
 *
 * Amit megnéz: `import ... from`, `export ... from`, `export * from`,
 * `import(...)` és `require(...)`. Ha egy `import()` vagy `require()`
 * argumentuma nem szövegliterál, az PROBLÉMA: egy futásidőben összerakott
 * specifier pont az, amit a kapu nem tud bizonyítani.
 */
function walkAst(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walkAst(node[key], visit);
  }
}

function isStringLiteral(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    node.type === "Literal" &&
    typeof node.value === "string"
  );
}

/** A modulban szereplő összes specifier, és a nem-literál helyek száma. */
function specifiersOf(code) {
  const specifiers = new Set();
  const computed = [];
  walkAst(parseAst(code), (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (isStringLiteral(node.source)) specifiers.add(node.source.value);
        break;
      case "ImportExpression":
        if (isStringLiteral(node.source)) specifiers.add(node.source.value);
        else computed.push("import()");
        break;
      case "CallExpression":
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          const [first] = node.arguments;
          if (isStringLiteral(first)) specifiers.add(first.value);
          else computed.push("require()");
        }
        break;
      default:
        break;
    }
  });
  return { specifiers, computed };
}

if (coreDir !== undefined) {
  // A P16 óta minden belépési pont (entries.json) és minden közös darab
  // (dist/chunks/) kiadott kód: egy új belépési pont vagy darab külső
  // importja ugyanúgy függőség, mint az alapé. A lista a forrásból jön, nem
  // kézzel — egy kézi lista az új belépési pontot nem látná.
  const { entries } = JSON.parse(readFileSync(join(coreDir, "entries.json"), "utf8"));
  const chunkDir = join(coreDir, "dist", "chunks");
  const chunks = existsSync(chunkDir)
    ? readdirSync(chunkDir).filter((name) => /\.(mjs|cjs)$/.test(name)).map((name) => `dist/chunks/${name}`)
    : [];
  const bundles = [
    ...entries.flatMap((entry) => [`dist/${entry.name}.mjs`, `dist/${entry.name}.cjs`, `dist/${entry.name}.umd.js`]),
    ...chunks,
  ];
  for (const rel of bundles) {
    const path = join(coreDir, rel);
    if (!existsSync(path)) {
      problems.push(
        `Nincs lefordított bundle: ${rel} — a futásidejű import-ellenőrzés NEM futott le. Futtasd előbb: npm run build -w packages/core`,
      );
      continue;
    }
    let parsed;
    try {
      parsed = specifiersOf(readFileSync(path, "utf8"));
    } catch (error) {
      // A parse-hiba is BUKÁS: egy nem parsolható bundle-ről nem tudunk
      // semmit mondani, és a "nem tudunk semmit" nem átmenet.
      problems.push(`${rel}: nem parsolható (${error.message}) — az ellenőrzés nem futott le.`);
      continue;
    }
    const external = [...parsed.specifiers].filter(
      (spec) => !spec.startsWith(".") && !spec.startsWith("/"),
    );
    if (external.length > 0) {
      // A node: beépítettek is bukást jelentenek: a mag böngészőben fut.
      problems.push(
        `${rel}: külső specifier a kimenetben (${external.join(", ")}) — a bundle nem önálló.`,
      );
    }
    if (parsed.computed.length > 0) {
      problems.push(
        `${rel}: ${String(parsed.computed.length)} nem-literál specifier (${[...new Set(parsed.computed)].join(", ")}) — futásidőben összerakott betöltést a kapu nem tud bizonyítani.`,
      );
    }
    if (external.length === 0 && parsed.computed.length === 0) {
      notes.push(
        `${rel}: 0 külső specifier (${String(parsed.specifiers.size)} relatív, parserrel)`,
      );
    }
  }
}

for (const note of notes) console.log(`  ok   ${note}`);
if (problems.length > 0) {
  console.error("");
  for (const problem of problems) console.error(`  HIBA ${problem}`);
  console.error(`\nG-DEPS BUKOTT: ${problems.length} probléma.`);
  process.exit(1);
}
console.log(`\nG-DEPS átment: nulla futásidejű függőség, ${notes.length} ellenőrzés.`);
