#!/usr/bin/env node
/**
 * G-BENCH-FIELD (P28): a benchmark-oldal minden szama a results.json-bol
 * jon, mind a negy versenytars es mind a harom bongeszo lefutott, es a "hol
 * veszit" lista az adatokbol keszul, nem kezzel.
 *
 *  1. FUTOTT. A packages/docs/site/benchmark/field/results.json letezik,
 *     nem fustproba (`smoke`), es benne van a harom bongeszo verzioval; a
 *     negy versenytars (vis-timeline, react-calendar-timeline, frappe-gantt,
 *     svar) es a Temporeum mindket munkaterhelesen; minden konyvtar x meret x
 *     bongeszo hordozza a betoltes es a pasztazas metrikait (az ismetlesek
 *     szamanyi mintaval), a gorgos zoomot is, ahol a konyvtar tud ilyet; es a
 *     bajtok minden konyvtarra, a React-alappal.
 *  2. A SZAMOK. A felepitett packages/docs/dist/benchmark-field.html minden
 *     `data-field` cellaja pontosan a results.json megfelelo mediánja (az
 *     oldal formazasaval), es a results.json minden sora szerepel egy
 *     cellaban. Az oldal Markdown-forrasaban a generalt blokkokon kivul nincs
 *     szamjegy: kezzel irt szam nem kerulhet az oldalra.
 *  3. A LISTA. A "hol veszit" lista elemei (`data-loss`) pontosan azok a
 *     osszevetesek, amelyeket ez a mero a SAJAT kodjaval szamol ki az
 *     adatokbol (ugyanazzal a szaballyal, amit az oldal kozol); a kozolt
 *     darabszam is egyezik.
 *  4. NEGATIV KONTROLL. Egy kezzel atirt cella es egy kitorolt lista-elem
 *     ugyanezen a meron bukik.
 *
 * Elofeltetel: a sdk_bench_rivals.mjs lefutott, es utana a docs build (a
 * `npm run bench:field` ezt a sorrendet futtatja).
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

const RIVALS = { timeline: ["vis-timeline", "react-calendar-timeline"], gantt: ["frappe-gantt", "svar"] };
const BROWSERS = ["chromium", "firefox", "webkit"];
const LOAD_PAN = ["first-render", "dom-elements-after-load", "item-nodes-after-load", "visible-items-after-load", "pan-missed-frames", "pan-p95-frame"];
const ZOOM = ["zoom-missed-frames", "zoom-p95-frame", "zoom-peak-factor"];
// A sajat szamitas szabalya — ugyanaz, amit az oldal a modszer-tablaban kozol; ha az egyik valtozik, ez bukik.
const RULE = { relative: 0.1, absolute: { ms: 10, "%": 1, MB: 0.5, elements: 0, kB: 1 }, frameMs: 2, metrics: ["first-render", "dom-elements-after-load", "pan-missed-frames", "pan-p95-frame", "zoom-missed-frames", "zoom-p95-frame", "heap-after-load", "heap-after-pan", "js-min-gz"] };

const fmt = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
};
const keyOf = (row) => [row.library, row.workload ?? "", row.browser ?? "", String(row.n ?? ""), row.metric].join("|");
const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A sajat "hol veszit" szamitas. */
function losses(data) {
  const out = [];
  for (const row of data.results) {
    if (row.library === "temporeum" || row.library === "react (baseline)" || !RULE.metrics.includes(row.metric)) continue;
    const mine = data.results.find((each) => each.library === "temporeum" && each.workload === row.workload && each.browser === row.browser && each.n === row.n && each.metric === row.metric);
    if (mine === undefined) continue;
    const bar = row.metric.endsWith("-p95-frame") ? RULE.frameMs : (RULE.absolute[row.unit] ?? 0);
    const margin = mine.median - row.median;
    if (margin > bar && margin > RULE.relative * mine.median) out.push(keyOf(row));
  }
  return out.sort();
}

/** A lap cellai es lista-elemei. */
function readPage(html) {
  const cells = new Map([...html.matchAll(/data-field="([^"]+)"><span class="median">([^<]*)<\/span>/g)].map((match) => [unescape(match[1]), match[2]]));
  const listed = [...html.matchAll(/data-loss="([^"]+)"/g)].map((match) => unescape(match[1])).sort();
  const stated = /data-losses="(\d+)"/.exec(html)?.[1];
  return { cells, listed, stated: stated === undefined ? null : Number(stated) };
}

/** A lap es az adatok eltérései. */
export function judgePage(data, page) {
  const problems = [];
  for (const row of data.results) {
    const cell = page.cells.get(keyOf(row));
    if (cell === undefined) problems.push(`a lapon nincs cella: ${keyOf(row)}`);
    else if (cell !== fmt(row.median)) problems.push(`${keyOf(row)}: a lapon ${cell}, a results.json szerint ${fmt(row.median)}`);
  }
  for (const key of page.cells.keys()) if (!data.results.some((row) => keyOf(row) === key)) problems.push(`a lap olyan cellat mutat, ami nincs a results.json-ban: ${key}`);
  const expected = losses(data);
  if (JSON.stringify(expected) !== JSON.stringify(page.listed)) {
    const missing = expected.filter((key) => !page.listed.includes(key));
    const extra = page.listed.filter((key) => !expected.includes(key));
    problems.push(`a "hol veszit" lista nem az adatokbol jon: hianyzik ${JSON.stringify(missing.slice(0, 4))}, folosleges ${JSON.stringify(extra.slice(0, 4))}`);
  }
  if (page.stated !== expected.length) problems.push(`a lap ${String(page.stated)} veszteseget kozol, az adatokbol ${String(expected.length)} jon`);
  return problems;
}

// --- 1. futott --------------------------------------------------------------------------
if (!existsSync(resultsFile)) {
  failures.push("nincs site/benchmark/field/results.json — a terepi benchmark NEM futott, ezert BUKAS");
} else {
  const data = JSON.parse(readFileSync(resultsFile, "utf8"));
  if (data.smoke) failures.push("a results.json fustproba kimenete, nem meres");
  const reps = data.settings?.repetitions ?? 0;
  if (reps < 3) failures.push(`csak ${String(reps)} ismetles, legalabb 3 kell`);
  for (const browser of BROWSERS) if (typeof data.browsers?.[browser] !== "string") failures.push(`a(z) ${browser} nem futott (nincs verzioja a results.json-ban)`);
  for (const [workload, rivals] of Object.entries(RIVALS)) {
    for (const library of ["temporeum", ...rivals]) {
      if (typeof data.libraries?.[library]?.version !== "string") failures.push(`${library}: nincs verzio`);
      const zooms = data.capabilities?.[library]?.wheelZoom === true;
      for (const browser of BROWSERS) {
        for (const n of data.settings?.ns?.[workload] ?? []) {
          for (const metric of [...LOAD_PAN, ...(zooms ? ZOOM : []), ...(browser === "chromium" ? ["heap-after-load", "heap-after-pan"] : [])]) {
            const row = data.results.find((each) => each.library === library && each.workload === workload && each.browser === browser && each.n === n && each.metric === metric);
            if (row === undefined) failures.push(`hianyzik: ${library} ${workload} ${browser} n=${String(n)} ${metric}`);
            else if (row.samples.length < reps) failures.push(`${library} ${workload} ${browser} n=${String(n)} ${metric}: ${String(row.samples.length)} minta, ${String(reps)} kell`);
          }
        }
      }
      if (!data.results.some((row) => row.library === library && row.workload === workload && row.browser === null && row.metric === "js-min-gz")) failures.push(`${library} (${workload}): nincs bajt-sor`);
    }
  }
  if (!data.results.some((row) => row.library === "react (baseline)" && row.metric === "js-min-gz")) failures.push("nincs React-alap bajt-sor");
  notes.push(`${String(data.results.length)} eredmeny-sor, ${String(reps)} ismetles, bongeszok: ${JSON.stringify(data.browsers)}, ${String(data.settings?.runSeconds)} s`);

  // --- 2-3. a lap -----------------------------------------------------------------------
  if (!existsSync(pageFile)) failures.push("nincs packages/docs/dist/benchmark-field.html — a docs build nem futott a meres utan, ezert BUKAS");
  else {
    const html = readFileSync(pageFile, "utf8");
    const page = readPage(html);
    failures.push(...judgePage(data, page));
    notes.push(`${String(page.cells.size)} cella a lapon, mind a results.json-bol; ${String(page.listed.length)} "hol veszit" elem, a sajat szamitassal egyezik`);
    // --- 4. negativ kontroll ---
    const forged = new Map(page.cells);
    const first = [...forged.keys()][0];
    if (first !== undefined) forged.set(first, `${forged.get(first)}9`);
    const control = judgePage(data, { ...page, cells: forged }).length === 0 || (losses(data).length > 0 && judgePage(data, { ...page, listed: page.listed.slice(1) }).length === 0);
    if (control) failures.push("NEGATIV KONTROLL: egy atirt cella vagy egy kitorolt lista-elem NEM bukik");
    else notes.push("negativ kontroll bukik, ahogy kell — atirt cella, kitorolt veszteseg");
  }
}
const prose = readFileSync(sourceFile, "utf8")
  .replace(/^\{\{[^}]+\}\}\s*$/gm, "")
  .replace(/```[\s\S]*?```/g, "")
  .replace(/\]\([^)]*\)/g, "]");
const digits = prose.split("\n").filter((line) => /\d/.test(line));
if (digits.length > 0) failures.push(`kezzel irt szam az oldal forrasaban: ${digits.slice(0, 3).map((line) => JSON.stringify(line.slice(0, 80))).join(" | ")}`);

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures.slice(0, 60)) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-BENCH-FIELD: atment" : `G-BENCH-FIELD: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
