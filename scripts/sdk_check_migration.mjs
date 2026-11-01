#!/usr/bin/env node
/* global window, document -- a page.evaluate callbackjei a lapon futnak */
/**
 * G-MIGRATION (P18, a P28 ota mindharom utmutato): a vis-timeline-, a
 * frappe-gantt- es a react-calendar-timeline-utmutato minden lekepezesi sora
 * futo pelda, es a "meg nincs" sorok tenyleg nincsenek a konfiguracioban —
 * egy kitalalt lekepezes BUKIK.
 *
 * A forras a packages/docs/site/migration/<lib>.json; az oldal tablazata a
 * buildben ugyanebbol keszul, igy a ketto nem valhat el. Mindharom fajlnak
 * leteznie kell, es mindegyikben legalabb 10 lekepezesi sornak; a hianyzo
 * utmutato BUKAS. A frappe-gantt sorai Gantt-keretben futnak (egy feladat
 * egy sav, haladas, fuggosegek), a masik ketto az idovonal-keretben.
 *
 *  1. TIPUSOK. Minden lekepezesi sor `uses` tagja ("Tipus.tag") letezik a
 *     kiadott tipusokban (az elem es a mag publikus exportjai, a forrasbol,
 *     orokolt tagokkal egyutt); minden "meg nincs" sor `absent` tagja NEM
 *     letezik.
 *  2. FORDITAS. Minden lekepezesi sor peldaja a kozos kerettel (ugyanaz,
 *     amit a bongeszo futtat) TypeScript-fajlla all ossze, es a kiadott
 *     .d.ts-ek ellen strict modban hiba nelkul fordul. Egy kitalalt opcio a
 *     konfiguracio objektum-literaljaban "excess property" hiba.
 *  3. FUTAS. Ugyanez a pelda JavaScriptkent a felepitett oldal bundle-jeivel
 *     (import map, packages/docs/dist/lib) igazi Chromiumban fut: nincs
 *     lap-hiba es nincs console.error, es a #timeline-ban van legalabb egy
 *     [role=option] (kiveve a `drawn: false` sort: a `destroy()` utan a
 *     pelda maga allitja, hogy a peldany megszunt).
 *  4. NEGATIV KONTROLL ugyanezen a meron: egy kitalalt lekepezes
 *     (rollingMode -> `rollingMode: { follow: true }`; a P24 ota a `rolling`
 *     valodi opcio, ezert a kitalalt kulcs a vis-nev maga) az 1. es a 2. ponton is
 *     BUKIK, es egy letezo kulcsot "meg nincs"-nek allito sor (cluster) az
 *     1. ponton BUKIK. Ha barmelyik atmenne, a mero vak.
 *
 * Elofeltetel: `npm run build -w @temporeum/timeline-docs` (a dist es a
 * csomagok .d.ts-ei). A nem futtathato lepes BUKAS, nem kihagyas.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const dist = join(docs, "dist");
const GUIDES = ["vis-timeline", "frappe-gantt", "react-calendar-timeline"];
const MIN_MAPPINGS = 10;
const failures = [];
const notes = [];

// --- a kozos keret ------------------------------------------------------------
const HARNESS_ITEMS = `const DAY = 86_400_000;
const container = document.querySelector("#timeline") as HTMLElement;
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];
const items = [
  { id: "design", start: new Date("2026-03-02"), end: new Date("2026-03-09"), label: "Design", laneId: "work" },
  { id: "build", start: new Date("2026-03-06"), end: new Date("2026-03-20"), label: "Build", laneId: "work" },
  { id: "review", start: new Date("2026-03-23"), label: "Review", laneId: "ship" },
  { id: "launch", start: new Date("2026-03-27"), end: new Date("2026-04-03"), label: "Launch", laneId: "ship" },
  { id: "retro", start: new Date("2026-04-06"), label: "Retro", laneId: "work" },
];`;
/** A frappe-gantt-sorok kerete: egy feladat egy sav, haladassal; a fuggosegek a `dependencies`-ben. */
const HARNESS_TASKS = `const DAY = 86_400_000;
const container = document.querySelector("#timeline") as HTMLElement;
const tasks = [
  { id: "spec", label: "Spec", start: new Date("2026-03-02"), end: new Date("2026-03-06"), progress: 1 },
  { id: "design", label: "Design", start: new Date("2026-03-06"), end: new Date("2026-03-13"), progress: 0.6 },
  { id: "build", label: "Build", start: new Date("2026-03-09"), end: new Date("2026-03-20"), progress: 0.3 },
  { id: "test", label: "Test", start: new Date("2026-03-20"), end: new Date("2026-03-27"), progress: 0 },
  { id: "launch", label: "Launch", start: new Date("2026-03-30"), kind: "milestone" as const },
];
const items = tasks.map((task) => ({ ...task, laneId: task.id }));
const lanes = tasks.map((task) => ({ id: task.id, label: task.label }));
const dependencies = [
  { from: "spec", to: "design" },
  { from: "design", to: "build" },
  { from: "build", to: "test" },
  { from: "test", to: "launch" },
];`;
const HARNESSES = { "vis-timeline": HARNESS_ITEMS, "react-calendar-timeline": HARNESS_ITEMS, "frappe-gantt": HARNESS_TASKS };

/** Egy sor peldaja, TypeScriptkent. A bongeszo ugyanezt kapja, tipusok nelkul. */
/**
 * A keret minden plugint regisztral (P29, P30), ahogy egy migralo lap tenne:
 * a forraskonyvtar mindent rajzol, a sorok peldai a Gantt-ot, a csoportfat,
 * az ido-eszkozoket, az elemtipusokat es a szotarat is hasznaljak. A plugin
 * nelkuli hiba a G-PLUGINS es a G-PLUGINS-2 merese, nem ezee.
 */
const PLUGINS = ["gantt", "resources", "export", "tools", "groups", "items", "intl"];
const REGISTER = [
  `import { registerPlugin } from "@temporeum/timeline-element";`,
  ...PLUGINS.map((name) => `import { ${name}Plugin } from "@temporeum/timeline-element/${name}";`),
  `registerPlugin(${PLUGINS.map((name) => `${name}Plugin`).join(", ")});`,
].join("\n");

function exampleSource(row, library = "vis-timeline") {
  return [
    `import { createTimeline } from "@temporeum/timeline-element";`,
    REGISTER,
    row.imports ?? "",
    HARNESSES[library],
    row.before ?? "",
    `const timeline = createTimeline(container, {`,
    `  items,`,
    `  lanes,`,
    `  ariaLabel: "Migration example",`,
    row.config ? `  ${row.config.replace(/\n/g, "\n  ")},` : "",
    `});`,
    row.after ?? "",
    `export { timeline, DAY };`,
  ].join("\n");
}

/** A TypeScript-annotaciok nelkuli valtozat a bongeszonek. */
function browserSource(row, library) {
  return ts.transpileModule(exampleSource(row, library), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}

// --- 1. a tipusok tagjai -------------------------------------------------------
let checker;
let exportsByName;
function typeMembers(name) {
  if (checker === undefined) {
    // Az elem, a mag, es a mag ket alutvonala, amelyre a frappe-gantt- es a vis-sorok hivatkoznak.
    const entries = ["web-component/src/index.ts", "core/src/index.ts", "core/src/gantt/index.ts", "core/src/vis-compat/index.ts"].map((path) => join(repo, "packages", path));
    const program = ts.createProgram(entries, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    });
    checker = program.getTypeChecker();
    exportsByName = new Map();
    for (const entry of entries) {
      for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)))) {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        if (!exportsByName.has(target.getName())) exportsByName.set(target.getName(), target);
      }
    }
  }
  const symbol = exportsByName.get(name);
  if (symbol === undefined) return undefined;
  return new Set(checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map((property) => property.getName()));
}

/** Egy sor tag-allitasainak hibai. */
export function judgeMembers(row) {
  const problems = [];
  const lookup = (ref) => {
    const [type, member] = ref.split(".");
    const members = typeMembers(type);
    if (members === undefined) return { known: false, has: false, type };
    return { known: true, has: members.has(member), type };
  };
  for (const ref of row.uses ?? []) {
    const found = lookup(ref);
    if (!found.known) problems.push(`"${row.vis}": a ${found.type} tipus nincs a publikus exportok kozott (${ref})`);
    else if (!found.has) problems.push(`"${row.vis}": a lekepezes nem letezo tagra mutat: ${ref}`);
  }
  for (const ref of row.absent ?? []) {
    const found = lookup(ref);
    if (!found.known) problems.push(`"${row.vis}": a ${found.type} tipus nincs a publikus exportok kozott (${ref})`);
    else if (found.has) problems.push(`"${row.vis}": "meg nincs"-nek allitja, de LETEZIK: ${ref}`);
  }
  return problems;
}

// --- 2. forditas ---------------------------------------------------------------
/** Sorok forditasi hibai, soronkent. A fajlok a docs csomagban allnak, hogy a workspace-csomagokat (dist .d.ts) talaljak. */
export function compileRows(rows, library = "vis-timeline") {
  const dir = join(docs, ".migration-check");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files = rows.map((row, index) => {
    const file = join(dir, `row-${String(index + 1).padStart(3, "0")}.ts`);
    writeFileSync(file, exampleSource(row, library));
    return file;
  });
  try {
    const program = ts.createProgram(files, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      types: [],
    });
    const byFile = new Map(files.map((file) => [file, []]));
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const file = diagnostic.file?.fileName;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
      if (file !== undefined && byFile.has(resolve(file))) byFile.get(resolve(file)).push(message);
      else if (file !== undefined && byFile.has(file)) byFile.get(file).push(message);
      else byFile.set("(global)", [...(byFile.get("(global)") ?? []), message]);
    }
    return rows.map((row, index) => byFile.get(files[index]) ?? []).concat(byFile.has("(global)") ? [byFile.get("(global)")] : []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const guides = [];
for (const library of GUIDES) {
  const path = join(docs, "site", "migration", `${library}.json`);
  if (!existsSync(path)) {
    failures.push(`hianyzik a(z) ${library} migracios utmutato adatfajlja (site/migration/${library}.json)`);
    continue;
  }
  const guide = JSON.parse(readFileSync(path, "utf8"));
  if (guide.library !== library) failures.push(`site/migration/${library}.json: a library mezo ${JSON.stringify(guide.library)}`);
  const mappings = guide.rows.filter((row) => row.status !== "missing");
  const missing = guide.rows.filter((row) => row.status === "missing");
  if (mappings.length < MIN_MAPPINGS) failures.push(`${library}: csak ${String(mappings.length)} lekepezesi sor, legalabb ${String(MIN_MAPPINGS)} kell`);
  guides.push({ library, mappings, missing });
  for (const row of guide.rows) failures.push(...judgeMembers(row).map((problem) => `${library}: ${problem}`));
  if (!existsSync(join(repo, "packages", "web-component", "dist", "index.d.ts"))) {
    failures.push("nincs packages/web-component/dist — a build nem futott, a forditas nem futtathato, ezert BUKAS");
  } else {
    const results = compileRows(mappings, library);
    for (const [index, row] of mappings.entries()) {
      if (results[index].length > 0) failures.push(`${library} "${row.vis}": a pelda nem fordul — ${results[index].slice(0, 2).join(" | ")}`);
    }
    if (results.length > mappings.length) failures.push(`${library}: globalis forditasi hiba: ${results.at(-1).slice(0, 2).join(" | ")}`);
    else notes.push(`${library}: ${String(mappings.length)} lekepezes fordul strict TypeScripttel, a kiadott tipusok ellen`);
  }
  notes.push(`${library}: ${String(missing.length)} "meg nincs" sor kulcsai tenyleg hianyoznak (ha fent nincs BUKAS)`);
}

// --- 4. negativ kontroll (a tipus-feleken) ----------------------------------------
const invented = { area: "Control", vis: "rollingMode", status: "renamed", temporeum: "rollingMode", uses: ["TimelineConfig.rollingMode"], config: "rollingMode: { follow: true }" };
const falseMissing = { area: "Control", vis: "cluster", status: "missing", absent: ["TimelineConfig.cluster"] };
if (judgeMembers(invented).length === 0) failures.push("NEGATIV KONTROLL: a kitalalt lekepezes tag-ellenorzese NEM bukik");
if (judgeMembers(falseMissing).length === 0) failures.push('NEGATIV KONTROLL: a letezo kulcsot "meg nincs"-nek allito sor NEM bukik');
if (existsSync(join(repo, "packages", "web-component", "dist", "index.d.ts")) && compileRows([invented])[0].length === 0) failures.push("NEGATIV KONTROLL: a kitalalt opcio peldaja hiba nelkul fordul");
else notes.push("negativ kontroll bukik, ahogy kell — kitalalt lekepezes (tagok, forditas), hamis \"meg nincs\" (tagok)");

// --- 3. futas a bongeszoben -------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json" };
const pages = new Map();
function pageFor(row, library) {
  const imports = JSON.parse(readFileSync(join(dist, ".import-map.json"), "utf8"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>migration row</title>
<script type="importmap">${JSON.stringify({ imports })}</script></head>
<body><div id="timeline" style="height: 280px"></div>
<script type="module">${browserSource(row, library)}
window.__ready = true;</script></body></html>`;
}

async function runInBrowser() {
  const { chromium } = await import("@playwright/test");
  if (!existsSync(join(dist, "site-manifest.json"))) {
    failures.push("nincs packages/docs/dist — a build nem futott, a futas nem futtathato, ezert BUKAS");
    return;
  }
  // Az oldal import mapje a buildbol (build-site.mjs IMPORTS), a /lib/ ala.
  const { IMPORTS } = await import(join(docs, "scripts", "build-site.mjs"));
  writeFileSync(join(dist, ".import-map.json"), JSON.stringify(Object.fromEntries(Object.entries(IMPORTS).map(([name, path]) => [name, `/${path}`]))));
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    if (pages.has(pathname)) {
      response.writeHead(200, { "content-type": TYPES[".html"] });
      response.end(pages.get(pathname));
      return;
    }
    const file = resolve(join(dist, pathname));
    if (file.startsWith(dist + sep) && existsSync(file)) {
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(readFileSync(file));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${String(server.address().port)}`;
  const browser = await chromium.launch({ channel: "chromium-headless-shell" });
  /** Egy sor futasa: hibak listaja. */
  const run = async (row, index, library = "vis-timeline") => {
    const path = `/migration-${library}-${String(index)}.html`;
    pages.set(path, pageFor(row, library));
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      await page.goto(`${base}${path}`);
      await page.waitForFunction(() => window.__ready === true || document.readyState === "complete", undefined, { timeout: 15_000 });
      await page.waitForTimeout(300);
      const options = await page.evaluate(() => document.querySelectorAll("#timeline svg [role=option]").length);
      const problems = [...errors];
      if (row.drawn !== false && options < 1) problems.push(`${String(options)} [role=option] a #timeline-ban`);
      return problems;
    } catch (error) {
      return [...errors, String(error.message).split("\n")[0]];
    } finally {
      await page.close();
    }
  };
  try {
    for (const { library, mappings } of guides) {
      let ran = 0;
      for (const [index, row] of mappings.entries()) {
        const problems = await run(row, index, library);
        if (problems.length > 0) failures.push(`${library} "${row.vis}": a pelda a bongeszoben nem fut rendben — ${problems.slice(0, 2).join(" | ")}`);
        else ran += 1;
      }
      notes.push(`${library}: ${String(ran)}/${String(mappings.length)} pelda fut Chromiumban, hiba nelkul, rajzolt elemekkel`);
    }
    // Negativ kontroll: egy eldobo pelda ugyanezen a meron hibat mutat.
    const thrown = await run({ vis: "control", after: 'throw new Error("control");' }, "control");
    if (thrown.length === 0) failures.push("NEGATIV KONTROLL: egy eldobo pelda a bongeszoben NEM bukik");
  } finally {
    await browser.close();
    server.close();
    rmSync(join(dist, ".import-map.json"), { force: true });
  }
}

await runInBrowser();

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-MIGRATION: atment" : `G-MIGRATION: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
