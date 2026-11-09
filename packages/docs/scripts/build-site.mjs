#!/usr/bin/env node
/**
 * Builds the docs site: packages/docs/site → packages/docs/dist.
 *
 *   site/nav.json            the order of the pages, in sections
 *   site/pages/**.md         the pages (the Markdown subset of markdown.mjs)
 *   site/examples/<id>/      the live examples: example.js, meta.json,
 *                            and an optional example.html (the body markup)
 *   site/assets/             the stylesheet, the playground script and the icon
 *   site/benchmark/          results.json, written by the throttled benchmark
 *   site/migration/<lib>.json the migration guides' mapping tables ({{migration:<lib>}})
 *   site/conformance/<name>.json the conformance report's table ({{acr:<name>}}), and the
 *                            same report as a VPAT® 2.5 INT ({{vpat:<name> <part>}})
 *   site/benchmark/field/results.json the field benchmark ({{bench:field}}, {{bench:field-method}}, {{bench:field-budget}}; scripts/field-bench.mjs)
 *   site/project.json        the public repository and the docs' address
 *
 * Next to the pages it writes llms.txt (every page, one line each) and
 * llms-full.txt (every page's Markdown, the migration tables included), the
 * form a language model reads a library's documentation in.
 *
 * The site runs the SHIPPED bundles: the dist of the core and the element
 * are copied to dist/lib and loaded through an import map, so what a reader
 * edits in a live example is the code they would install. Building them is
 * the npm script's job (`npm run build -w @temporeum/timeline-docs`); a
 * missing bundle fails here rather than producing a site whose examples
 * cannot run.
 *
 * The build fails on anything that would produce a broken page: a page not
 * in the navigation or a navigation entry without a page, an example that is
 * used nowhere or used and missing, a block the builder does not know, a
 * link to a page that does not exist. It writes dist/site-manifest.json,
 * which the example and accessibility suites read to know what to check —
 * so a page cannot be added without being checked.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml, parseMarkdown, renderBlocks, renderInline } from "./markdown.mjs";
import { fieldBudgetHtml, fieldMarkdown, fieldMethodHtml, fieldTablesHtml } from "./field-bench.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const DOCS_DIR = resolve(here, "..");
const REPO = resolve(DOCS_DIR, "..", "..");

const SITE_NAME = "Temporeum Timeline";

/**
 * The core's entry points come from its single list (packages/core/entries.json),
 * and its shared code from dist/chunks/: an entry point imports the engine's
 * code from there, so a live example that loads `index.mjs` needs the chunk too.
 * The chunks are read when the site is built, after the core is.
 */
const CORE_DIST = join(REPO, "packages", "core", "dist");
const CORE_ENTRIES = JSON.parse(readFileSync(join(REPO, "packages", "core", "entries.json"), "utf8")).entries;
const coreFiles = () => [
  ...CORE_ENTRIES.map((entry) => `${entry.name}.mjs`),
  ...(existsSync(join(CORE_DIST, "chunks")) ? readdirSync(join(CORE_DIST, "chunks")).filter((name) => name.endsWith(".mjs")).map((name) => `chunks/${name}`) : []),
];

/**
 * The element's entry points, from its package.json exports — `index` for
 * the root: a new plugin's entry point is on the site the day it is in the
 * package, as the core's are from entries.json.
 */
const ELEMENT_ENTRIES = Object.keys(JSON.parse(readFileSync(join(REPO, "packages", "web-component", "package.json"), "utf8")).exports)
  .filter((key) => key !== "./package.json")
  .map((key) => (key === "." ? "index" : key.slice(2)));

/** The import map every live example runs with: the entry points a host imports. */
export const LIB_FILES = {
  core: {
    from: CORE_DIST,
    get files() {
      return coreFiles();
    },
  },
  element: { from: join(REPO, "packages", "web-component", "dist"), files: [...ELEMENT_ENTRIES.map((name) => `${name}.mjs`), "element.shared.mjs"] },
};
export const IMPORTS = {
  ...Object.fromEntries(
    CORE_ENTRIES.map((entry) => [entry.name === "index" ? "@temporeum/timeline-core" : `@temporeum/timeline-core/${entry.name}`, `lib/core/${entry.name}.mjs`]),
  ),
  ...Object.fromEntries(
    ELEMENT_ENTRIES.map((name) => [name === "index" ? "@temporeum/timeline-element" : `@temporeum/timeline-element/${name}`, `lib/element/${name}.mjs`]),
  ),
};

function fail(message) {
  throw new Error(`docs build: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(DOCS_DIR, path)}: ${error.message}`);
  }
  return undefined;
}

function walkMarkdown(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walkMarkdown(path, `${prefix}${name}/`));
    else if (name.endsWith(".md")) out.push(`${prefix}${name.slice(0, -3)}`);
  }
  return out;
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// --- the examples --------------------------------------------------------------

export function loadExamples(docsDir = DOCS_DIR) {
  const root = join(docsDir, "site", "examples");
  const examples = new Map();
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id);
    if (!statSync(dir).isDirectory()) continue;
    if (!/^[a-z0-9-]+$/.test(id)) fail(`example "${id}": ids are lower-case letters, digits and dashes`);
    const metaPath = join(dir, "meta.json");
    const codePath = join(dir, "example.js");
    if (!existsSync(metaPath)) fail(`example "${id}" has no meta.json`);
    if (!existsSync(codePath)) fail(`example "${id}" has no example.js`);
    const meta = readJson(metaPath);
    if (typeof meta.title !== "string" || meta.title === "") fail(`example "${id}": meta.json needs a title`);
    if (!Array.isArray(meta.expect) || meta.expect.length === 0) {
      fail(`example "${id}": meta.json needs "expect" — what the running example must show, or the suite cannot tell it ran`);
    }
    for (const claim of meta.expect) {
      if (typeof claim.selector !== "string" || !(claim.min >= 1)) fail(`example "${id}": every expect entry is { selector, min >= 1 }`);
    }
    // "showcase": the result first and full width, the code folded away under it — for a demo, not a lesson.
    if (meta.layout !== undefined && meta.layout !== "showcase") fail(`example "${id}": layout is "showcase" or absent`);
    // A demo that turns vertical on a phone wants more height there than across a desktop.
    if (meta.narrowHeight !== undefined && !(Number.isInteger(meta.narrowHeight) && meta.narrowHeight > 0)) fail(`example "${id}": narrowHeight is a whole number of pixels`);
    // What the sandboxed frame may do beyond running scripts: save a file, open the print dialog. Never same-origin.
    const grants = meta.allow ?? [];
    if (!Array.isArray(grants) || grants.some((grant) => grant !== "downloads" && grant !== "modals")) fail(`example "${id}": allow is a list of "downloads" and "modals"`);
    const htmlPath = join(dir, "example.html");
    examples.set(id, {
      id,
      title: meta.title,
      layout: meta.layout ?? "lesson",
      height: meta.height ?? 360,
      narrowHeight: meta.narrowHeight,
      allow: grants,
      expect: meta.expect,
      code: readFileSync(codePath, "utf8"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : '<div id="timeline"></div>',
    });
  }
  return examples;
}

function renderExample(example) {
  const data = { id: example.id, title: example.title, html: example.html, height: example.height };
  const codeId = `example-${example.id}-code`;
  const showcase = example.layout === "showcase";
  const editor = [
    `<textarea id="${codeId}" spellcheck="false" autocapitalize="off" autocomplete="off" rows="16">${escapeHtml(example.code)}</textarea>`,
    `<div class="example-actions"><button type="button" data-action="run">Run</button><button type="button" data-action="reset">Reset</button></div>`,
  ];
  const frame = `<iframe class="example-frame" title="${escapeHtml(example.title)} — result" sandbox="${["allow-scripts", ...example.allow.map((grant) => `allow-${grant}`)].join(" ")}" style="height:${String(example.height)}px${example.narrowHeight === undefined ? "" : `;--frame-narrow:${String(example.narrowHeight)}px`}"${example.narrowHeight === undefined ? "" : " data-narrow"}></iframe>`;
  const code = showcase
    ? [`<details class="example-code"><summary>The code</summary><label for="${codeId}">Code — edit it and press Run</label>`, ...editor, `</details>`]
    : [`<div class="example-code"><label for="${codeId}">Code — edit it and press Run</label>`, ...editor, `</div>`];
  return [
    `<section class="example${showcase ? " example--showcase" : ""}" id="example-${example.id}" data-example="${example.id}" aria-label="Live example: ${escapeHtml(example.title)}">`,
    `<div class="example-head"><p class="example-title"><strong>${showcase ? "Live demo" : "Live example"}:</strong> ${escapeHtml(example.title)}</p>`,
    `<p class="example-status" role="status" aria-live="polite">Loading…</p></div>`,
    `<div class="example-body">`,
    ...(showcase ? [frame, ...code] : [...code, frame]),
    `</div>`,
    `<script type="application/json" class="example-data">${scriptJson(data)}</script>`,
    `</section>`,
  ].join("\n");
}

// --- the API tables, from the TypeScript sources ------------------------------------

let apiCache;
async function apiProgram() {
  if (apiCache !== undefined) return apiCache;
  const ts = (await import("typescript")).default;
  const entry = join(REPO, "packages", "web-component", "src", "index.ts");
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  apiCache = { ts, checker, exports };
  return apiCache;
}

/** The members of an exported interface, with their types and doc comments, as a table. */
async function apiTable(name) {
  const { ts, checker, exports } = await apiProgram();
  const aliased = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const symbol = exports.map(aliased).find((s) => s.getName() === name);
  if (symbol === undefined) fail(`{{api:${name}}}: no export of that name in @temporeum/timeline-element`);
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const rows = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    const memberType = checker.getTypeOfSymbolAtLocation(property, declaration);
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const isMethod = declaration !== undefined && (ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration));
    let typeText = checker.typeToString(memberType, declaration, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
    if (optional) typeText = typeText.replace(/ \| undefined$/, "");
    const doc = ts.displayPartsToString(property.getDocumentationComment(checker)).replace(/\s+/g, " ").trim();
    rows.push({ name: property.getName(), optional, isMethod, type: typeText, doc });
  }
  if (rows.length === 0) fail(`{{api:${name}}}: the type has no members`);
  const body = rows
    .map((row) => {
      const label = `<code>${escapeHtml(row.name)}${row.optional ? "?" : ""}</code>`;
      return `<tr><th scope="row">${label}</th><td><code>${escapeHtml(row.type)}</code></td><td>${row.doc === "" ? "" : renderInline(row.doc.replace(/\{@link ([^}]+)\}/g, "`$1`"))}</td></tr>`;
    })
    .join("");
  return {
    html: `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="api"><caption>${escapeHtml(name)} — generated from the TypeScript source</caption><thead><tr><th scope="col">Member</th><th scope="col">Type</th><th scope="col">What it is</th></tr></thead><tbody>${body}</tbody></table></div>`,
    members: rows.map((row) => row.name),
  };
}

// --- the benchmark tables --------------------------------------------------------

function benchTables(docsDir) {
  const path = join(docsDir, "site", "benchmark", "results.json");
  if (!existsSync(path)) fail("{{bench:results}}: site/benchmark/results.json is missing — run `npm run bench:compare -w @temporeum/timeline-docs`");
  const data = readJson(path);
  if (!Array.isArray(data.results) || data.results.length === 0) fail("benchmark results.json has no results");
  const libraries = Object.keys(data.libraries ?? {});
  const groups = new Map();
  for (const row of data.results) {
    const key = `${row.metric}\u0000${row.unit}\u0000${String(row.n)}`;
    if (!groups.has(key)) groups.set(key, { metric: row.metric, unit: row.unit, n: row.n, by: {} });
    groups.get(key).by[row.library] = row;
  }
  const fmt = (value) => (typeof value !== "number" ? "—" : Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2));
  const head = libraries.map((lib) => `<th scope="col">${escapeHtml(lib)} ${escapeHtml(data.libraries[lib]?.version ?? "")}</th>`).join("");
  const rows = [...groups.values()]
    .map((group) => {
      const cells = libraries
        .map((lib) => {
          const row = group.by[lib];
          return row === undefined ? "<td>—</td>" : `<td>${fmt(row.median)}<span class="range"> (${fmt(row.min)}–${fmt(row.max)})</span></td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(group.metric)}</th><td>${escapeHtml(String(group.n ?? "—"))}</td><td>${escapeHtml(group.unit)}</td>${cells}</tr>`;
    })
    .join("");
  const machine = data.machine ?? {};
  const settings = data.settings ?? {};
  const facts = [
    ["Measured", data.generatedAt],
    ["CPU", machine.cpu],
    ["OS", machine.os],
    ["Browser", machine.chromium],
    ["Node", machine.node],
    ["CPU slowdown", settings.throttle === undefined ? undefined : `${String(settings.throttle)}×`],
    ["Viewport", settings.viewport === undefined ? undefined : `${String(settings.viewport.width)} × ${String(settings.viewport.height)}`],
    ["Repetitions", settings.repetitions],
    ["Missed frame", settings.missedFrameDefinition],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`)
    .join("");
  return [
    `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="bench"><caption>Median of every repetition, with the range in brackets. Generated from site/benchmark/results.json.</caption>`,
    `<thead><tr><th scope="col">Metric</th><th scope="col">Items</th><th scope="col">Unit</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`,
    `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="bench-machine"><caption>Where and how it was measured</caption><tbody>${facts}</tbody></table></div>`,
  ].join("\n");
}

// --- the conformance report -------------------------------------------------------

const ACR_STATUS = { supports: "Supports", "partially-supports": "Partially supports", "does-not-support": "Does not support", "not-applicable": "Not applicable" };

/** A conformance report's criteria, checked for shape. `node scripts/sdk_check_acr.mjs` holds it to WCAG and runs its tests. */
export function loadConformance(name, docsDir = DOCS_DIR) {
  const path = join(docsDir, "site", "conformance", `${name}.json`);
  if (!existsSync(path)) fail(`{{acr:${name}}}: site/conformance/${name}.json is missing`);
  const data = readJson(path);
  if (!Array.isArray(data.criteria) || data.criteria.length === 0) fail(`site/conformance/${name}.json has no criteria`);
  for (const row of data.criteria) {
    const at = `site/conformance/${name}.json ${String(row.id)}`;
    if (!(row.status in ACR_STATUS)) fail(`${at}: status is one of ${Object.keys(ACR_STATUS).join(", ")}`);
    if (typeof row.remarks !== "string" || row.remarks === "") fail(`${at}: every criterion says why`);
    if (!Array.isArray(row.tests)) fail(`${at}: needs tests (an empty list where none applies)`);
    if (row.status === "supports" && row.tests.length === 0) fail(`${at}: "supports" needs a test that shows it`);
  }
  return data;
}

function acrHtml(name, docsDir) {
  const data = loadConformance(name, docsDir);
  const counts = Object.entries(ACR_STATUS)
    .map(([status, label]) => [label, data.criteria.filter((row) => row.status === status).length])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}: ${String(count)}`)
    .join(" · ");
  const body = data.criteria
    .map((row) => {
      const tests = row.tests.map((ref) => `<code>${escapeHtml(ref.file.replace(/^packages\//, ""))}</code> — ${escapeHtml(ref.test)}`).join("<br>");
      return `<tr class="acr-${row.status}"><th scope="row">${escapeHtml(row.id)} ${escapeHtml(row.name ?? "")}</th><td>${escapeHtml(row.level ?? "")}</td><td>${ACR_STATUS[row.status]}</td><td>${renderInline(row.remarks)}</td><td>${tests || "—"}</td></tr>`;
    })
    .join("");
  return `<p class="acr-summary">${escapeHtml(counts)}</p>\n<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="acr"><caption>${escapeHtml(data.standard)} levels ${escapeHtml(data.levels.join(" and "))}, for ${escapeHtml(data.product)} ${escapeHtml(data.version)}. Generated from site/conformance/${escapeHtml(name)}.json.</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Status</th><th scope="col">Remarks</th><th scope="col">Shown by</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** The same table as Markdown, for llms-full.txt. */
export function acrMarkdown(name, docsDir = DOCS_DIR) {
  const data = loadConformance(name, docsDir);
  const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = data.criteria
    .map((row) => `| ${row.id} ${cell(row.name ?? "")} | ${row.level ?? ""} | ${ACR_STATUS[row.status]} | ${cell(row.remarks)} | ${cell(row.tests.map((ref) => `${ref.file} — ${ref.test}`).join("; ") || "—")} |`)
    .join("\n");
  return `| Criterion | Level | Status | Remarks | Shown by |\n|---|---|---|---|---|\n${rows}`;
}

// --- the VPAT -----------------------------------------------------------------------

/**
 * The same report in the layout of the ITI VPAT® 2.5, International Edition
 * ({{vpat:<name> <part>}}): one block per part of it, read from the same
 * file as {{acr:<name>}}, so the two cannot say different things.
 *
 *   product    name and version, date, description, contact, notes, evaluation methods
 *   A, AA      the WCAG 2.2 tables, each row with the EN 301 549 and Section 508 clauses it is also
 *   en301549   EN 301 549's chapters, chapter 9 mapped to the WCAG tables
 *   section508 the Revised Section 508's chapters, E205 mapped to the WCAG tables
 */
const VPAT_PARTS = ["product", "A", "AA", "en301549", "section508"];
const VPAT_STATUS = {
  supports: "Supports",
  "partially-supports": "Partially Supports",
  "does-not-support": "Does Not Support",
  "not-applicable": "Not Applicable",
  "not-evaluated": "Not Evaluated",
  wcag: "See the WCAG 2.2 tables",
};
/**
 * The A and AA criteria WCAG 2.1 and 2.2 added. EN 301 549 (V3.2.1) takes
 * WCAG 2.1, so it has no clause for a 2.2 criterion; the Revised Section 508
 * takes WCAG 2.0, so it has none for either.
 */
const WCAG21_ADDED = new Set(["1.3.4", "1.3.5", "1.4.10", "1.4.11", "1.4.12", "1.4.13", "2.1.4", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "4.1.3"]);
const WCAG22_ADDED = new Set(["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]);

/** The report, checked for what the VPAT needs beyond the ACR: the version it is about, the date, the chapters. */
function loadVpat(name, docsDir) {
  const data = loadConformance(name, docsDir);
  const at = `site/conformance/${name}.json`;
  const version = readJson(join(REPO, "packages", "core", "package.json")).version;
  if (data.version !== version) fail(`${at} reports on version ${String(data.version)}, the core is ${version} — look the report over for this version and change its "version"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) fail(`${at}: "date" is the day the report was made, YYYY-MM-DD`);
  if (typeof data.description !== "string" || !Array.isArray(data.evaluation) || data.evaluation.length === 0) fail(`${at}: the VPAT needs "description" and "evaluation"`);
  for (const part of ["en301549", "section508"]) {
    const rows = data.chapters?.[part];
    if (!Array.isArray(rows) || rows.length === 0) fail(`${at}: "chapters.${part}" is missing`);
    for (const row of rows) {
      if (!(row.status in VPAT_STATUS) || typeof row.remarks !== "string" || row.remarks === "") fail(`${at} chapters.${part} ${String(row.chapter)}: needs a status (${Object.keys(VPAT_STATUS).join(", ")}) and remarks`);
    }
  }
  return data;
}

/** The clauses of the other two standards that are this criterion, and its status under them. */
function vpatAlso(row) {
  const en = WCAG22_ADDED.has(row.id) ? null : `9.${row.id} (Web)`;
  const section508 = WCAG21_ADDED.has(row.id) || WCAG22_ADDED.has(row.id) ? null : "501 (Web), through E205.4";
  return { en, section508, earlier: row.earlier };
}

function vpatAlsoText(row) {
  const { en, section508 } = vpatAlso(row);
  if (en === null) return "New in WCAG 2.2: not in EN 301 549 or the Revised Section 508.";
  return `Also applies to: EN 301 549 ${en}${section508 === null ? "; not the Revised Section 508, which takes WCAG 2.0" : `; Revised Section 508 ${section508}`}.`;
}

function vpatConformance(row) {
  const { earlier } = vpatAlso(row);
  return earlier === undefined
    ? [`Web: ${VPAT_STATUS[row.status]}`]
    : [`Web (WCAG 2.2): ${VPAT_STATUS[row.status]}`, `Web (EN 301 549, Section 508): ${VPAT_STATUS[earlier.status]}`];
}

function vpatHtml(argument, docsDir) {
  const [name, part] = argument.split(/\s+/);
  if (!VPAT_PARTS.includes(part)) fail(`{{vpat:${argument}}}: the part is one of ${VPAT_PARTS.join(", ")}`);
  const data = loadVpat(name, docsDir);
  const wrap = (table) => `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen">${table}</div>`;
  if (part === "product") {
    const contact = `${PROJECT.repository}/issues`;
    const facts = [
      ["Name of product and version", escapeHtml(`${data.product} ${data.version}`)],
      ["Report date", escapeHtml(data.date)],
      ["Product description", renderInline(data.description)],
      ["Contact information", `<a href="${escapeHtml(contact)}">${escapeHtml(contact)}</a>`],
      ["Notes", renderInline(data.scope)],
      ["Evaluation methods used", `<ul>${data.evaluation.map((method) => `<li>${renderInline(method)}</li>`).join("")}</ul>`],
    ];
    return wrap(`<table class="vpat-product"><caption>The product and how it was evaluated. Generated from site/conformance/${escapeHtml(name)}.json.</caption><tbody>${facts.map(([key, value]) => `<tr><th scope="row">${key}</th><td>${value}</td></tr>`).join("")}</tbody></table>`);
  }
  if (part === "A" || part === "AA") {
    const body = data.criteria
      .filter((row) => row.level === part)
      .map((row) => {
        const remarks = [row.remarks, row.earlier?.remarks].filter(Boolean).map((text) => renderInline(text)).join(" ");
        return `<tr class="acr-${row.status}"><th scope="row">${escapeHtml(row.id)} ${escapeHtml(row.name)} (Level ${part})<br><span class="vpat-also">${escapeHtml(vpatAlsoText(row))}</span></th><td>${vpatConformance(row).map(escapeHtml).join("<br>")}</td><td>${remarks}</td></tr>`;
      })
      .join("");
    return wrap(`<table class="vpat"><caption>${part === "A" ? "Table 1" : "Table 2"}: Success Criteria, Level ${part}. Generated from site/conformance/${escapeHtml(name)}.json, as is the conformance report.</caption><thead><tr><th scope="col">Criteria</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead><tbody>${body}</tbody></table>`);
  }
  const standard = part === "en301549" ? "EN 301 549" : "Revised Section 508";
  const body = data.chapters[part]
    .map((row) => `<tr><th scope="row">${/^\d+$/.test(row.chapter) ? "Chapter " : ""}${escapeHtml(row.chapter)}: ${escapeHtml(row.title)}</th><td>${escapeHtml(VPAT_STATUS[row.status])}</td><td>${renderInline(row.remarks)}</td></tr>`)
    .join("");
  return wrap(`<table class="vpat-chapters"><caption>${standard}, chapter by chapter. Generated from site/conformance/${escapeHtml(name)}.json.</caption><thead><tr><th scope="col">Chapter</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead><tbody>${body}</tbody></table>`);
}

/** The same blocks as Markdown, for llms-full.txt. */
export function vpatMarkdown(argument, docsDir = DOCS_DIR) {
  const [name, part] = argument.split(/\s+/);
  const data = loadVpat(name, docsDir);
  const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (part === "product") {
    return [
      `- Name of product and version: ${data.product} ${data.version}`,
      `- Report date: ${data.date}`,
      `- Product description: ${data.description}`,
      `- Contact information: ${PROJECT.repository}/issues`,
      `- Notes: ${data.scope}`,
      "- Evaluation methods used:",
      ...data.evaluation.map((method) => `  - ${method}`),
    ].join("\n");
  }
  if (part === "A" || part === "AA") {
    const rows = data.criteria
      .filter((row) => row.level === part)
      .map((row) => `| ${row.id} ${cell(row.name)} (Level ${part}). ${cell(vpatAlsoText(row))} | ${cell(vpatConformance(row).join("; "))} | ${cell([row.remarks, row.earlier?.remarks].filter(Boolean).join(" "))} |`)
      .join("\n");
    return `| Criteria | Conformance Level | Remarks and Explanations |\n|---|---|---|\n${rows}`;
  }
  const rows = data.chapters[part].map((row) => `| ${cell(row.chapter)}: ${cell(row.title)} | ${VPAT_STATUS[row.status]} | ${cell(row.remarks)} |`).join("\n");
  return `| Chapter | Conformance Level | Remarks and Explanations |\n|---|---|---|\n${rows}`;
}

// --- the migration tables ---------------------------------------------------------

const MIGRATION_STATUS = { same: "Same", renamed: "Renamed", different: "Different", missing: "Not yet" };

/** A migration guide's rows, checked for shape. The test runs every one of them. */
export function loadMigration(name, docsDir = DOCS_DIR) {
  const path = join(docsDir, "site", "migration", `${name}.json`);
  if (!existsSync(path)) fail(`{{migration:${name}}}: site/migration/${name}.json is missing`);
  const data = readJson(path);
  if (!Array.isArray(data.rows) || data.rows.length === 0) fail(`site/migration/${name}.json has no rows`);
  for (const [index, row] of data.rows.entries()) {
    const at = `site/migration/${name}.json row ${String(index + 1)} (${String(row.vis)})`;
    if (typeof row.area !== "string" || typeof row.vis !== "string" || row.vis === "") fail(`${at}: needs area and vis`);
    if (!(row.status in MIGRATION_STATUS)) fail(`${at}: status is one of ${Object.keys(MIGRATION_STATUS).join(", ")}`);
    if (row.status === "missing") {
      if (!Array.isArray(row.absent) || row.absent.length === 0) fail(`${at}: a "missing" row names the keys that must not exist (absent)`);
      if (row.config !== undefined || row.after !== undefined || row.before !== undefined) fail(`${at}: a "missing" row has no example`);
    } else {
      if (typeof row.temporeum !== "string" || row.temporeum === "") fail(`${at}: needs the Temporeum side`);
      if (!Array.isArray(row.uses)) fail(`${at}: needs uses (the members it maps to)`);
      if (row.config === undefined && row.after === undefined && row.before === undefined) fail(`${at}: every mapping is a running example — give config, before or after`);
    }
  }
  return data;
}

function migrationHtml(name, docsDir) {
  const data = loadMigration(name, docsDir);
  const areas = [...new Set(data.rows.map((row) => row.area))];
  return areas
    .map((area) => {
      const body = data.rows
        .filter((row) => row.area === area)
        .map((row) => {
          const ours = row.status === "missing" ? `<td>—</td>` : `<td><code>${escapeHtml(row.temporeum)}</code></td>`;
          const note = [row.note, row.planned ? `<em>${escapeHtml(row.planned[0].toUpperCase() + row.planned.slice(1))}.</em>` : ""].filter(Boolean);
          return `<tr class="migration-${row.status}"><th scope="row"><code>${escapeHtml(row.vis)}</code></th>${ours}<td>${MIGRATION_STATUS[row.status]}</td><td>${note.map((part) => (part.startsWith("<em>") ? part : renderInline(part))).join(" ")}</td></tr>`;
        })
        .join("");
      return `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="migration"><caption>${escapeHtml(area)}</caption><thead><tr><th scope="col">${escapeHtml(data.library)}</th><th scope="col">Temporeum</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead><tbody>${body}</tbody></table></div>`;
    })
    .join("\n");
}

/** The same tables as Markdown, for llms-full.txt. */
export function migrationMarkdown(name, docsDir = DOCS_DIR) {
  const data = loadMigration(name, docsDir);
  const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const areas = [...new Set(data.rows.map((row) => row.area))];
  return areas
    .map((area) => {
      const rows = data.rows
        .filter((row) => row.area === area)
        .map((row) => `| \`${cell(row.vis)}\` | ${row.status === "missing" ? "—" : `\`${cell(row.temporeum)}\``} | ${MIGRATION_STATUS[row.status]} | ${cell([row.note, row.planned].filter(Boolean).join(" "))} |`)
        .join("\n");
      return `### ${area}\n\n| ${data.library} | Temporeum | Status | Notes |\n|---|---|---|---|\n${rows}`;
    })
    .join("\n\n");
}

// --- llms.txt ---------------------------------------------------------------------

/**
 * llms.txt and llms-full.txt (https://llmstxt.org): the documentation in the
 * form a language model reads it. Every page, in navigation order; the full
 * file inlines every page's Markdown with its live examples' code and the
 * generated tables a reader sees, so nothing on the site is missing from it.
 */
function llmsFiles({ docsDir, navSpec, pages, examples }) {
  const docsUrl = PROJECT.docs.replace(/\/?$/, "/");
  const index = [
    `# ${SITE_NAME}`,
    "",
    "> An editable, accessible, responsive timeline for the web: a custom element and a live instance (`@temporeum/timeline-element`), components for React, Vue, Svelte and Angular (`@temporeum/timeline-react`, `-vue`, `-svelte`, `-angular`), and a DOM-free engine with zero runtime dependencies (`@temporeum/timeline-core`). MIT licensed.",
    "",
    `Install: \`npm install @temporeum/timeline-element\`. Times are \`Date\` objects or epoch milliseconds. Every edit is emitted as a reversible command; the library never saves. Repository: ${PROJECT.repository}`,
    "",
  ];
  const full = [...index];
  for (const section of navSpec) {
    index.push(`## ${section.section}`, "");
    for (const id of section.pages) {
      const page = pages.find((entry) => entry.id === id);
      index.push(`- [${page.title}](${docsUrl}${id}.html): ${page.description}`);
      let source = readFileSync(join(docsDir, "site", "pages", `${id}.md`), "utf8");
      source = source.replace(/^::: example ([a-z0-9-]+)\s*$/gm, (_, exampleId) => {
        const example = examples.get(exampleId);
        return `Live example — ${example.title}:\n\n\`\`\`js\n${example.code.trim()}\n\`\`\``;
      });
      source = source.replace(/^\{\{migration:([a-z0-9-]+)\}\}\s*$/gm, (_, name) => migrationMarkdown(name, docsDir));
      source = source.replace(/^\{\{acr:([a-z0-9-]+)\}\}\s*$/gm, (_, name) => acrMarkdown(name, docsDir));
      source = source.replace(/^\{\{vpat:([^}]+)\}\}\s*$/gm, (_, argument) => vpatMarkdown(argument.trim(), docsDir));
      source = source.replace(/^\{\{bench:(field[a-z-]*)\}\}\s*$/gm, (_, block) => fieldMarkdown(block, docsDir));
      source = source.replace(/^\{\{([a-z]+)(?::[^}]*)?\}\}\s*$/gm, (_, slot) => `(The ${slot} table is generated on the page: ${docsUrl}${id}.html)`);
      full.push(`<!-- ${docsUrl}${id}.html -->`, "", source.trim(), "");
    }
    index.push("");
  }
  index.push("## Optional", "", `- [Full documentation in one file](${docsUrl}llms-full.txt)`, "");
  return { index: `${index.join("\n").trim()}\n`, full: `${full.join("\n").trim()}\n` };
}

// --- the changelog ------------------------------------------------------------------

const CHANGELOGS = [
  ["@temporeum/timeline-core", join(REPO, "packages", "core", "CHANGELOG.md")],
  ["@temporeum/timeline-element", join(REPO, "packages", "web-component", "CHANGELOG.md")],
  ["@temporeum/timeline-react", join(REPO, "packages", "react", "CHANGELOG.md")],
  ["@temporeum/timeline-vue", join(REPO, "packages", "vue", "CHANGELOG.md")],
  ["@temporeum/timeline-svelte", join(REPO, "packages", "svelte", "CHANGELOG.md")],
  ["@temporeum/timeline-angular", join(REPO, "packages", "angular", "CHANGELOG.md")],
];

function changelogHtml(hooks) {
  return CHANGELOGS.map(([name, path]) => {
    if (!existsSync(path)) fail(`{{changelog}}: ${relative(REPO, path)} is missing`);
    // Each file's own title is the package name; its headings move two levels down.
    // The note before the first release heading is the same in every file: the page says it once.
    const parsed = parseMarkdown(readFileSync(path, "utf8"));
    const firstRelease = parsed.findIndex((block) => block.type === "heading" && block.level === 2);
    const blocks = parsed
      .filter((block, index) => !(index === 0 && block.type === "heading" && block.level === 1) && !(index < firstRelease && block.type !== "heading"))
      .map((block) => (block.type === "heading" ? { ...block, level: Math.min(block.level + 1, 4) } : block));
    return `<h2 id="${name.replace(/[@/]/g, "-").replace(/^-/, "")}"><code>${escapeHtml(name)}</code></h2>\n${renderBlocks(blocks, hooks).html}`;
  }).join("\n");
}

// --- the page shell -----------------------------------------------------------------

/**
 * A paragraph as one line of plain text, at most 160 characters, cut at a
 * word: a link keeps its text, inline code its code (V36 — the parentheses
 * went with their content, and the cut fell inside a word).
 */
function summaryOf(markdown) {
  const plain = markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
  return plain.length <= 160 ? plain : `${plain.slice(0, plain.lastIndexOf(" ", 159))}…`;
}

function pageShell({ title, base, nav, current, body, outline, hasExamples, version, prevNext, description }) {
  const navHtml = nav
    .map(
      (section) =>
        `<p class="nav-title">${escapeHtml(section.section)}</p><ul>${section.pages
          .map((page) => `<li><a href="${base}${page.id}.html"${page.id === current ? ' aria-current="page"' : ""}>${escapeHtml(page.title)}</a></li>`)
          .join("")}</ul>`,
    )
    .join("");
  const toc =
    outline.length > 1
      ? `<nav class="toc" aria-label="On this page"><p class="nav-title">On this page</p><ul>${outline
          .map((entry) => `<li class="toc-${String(entry.level)}"><a href="#${entry.id}">${renderInline(entry.text)}</a></li>`)
          .join("")}</ul></nav>`
      : "";
  const pager = `<nav class="pager" aria-label="Previous and next page">${
    prevNext.prev ? `<a rel="prev" href="${base}${prevNext.prev.id}.html">← ${escapeHtml(prevNext.prev.title)}</a>` : "<span></span>"
  }${prevNext.next ? `<a rel="next" href="${base}${prevNext.next.id}.html">${escapeHtml(prevNext.next.title)} →</a>` : "<span></span>"}</nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title === SITE_NAME ? SITE_NAME : `${escapeHtml(title)} — ${SITE_NAME}`}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><a class="brand" href="${base}index.html">${SITE_NAME}</a><span class="version">v${escapeHtml(version)}</span></header>
<div class="layout">
<nav class="side" aria-label="Documentation">${navHtml}</nav>
<main id="main" tabindex="-1">
${toc}
<article>
${body}
</article>
${pager}
</main>
</div>
<footer class="bottom"><p>MIT licensed. Every live example on this site runs the published bundles, and every code block is checked against one (the examples check).</p></footer>
${hasExamples ? `<script type="application/json" id="import-map-data">${scriptJson(IMPORTS)}</script>\n<script type="module" src="${base}assets/playground.js"></script>` : ""}
</body>
</html>
`;
}

// --- the build ----------------------------------------------------------------------

export async function buildSite({ docsDir = DOCS_DIR, outDir = join(DOCS_DIR, "dist") } = {}) {
  const siteDir = join(docsDir, "site");
  const pagesDir = join(siteDir, "pages");
  const navSpec = readJson(join(siteDir, "nav.json"));
  const version = readJson(join(REPO, "packages", "core", "package.json")).version;

  // Every page in the navigation, and every navigation entry a page.
  const onDisk = new Set(walkMarkdown(pagesDir));
  const inNav = navSpec.flatMap((section) => section.pages);
  for (const id of inNav) if (!onDisk.has(id)) fail(`nav.json lists "${id}", but site/pages/${id}.md does not exist`);
  for (const id of onDisk) if (!inNav.includes(id)) fail(`site/pages/${id}.md is not in nav.json — a page nobody can reach`);
  if (new Set(inNav).size !== inNav.length) fail("nav.json lists a page twice");

  const examples = loadExamples(docsDir);
  const pages = inNav.map((id) => {
    const source = readFileSync(join(pagesDir, `${id}.md`), "utf8");
    let blocks;
    try {
      blocks = parseMarkdown(source);
    } catch (error) {
      fail(`site/pages/${id}.md: ${error.message}`);
    }
    const first = blocks[0];
    if (first?.type !== "heading" || first.level !== 1) fail(`site/pages/${id}.md must start with a level-1 heading`);
    const intro = blocks.find((block) => block.type === "paragraph");
    return { id, title: first.text.replace(/`/g, ""), blocks, description: intro ? summaryOf(intro.text) : first.text };
  });
  const byId = new Map(pages.map((page) => [page.id, page]));

  // Where each example lives: one page, exactly.
  const exampleHome = new Map();
  for (const page of pages) {
    for (const block of page.blocks.filter((b) => b.type === "example")) {
      if (!examples.has(block.id)) fail(`site/pages/${page.id}.md:${String(block.line)}: no example "${block.id}" in site/examples`);
      if (exampleHome.has(block.id)) fail(`example "${block.id}" is shown on two pages (${exampleHome.get(block.id)}, ${page.id}); show it on one and excerpt it elsewhere`);
      exampleHome.set(block.id, page.id);
    }
  }
  for (const id of examples.keys()) if (!exampleHome.has(id)) fail(`example "${id}" is on no page — an example nobody sees is one nobody keeps working`);
  const frameworksPage = pages.find((page) => page.blocks.some((block) => block.type === "slot" && block.name === "templates"))?.id;

  // The shipped bundles.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, lib] of Object.entries(LIB_FILES)) {
    mkdirSync(join(outDir, "lib", name), { recursive: true });
    for (const file of lib.files) {
      const from = join(lib.from, file);
      if (!existsSync(from)) fail(`${relative(REPO, from)} is missing — build the packages first (npm run build -w @temporeum/timeline-docs does)`);
      mkdirSync(dirname(join(outDir, "lib", name, file)), { recursive: true });
      copyFileSync(from, join(outDir, "lib", name, file));
      if (existsSync(`${from}.map`)) copyFileSync(`${from}.map`, join(outDir, "lib", name, `${file}.map`));
    }
  }
  mkdirSync(join(outDir, "assets"), { recursive: true });
  for (const file of readdirSync(join(siteDir, "assets"))) copyFileSync(join(siteDir, "assets", file), join(outDir, "assets", file));

  const manifest = { version, pages: [], examples: [], excerpts: [], apiTables: [] };
  const navForShell = navSpec.map((section) => ({ section: section.section, pages: section.pages.map((id) => ({ id, title: byId.get(id).title })) }));

  for (const [index, page] of pages.entries()) {
    const depth = page.id.split("/").length - 1;
    const base = "../".repeat(depth);
    const pageDir = posix.dirname(page.id);
    const href = (target) => {
      if (/^[a-z]+:/.test(target) || target.startsWith("#")) return target;
      const [path, hash] = target.split("#");
      if (!path.endsWith(".md")) return target;
      const resolved = posix.normalize(posix.join(pageDir === "." ? "" : pageDir, path)).replace(/\.md$/, "");
      if (!byId.has(resolved)) fail(`site/pages/${page.id}.md links to ${target}, which is not a page`);
      return `${posix.relative(pageDir === "." ? "" : pageDir, resolved) || posix.basename(resolved)}.html${hash ? `#${hash}` : ""}`;
    };
    const excerptHref = (ref) => {
      const [kind, name] = ref.split("/");
      if (kind === "example" && exampleHome.has(name)) return `${base}${exampleHome.get(name)}.html#example-${name}`;
      if (kind === "template" && frameworksPage) return `${base}${frameworksPage}.html#template-${name}`;
      return "#";
    };
    const slots = [];
    for (const block of page.blocks.filter((b) => b.type === "slot")) {
      if (block.name === "api") {
        const table = await apiTable(block.argument);
        manifest.apiTables.push({ page: page.id, name: block.argument, members: table.members });
        slots.push(table.html);
      } else if (block.name === "bench") {
        if (block.argument === "results") slots.push(benchTables(docsDir));
        else if (block.argument === "field") slots.push(fieldTablesHtml(docsDir));
        else if (block.argument === "field-method") slots.push(fieldMethodHtml(docsDir));
        else if (block.argument === "field-budget") slots.push(fieldBudgetHtml(docsDir));
        else fail(`site/pages/${page.id}.md:${String(block.line)}: unknown {{bench:${block.argument}}}`);
      } else if (block.name === "changelog") {
        slots.push(changelogHtml({ href, excerptHref }));
      } else if (block.name === "templates") {
        slots.push(templatesHtml(docsDir));
      } else if (block.name === "migration") {
        slots.push(migrationHtml(block.argument, docsDir));
      } else if (block.name === "acr") {
        slots.push(acrHtml(block.argument, docsDir));
      } else if (block.name === "vpat") {
        slots.push(vpatHtml(block.argument, docsDir));
      } else {
        fail(`site/pages/${page.id}.md:${String(block.line)}: unknown block {{${block.name}}}`);
      }
    }
    let slotIndex = 0;
    const { html, outline } = renderBlocks(page.blocks, {
      href,
      excerptHref,
      example: (block) => renderExample(examples.get(block.id)),
      slot: () => slots[slotIndex++],
    });
    const hasExamples = page.blocks.some((block) => block.type === "example");
    const out = join(outDir, `${page.id}.html`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      pageShell({
        title: page.title,
        base,
        nav: navForShell,
        current: page.id,
        body: html,
        outline,
        hasExamples,
        version,
        description: page.description,
        prevNext: { prev: pages[index - 1], next: pages[index + 1] },
      }),
    );
    manifest.pages.push({ id: page.id, title: page.title, path: `${page.id}.html` });
    for (const block of page.blocks) {
      if (block.type === "example") manifest.examples.push({ ...examples.get(block.id), code: undefined, html: undefined, page: page.id, path: `${page.id}.html` });
      if (block.type === "code") manifest.excerpts.push({ file: `packages/docs/site/pages/${page.id}.md`, line: block.line, lang: block.lang, excerpt: block.excerpt });
    }
  }
  const llms = llmsFiles({ docsDir, navSpec, pages, examples });
  writeFileSync(join(outDir, "llms.txt"), llms.index);
  writeFileSync(join(outDir, "llms-full.txt"), llms.full);
  manifest.llms = ["llms.txt", "llms-full.txt"];
  writeFileSync(join(outDir, "site-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// --- the templates block ------------------------------------------------------------

/** The framework templates, one entry per folder under templates/. */
export function listTemplates(docsDir = DOCS_DIR) {
  const root = join(docsDir, "templates");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .filter((name) => existsSync(join(root, name, "package.json")))
    .map((name) => {
      const manifest = readJson(join(root, name, "package.json"));
      return { name, title: manifest.description ?? name, start: manifest.scripts?.dev ?? "" };
    });
}

/** The public repository and its branch: one place, site/project.json. */
const PROJECT = JSON.parse(readFileSync(join(DOCS_DIR, "site", "project.json"), "utf8"));
const REPO_URL = PROJECT.repository;
const TEMPLATE_BRANCH = PROJECT.branch;

function templatesHtml(docsDir) {
  const templates = listTemplates(docsDir);
  if (templates.length === 0) fail("{{templates}}: there are no templates under packages/docs/templates");
  const rows = templates
    .map((template) => {
      const path = `packages/docs/templates/${template.name}`;
      const stackblitz = `https://stackblitz.com/github/${REPO_URL.replace(/^https:\/\/github\.com\//, "")}/tree/${TEMPLATE_BRANCH}/${path}`;
      return `<tr id="template-${template.name}"><th scope="row"><code>${escapeHtml(template.name)}</code></th><td>${escapeHtml(template.title)}</td><td><code>${escapeHtml(path)}</code></td><td><a href="${escapeHtml(stackblitz)}">Open in StackBlitz<span class="visually-hidden">: ${escapeHtml(template.name)}</span></a></td></tr>`;
    })
    .join("");
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table class="templates"><caption>Starter projects. Each one is built and run in a real browser on every check of the examples, from the packed packages.</caption><thead><tr><th scope="col">Template</th><th scope="col">What it is</th><th scope="col">Folder in <a href="${REPO_URL}">the repository</a></th><th scope="col">Online</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await buildSite();
    console.log(
      `docs: ${String(manifest.pages.length)} pages, ${String(manifest.examples.length)} live examples, ${String(manifest.excerpts.length)} code blocks, ${String(manifest.apiTables.length)} API tables → packages/docs/dist`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
