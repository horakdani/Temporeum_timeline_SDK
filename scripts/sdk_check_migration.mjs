#!/usr/bin/env node
/* global window, document -- the page.evaluate callbacks run on the page */
/**
 * The migration check: every mapping row of the
 * vis-timeline, frappe-gantt and react-calendar-timeline guides is a running
 * example, and the "not yet" rows really are absent from the configuration —
 * an invented mapping FAILS.
 *
 * The source is packages/docs/site/migration/<lib>.json; the page's table is
 * built from the same file, so the two cannot drift apart. All three files
 * must exist, each with at least 10 mapping rows; a missing guide is a
 * FAILURE. The frappe-gantt rows run in a Gantt harness (one task per lane,
 * progress, dependencies), the other two in the timeline harness.
 *
 *  1. TYPES. Every mapping row's `uses` member ("Type.member") exists in the
 *     published types (the public exports of the element and the core, from
 *     source, inherited members included); every "not yet" row's `absent`
 *     member does NOT exist.
 *  2. COMPILATION. Every mapping row's example, with the shared harness (the
 *     same one the browser runs), is assembled into a TypeScript file and
 *     compiles without errors in strict mode against the published .d.ts
 *     files. An invented option in the configuration object literal is an
 *     "excess property" error.
 *  3. RUNNING. The same example as JavaScript runs in real Chromium with the
 *     built site's bundles (import map, packages/docs/dist/lib): no page
 *     error and no console.error, and #timeline holds at least one
 *     [role=option] (except the `drawn: false` row: after `destroy()` the
 *     example itself asserts that the instance is gone).
 *  4. NEGATIVE CONTROL with the same measure: an invented mapping
 *     (rollingMode -> `rollingMode: { follow: true }`; `rolling` is a real
 *     option now, so the invented key is the vis name itself) FAILS both
 *     point 1 and point 2, and a row claiming an existing key is "not yet"
 *     (cluster) FAILS point 1. If either passed, the measure would be blind.
 *
 * Prerequisite: `npm run build -w @temporeum/timeline-docs` (the dist and the
 * packages' .d.ts files). A step that cannot run is a FAILURE, not a skip.
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

// --- the shared harness --------------------------------------------------------
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
/** The frappe-gantt rows' harness: one task per lane, with progress; the dependencies in `dependencies`. */
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

/** One row's example, as TypeScript. The browser gets the same, without types. */
/**
 * The harness registers every plugin, as a migrating page would: the
 * source library draws everything, and the rows' examples use the Gantt, the
 * group tree, the time tools, the item kinds and the dictionary too. The
 * error without a plugin is measured by the plugins check and the plugins-2 check, not here.
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

/** The version without TypeScript annotations, for the browser. */
function browserSource(row, library) {
  return ts.transpileModule(exampleSource(row, library), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}

// --- 1. the types' members -----------------------------------------------------
let checker;
let exportsByName;
function typeMembers(name) {
  if (checker === undefined) {
    // The element, the core, and the two core subpaths the frappe-gantt and vis rows refer to.
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

/** The errors in one row's member claims. */
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
    if (!found.known) problems.push(`"${row.vis}": the type ${found.type} is not among the public exports (${ref})`);
    else if (!found.has) problems.push(`"${row.vis}": the mapping points to a member that does not exist: ${ref}`);
  }
  for (const ref of row.absent ?? []) {
    const found = lookup(ref);
    if (!found.known) problems.push(`"${row.vis}": the type ${found.type} is not among the public exports (${ref})`);
    else if (found.has) problems.push(`"${row.vis}": claims "not yet", but it EXISTS: ${ref}`);
  }
  return problems;
}

// --- 2. compilation ------------------------------------------------------------
/** Compile errors of rows, per row. The files sit in the docs package so that they find the workspace packages (dist .d.ts). */
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
    failures.push(`the data file of the ${library} migration guide is missing (site/migration/${library}.json)`);
    continue;
  }
  const guide = JSON.parse(readFileSync(path, "utf8"));
  if (guide.library !== library) failures.push(`site/migration/${library}.json: the library field is ${JSON.stringify(guide.library)}`);
  const mappings = guide.rows.filter((row) => row.status !== "missing");
  const missing = guide.rows.filter((row) => row.status === "missing");
  if (mappings.length < MIN_MAPPINGS) failures.push(`${library}: only ${String(mappings.length)} mapping rows, at least ${String(MIN_MAPPINGS)} are required`);
  guides.push({ library, mappings, missing });
  for (const row of guide.rows) failures.push(...judgeMembers(row).map((problem) => `${library}: ${problem}`));
  if (!existsSync(join(repo, "packages", "web-component", "dist", "index.d.ts"))) {
    failures.push("no packages/web-component/dist — the build did not run, compilation cannot run, so this is a FAILURE");
  } else {
    const results = compileRows(mappings, library);
    for (const [index, row] of mappings.entries()) {
      if (results[index].length > 0) failures.push(`${library} "${row.vis}": the example does not compile — ${results[index].slice(0, 2).join(" | ")}`);
    }
    if (results.length > mappings.length) failures.push(`${library}: global compile error: ${results.at(-1).slice(0, 2).join(" | ")}`);
    else notes.push(`${library}: ${String(mappings.length)} mappings compile with strict TypeScript, against the published types`);
  }
  notes.push(`${library}: the keys of ${String(missing.length)} "not yet" rows really are missing (if there is no FAIL above)`);
}

// --- 4. negative control (on the type halves) -------------------------------------
const invented = { area: "Control", vis: "rollingMode", status: "renamed", temporeum: "rollingMode", uses: ["TimelineConfig.rollingMode"], config: "rollingMode: { follow: true }" };
const falseMissing = { area: "Control", vis: "cluster", status: "missing", absent: ["TimelineConfig.cluster"] };
if (judgeMembers(invented).length === 0) failures.push("NEGATIVE CONTROL: the member check of the invented mapping does NOT fail");
if (judgeMembers(falseMissing).length === 0) failures.push('NEGATIVE CONTROL: the row claiming an existing key is "not yet" does NOT fail');
if (existsSync(join(repo, "packages", "web-component", "dist", "index.d.ts")) && compileRows([invented])[0].length === 0) failures.push("NEGATIVE CONTROL: the invented option's example compiles without errors");
else notes.push("the negative control fails, as it should — invented mapping (members, compilation), false \"not yet\" (members)");

// --- 3. running in the browser -----------------------------------------------------
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
    failures.push("no packages/docs/dist — the build did not run, the run cannot run, so this is a FAILURE");
    return;
  }
  // The page's import map from the build (build-site.mjs IMPORTS), under /lib/.
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
  /** Running one row: a list of errors. */
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
      if (row.drawn !== false && options < 1) problems.push(`${String(options)} [role=option] in #timeline`);
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
        if (problems.length > 0) failures.push(`${library} "${row.vis}": the example does not run cleanly in the browser — ${problems.slice(0, 2).join(" | ")}`);
        else ran += 1;
      }
      notes.push(`${library}: ${String(ran)}/${String(mappings.length)} examples run in Chromium, without errors, with drawn items`);
    }
    // Negative control: a throwing example shows an error with the same measure.
    const thrown = await run({ vis: "control", after: 'throw new Error("control");' }, "control");
    if (thrown.length === 0) failures.push("NEGATIVE CONTROL: a throwing example does NOT fail in the browser");
  } finally {
    await browser.close();
    server.close();
    rmSync(join(dist, ".import-map.json"), { force: true });
  }
}

await runInBrowser();

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "migration: passed" : `migration: FAILED (${String(failures.length)} failure(s))`);
process.exit(failures.length === 0 ? 0 : 1);
