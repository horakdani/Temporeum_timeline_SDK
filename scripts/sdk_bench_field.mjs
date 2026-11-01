#!/usr/bin/env node
/**
 * G-BENCH-LABELS es G-PAN-MEMORY (P17): a meres a vis-osszevetes SAJAT
 * lapjan (packages/docs/bench/temporeum.html), 10 000 elemmel, ugyanazzal a
 * bemenettel, mint a sdk_bench_compare.mjs: 1440 x 900, DPR 1, 4x CPU-
 * lassitas a navigacio elott, friss bongeszo-kontextus minden lapnak.
 *
 *   node scripts/sdk_bench_field.mjs labels      -> packages/docs/.bench-labels.json
 *   node scripts/sdk_bench_field.mjs pan-memory  -> packages/docs/.bench-pan-memory.json
 *
 * A szkript nem itel: a nyers merest irja ki, a sdk_check_bench_labels.mjs
 * es a sdk_check_pan_memory.mjs dont. Ket lap fajta, FIELD_REPS (3) friss
 * lapon mindketto:
 *
 *  - PASZTAZAS-lap (mindket modban): a `ready` utan GC, heap; a lathato
 *    elemek es a lathato elemek cimkei (nyugalomban); aztan 24 valodi
 *    egerhuzas 240 px-szel a tengelysavon (12 elore, 12 vissza), huzasonkent
 *    400 ms, ~16 ms-onkent mozgassal, 100 ms szunettel — a kepkockak rAF-fel
 *    a teljes sorozat alatt; a vegen GC, heap, csomopontok.
 *  - ZOOM-lap (csak `labels`): friss lap, a nezet kozepen Control + valodi
 *    gorgo, 8 lepes be es 8 ki 50 ms-onkent, lepesenkent 1,2x (deltaY 45,6),
 *    a felvetel az utolso lepes utan meg 300 ms-ig tart. Utana, a felvetelen
 *    kivul, a SURUSEGI HATAR: annyi 1,2x-es gorgo-lepes be, hogy egy
 *    nezetszelessegre a core SHORTEN_DENSITY_LIMIT-jenek (1000) legfeljebb
 *    85%-a jusson, nyugalomig var, es megszamolja a lathato elemeket es a
 *    cimkeiket (P17, a tulajdonos "cel" dontese: a cimke-allitas a hatarig
 *    szol, a 10 000 elemes nezet a teljesitmenye).
 *
 * Kihagyott kepkocka ugyanugy, mint az osszevetesben: V = 1000/60 ms, egy
 * d > 1,5 V rAF-koz round(d / V) - 1 elveszett kepkocka; arany = elveszett /
 * (elveszett + rogzitett kozok).
 *
 * Ervenyesseg (a riportba kerul, a check bukik rajta): sajat szerver, sajat
 * port (41766, TL_BENCH_FIELD_PORT), a lap jeloloje; FRISS dist (a core es
 * az element build.json forras-lenyomata egyezik a forrassal); a huzas
 * tenyleg mozgatta a nezetet (+2880 px +-25% 12 huzas utan, vissza egy
 * huzason belulre 24 utan); a zoom 4x fole ert es visszajott; egyetlen
 * huzas vagy gorgo sem szerkesztett elemet.
 */

/* global document, fetch, setTimeout, window */

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { sourceHash } from "../packages/core/scripts/fingerprint.mjs";
import { SHORTEN_DENSITY_LIMIT } from "../packages/core/dist/index.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "packages", "docs");
const coreDir = join(repoRoot, "packages", "core");
const elementDir = join(repoRoot, "packages", "web-component");
const PORT = Number(process.env.TL_BENCH_FIELD_PORT ?? 41766);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VIEWPORT = { width: 1440, height: 900 };
const THROTTLE = 4;
const REPS = Number(process.env.FIELD_REPS ?? 3);
const N = 10_000;
const VSYNC = 1000 / 60;
const PAN = { drags: 24, forward: 12, distancePx: 240, durationMs: 400, moveEveryMs: 16, gapMs: 100, startX: 1100 };
const ZOOM = { notches: 8, intervalMs: 50, deltaY: Math.log(1.2) / 0.004, tailMs: 300 };

const kind = process.argv[2];
if (kind !== "labels" && kind !== "pan-memory") {
  console.error("hasznalat: node scripts/sdk_bench_field.mjs labels|pan-memory");
  process.exit(2);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --- a dist frissessege ---------------------------------------------------
const build = (dir) => {
  const file = join(dir, "dist", "build.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).source ?? null : null;
};
const fresh = { core: build(coreDir) === sourceHash(), element: build(elementDir) === sourceHash(elementDir) };

// --- sajat szerver ---------------------------------------------------------
const ROOTS = [
  ["/bench/", join(docsDir, "bench")],
  ["/core/", join(coreDir, "dist")],
  ["/element/", join(elementDir, "dist")],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json" };
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", BASE);
  for (const [prefix, root] of ROOTS) {
    if (pathname.startsWith(prefix)) {
      const file = resolve(join(root, pathname.slice(prefix.length)));
      if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
        response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        createReadStream(file).pipe(response);
        return;
      }
    }
  }
  response.writeHead(404).end();
});
await new Promise((done, fail) => {
  server.once("error", (error) => fail(error.code === "EADDRINUSE" ? new Error(`a ${String(PORT)} port foglalt — idegen lapot nem merunk`) : error));
  server.listen(PORT, "127.0.0.1", done);
});
const marker = await (await fetch(`${BASE}/bench/temporeum.html`)).text();
if (!marker.includes('data-bench-compare="temporeum"')) {
  server.close();
  throw new Error("a porton nem a vis-osszevetes lapja valaszol");
}

// --- eszkozok ------------------------------------------------------------
function frameStats(deltas) {
  let lost = 0;
  for (const d of deltas) if (d > 1.5 * VSYNC) lost += Math.round(d / VSYNC) - 1;
  return {
    missedShare: deltas.length === 0 ? 1 : lost / (lost + deltas.length),
    longestFrameMs: deltas.length === 0 ? Infinity : Math.max(...deltas),
    intervals: deltas.length,
  };
}

async function openPage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await page.goto(`${BASE}/bench/temporeum.html?n=${String(N)}`);
  await page.waitForFunction(() => window.benchCompare !== undefined, undefined, { timeout: 60_000 });
  if ((await page.evaluate(() => window.benchCompare.marker)) !== "temporeum-bench-compare") throw new Error("nem a meres lapja");
  await page.evaluate(() => window.benchCompare.ready);
  if (errors.length > 0) throw new Error(`lap-hiba: ${errors.join("; ")}`);
  return { context, page, cdp };
}

async function heap(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const get = (name) => metrics.find((entry) => entry.name === name)?.value ?? null;
  return { heapBytes: get("JSHeapUsedSize"), nodes: get("Nodes") };
}

/** A lathato elemek, es kozuluk hanynak latszik a cimkeje — a bongeszo szerint. */
function labelCoverage(page) {
  return page.evaluate(() => {
    const frame = document.querySelector("#frame");
    const box = frame.getBoundingClientRect();
    const inside = (r) => r.width > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
    const visible = new Set();
    for (const node of frame.querySelectorAll("rect.tl-item")) {
      if (inside(node.getBoundingClientRect())) visible.add(node.getAttribute("data-tl-id"));
    }
    const labelled = new Set();
    for (const node of frame.querySelectorAll(".tl-label")) {
      const id = node.getAttribute("data-tl-label");
      if (id !== null && visible.has(id) && inside(node.getBoundingClientRect())) labelled.add(id);
    }
    return { visibleItems: visible.size, labelledItems: labelled.size, itemNodes: frame.querySelectorAll("rect.tl-item").length };
  });
}

async function drag(page, x0, y, dx) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const began = performance.now();
  for (;;) {
    const u = Math.min((performance.now() - began) / PAN.durationMs, 1);
    await page.mouse.move(x0 + dx * u, y);
    if (u >= 1) break;
    await sleep(PAN.moveEveryMs);
  }
  await page.mouse.up();
}

const range = (page) => page.evaluate(() => window.benchCompare.getRange());

/** A cimke-lefedettseg, ha ket, 300 ms-onkent vett olvasat egyezik (legfeljebb 8 s). */
async function settledCoverage(page) {
  let last = await labelCoverage(page);
  for (let index = 0; index < 26; index += 1) {
    await sleep(300);
    const next = await labelCoverage(page);
    if (next.visibleItems === last.visibleItems && next.labelledItems === last.labelledItems) return next;
    last = next;
  }
  return { ...last, unsettled: true };
}

async function panPage(browser) {
  const { context, page, cdp } = await openPage(browser);
  try {
    const loaded = await heap(cdp);
    const coverage = await labelCoverage(page);
    const y = await page.evaluate(() => window.benchCompare.axisY());
    const r0 = await range(page);
    const msPerPx = (r0.end - r0.start) / VIEWPORT.width;
    await page.evaluate(() => window.benchCompare.frames.start());
    let mid = null;
    for (let index = 0; index < PAN.drags; index += 1) {
      const forward = index < PAN.forward;
      await drag(page, forward ? PAN.startX : PAN.startX - PAN.distancePx, y, forward ? -PAN.distancePx : PAN.distancePx);
      await sleep(PAN.gapMs);
      if (index === PAN.forward - 1) mid = await range(page);
    }
    await sleep(200);
    const frames = frameStats(await page.evaluate(() => window.benchCompare.frames.stop()));
    const r1 = await range(page);
    const panned = await heap(cdp);
    const after = await labelCoverage(page);
    return {
      heapAfterLoad: loaded.heapBytes,
      heapAfterPan: panned.heapBytes,
      heapGrowth: panned.heapBytes - loaded.heapBytes,
      nodesAfterLoad: loaded.nodes,
      nodesAfterPan: panned.nodes,
      itemNodesAfterLoad: coverage.itemNodes,
      itemNodesAfterPan: after.itemNodes,
      atRest: { visibleItems: coverage.visibleItems, labelledItems: coverage.labelledItems },
      pan: { ...frames, midPx: (mid.start - r0.start) / msPerPx, endPx: (r1.start - r0.start) / msPerPx },
      edits: await page.evaluate(() => window.benchCompare.edits()),
    };
  } finally {
    await context.close();
  }
}

async function zoomPage(browser) {
  const { context, page } = await openPage(browser);
  try {
    const r0 = await range(page);
    const span0 = r0.end - r0.start;
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.keyboard.down("Control");
    await page.evaluate(() => window.benchCompare.frames.start());
    let peak = 1;
    const began = performance.now();
    for (let index = 0; index < 2 * ZOOM.notches; index += 1) {
      const wait = began + index * ZOOM.intervalMs - performance.now();
      if (wait > 0) await sleep(wait);
      await page.mouse.wheel(0, index < ZOOM.notches ? -ZOOM.deltaY : ZOOM.deltaY);
      if (index === ZOOM.notches - 1) {
        const r = await range(page);
        peak = span0 / (r.end - r.start);
      }
    }
    await sleep(ZOOM.tailMs);
    const frames = frameStats(await page.evaluate(() => window.benchCompare.frames.stop()));
    const r1 = await range(page);
    const finalFactor = span0 / (r1.end - r1.start);
    // A surusegi hatar: a felvetelen kivul, ugyanazon a lapon, valodi gorgovel.
    const before = await settledCoverage(page);
    const notches = Math.max(Math.ceil(Math.log(before.visibleItems / (0.85 * SHORTEN_DENSITY_LIMIT)) / Math.log(1.2)), 0);
    for (let index = 0; index < notches; index += 1) {
      await page.mouse.wheel(0, -ZOOM.deltaY);
      await sleep(ZOOM.intervalMs);
    }
    await sleep(ZOOM.tailMs);
    const atLimit = await settledCoverage(page);
    const r2 = await range(page);
    await page.keyboard.up("Control");
    return {
      ...frames,
      peakFactor: peak,
      finalFactor,
      dense: { visibleItems: before.visibleItems, labelledItems: before.labelledItems, unsettled: before.unsettled === true },
      atLimit: { notches, factor: span0 / (r2.end - r2.start), visibleItems: atLimit.visibleItems, labelledItems: atLimit.labelledItems, unsettled: atLimit.unsettled === true },
      edits: await page.evaluate(() => window.benchCompare.edits()),
    };
  } finally {
    await context.close();
  }
}

// --- meres -----------------------------------------------------------------
const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const report = { kind, browser: browser.version(), viewport: VIEWPORT, throttle: THROTTLE, items: N, repetitions: REPS, fresh, densityLimit: SHORTEN_DENSITY_LIMIT, pan: PAN, zoom: ZOOM, panRuns: [], zoomRuns: [] };
try {
  for (let rep = 0; rep < REPS; rep += 1) {
    const run = await panPage(browser);
    report.panRuns.push(run);
    console.log(
      `pasztazas #${String(rep + 1)}: lathato ${String(run.atRest.visibleItems)}, cimkes ${String(run.atRest.labelledItems)}` +
        ` | kihagyott ${(run.pan.missedShare * 100).toFixed(1)}% leghosszabb ${run.pan.longestFrameMs.toFixed(0)} ms` +
        ` | heap ${(run.heapAfterLoad / 1e6).toFixed(2)} -> ${(run.heapAfterPan / 1e6).toFixed(2)} MB (+${(run.heapGrowth / 1e6).toFixed(2)})` +
        ` | elem-csomopont ${String(run.itemNodesAfterLoad)} -> ${String(run.itemNodesAfterPan)}`,
    );
    if (kind === "labels") {
      const zoom = await zoomPage(browser);
      report.zoomRuns.push(zoom);
      console.log(
        `zoom #${String(rep + 1)}: csucs ${zoom.peakFactor.toFixed(2)}x vege ${zoom.finalFactor.toFixed(2)}x` +
          ` | kihagyott ${(zoom.missedShare * 100).toFixed(1)}% leghosszabb ${zoom.longestFrameMs.toFixed(0)} ms` +
          ` | a hataron (${zoom.atLimit.factor.toFixed(2)}x): lathato ${String(zoom.atLimit.visibleItems)}, cimkes ${String(zoom.atLimit.labelledItems)}`,
      );
    }
  }
} finally {
  await browser.close();
  server.close();
}

const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
report.commit = git.status === 0 ? git.stdout.trim() : null;
const out = join(docsDir, kind === "labels" ? ".bench-labels.json" : ".bench-pan-memory.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`riport: ${out}`);
