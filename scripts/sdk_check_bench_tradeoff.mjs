#!/usr/bin/env node
/**
 * G-BENCH-TRADEOFF (P32): a terepi benchmark-oldal kimondja a cseret — tobb
 * bajtot toltunk, de nagy adatnal sokszor gyorsabbak vagyunk —, es a
 * csere-szakasz minden szama a results.json mediánja.
 *
 *  1. A FORRAS. A results.json letezik, nem fustproba; a lap forrasaban a
 *     `{{bench:field-tradeoff}}` blokk pontosan egyszer all.
 *  2. A CELLAK. A felepitett packages/docs/dist/benchmark-field.html csere-
 *     blokkjaban minden `data-tradeoff` szam pontosan a results.json
 *     megfelelo mediánja (az oldal formazasaval). A mero a SAJAT kodjaval
 *     szamolja ki, minek kell ott allnia: munkaterhelesenkent a legnagyobb
 *     meret, minden konyvtar, a bajtok, es bongeszonkent az elso rajz, a
 *     DOM-elemek es a pasztazas kihagyott kepkockai. Ami hianyzik, vagy ami
 *     nincs a results.json-ban, BUKAS. A kozolt meret (`data-tradeoff-n`) a
 *     legnagyobb meret.
 *  3. A SZAVAK. Minden osszehasonlito szo (`data-claim`: kevesebb, tobb,
 *     „about”) a mero sajat szamitasaval egyezik, ugyanazzal a zaj-
 *     szaballyal, amit a lap a vesztesegek listajanal kozol.
 *  4. KEZZEL IRT SZAM NINCS. A blokk szovegeben a jelolt szamokon es a
 *     konyvtarak nevén (verzioval) kivul nincs szamjegy.
 *  5. NEGATIV KONTROLL. Egy atirt cella, egy megforditott szo es egy
 *     beirt szam ugyanezen a meron BUKIK.
 *
 * Elofeltetel: a docs build a results.json utan futott (a `npm run
 * bench:field` ezt a sorrendet futtatja; a kapuban a G-DOCS is).
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
// A sajat szabaly — ugyanaz, amit az oldal a modszer-tablaban kozol.
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

/** Amit a mero szerint a blokkban latni kell. */
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

/** A felepitett lap csere-blokkja. */
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
    if (!want.cells.has(key)) problems.push(`a blokk olyan szamot mutat, ami nem a csere-szakaszba valo vagy nincs a results.json-ban: ${key}`);
    else if (want.cells.get(key) !== value) problems.push(`${key}: a lapon ${value}, a results.json szerint ${want.cells.get(key)}`);
  }
  for (const key of want.cells.keys()) if (!seen.has(key)) problems.push(`hianyzik a blokkbol: ${key}`);
  const claimed = new Map(page.claims);
  for (const [key, word] of want.claims) {
    if (!claimed.has(key)) problems.push(`hianyzik az osszehasonlitas: ${key}`);
    else if (claimed.get(key) !== word) problems.push(`${key}: a lap szerint "${claimed.get(key)}", a sajat szamitas szerint "${word}"`);
  }
  for (const key of claimed.keys()) if (!want.claims.has(key)) problems.push(`folosleges osszehasonlitas: ${key}`);
  const sizes = new Map(page.sizes);
  for (const [workload, n] of want.sizes) if (sizes.get(workload) !== n) problems.push(`${workload}: a lap merete ${String(sizes.get(workload))}, a legnagyobb meret ${n}`);
  // Kezzel irt szam: a jelolt szamok es a konyvtarnevek nelkul nem maradhat szamjegy.
  const names = Object.entries(data.libraries).map(([library, info]) => `${info?.name ?? library} ${info?.version ?? ""}`.trim()).sort((a, b) => b.length - a.length);
  let text = page.block.replace(/<span data-tradeoff(?:-n)?="[^"]*">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ");
  text = unescape(text);
  for (const name of names) text = text.split(name).join(" ");
  const stray = text.match(/[^\s]*\d[^\s]*/g);
  if (stray !== null) problems.push(`jeloletlen szam a blokkban: ${stray.slice(0, 4).join(", ")}`);
  return problems;
}

if (!existsSync(resultsFile)) failures.push("nincs site/benchmark/field/results.json — a terepi benchmark NEM futott, ezert BUKAS");
else {
  const data = JSON.parse(readFileSync(resultsFile, "utf8"));
  if (data.smoke) failures.push("a results.json fustproba kimenete, nem meres");
  const source = readFileSync(sourceFile, "utf8");
  const slots = source.match(/^\{\{bench:field-tradeoff\}\}\s*$/gm) ?? [];
  if (slots.length !== 1) failures.push(`a lap forrasaban a {{bench:field-tradeoff}} ${String(slots.length)}x all, pontosan egyszer kell`);
  if (!existsSync(pageFile)) failures.push("nincs packages/docs/dist/benchmark-field.html — a docs build nem futott, ezert BUKAS");
  else {
    const page = readBlock(readFileSync(pageFile, "utf8"));
    if (page === null) failures.push("a felepitett lapon nincs csere-blokk");
    else {
      const problems = judge(data, page);
      failures.push(...problems);
      const want = expected(data);
      if (problems.length === 0) notes.push(`${String(page.cells.length)} szam, mind a results.json mediánja; ${String(page.claims.length)} osszehasonlito szo, mind a sajat szamitassal egyezik; meretek: ${[...want.sizes].map(([w, n]) => `${w} ${n}`).join(", ")}`);
      // --- negativ kontroll ---
      const forged = page.cells.map(([key, value], index) => [key, index === 0 ? `${value}9` : value]);
      const flipped = page.claims.map(([key, word], index) => [key, index === 0 ? (word === "lower" ? "higher" : "lower") : word]);
      const typed = page.block.replace("</ul>", "<li>Temporeum is 3x faster.</li></ul>");
      const controls = [
        ["atirt cella", judge(data, { ...page, cells: forged })],
        ["megforditott szo", judge(data, { ...page, claims: flipped })],
        ["beirt szam", judge(data, { ...page, block: typed })],
      ];
      const blind = controls.filter(([, found]) => found.length === 0).map(([name]) => name);
      if (page.cells.length === 0 || blind.length > 0) failures.push(`NEGATIV KONTROLL: nem bukik — ${blind.join(", ") || "ures blokk"}`);
      else notes.push(`negativ kontroll bukik, ahogy kell — ${controls.map(([name, found]) => `${name}: ${found[0]}`).join(" | ")}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures.slice(0, 40)) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-BENCH-TRADEOFF: atment" : `G-BENCH-TRADEOFF: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
