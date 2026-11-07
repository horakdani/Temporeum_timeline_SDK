#!/usr/bin/env node
/**
 * The bench-labels check and the pan-memory check: the measurement on the throttled benchmark's
 * OWN page (packages/docs/bench/temporeum.html), with 10 000 items and the
 * same input as sdk_bench_compare.mjs: 1440 x 900, DPR 1, 4x CPU throttling
 * before navigation, a fresh browser context for every page.
 *
 *   node scripts/sdk_bench_field.mjs labels      -> packages/docs/.bench-labels.json
 *   node scripts/sdk_bench_field.mjs pan-memory  -> packages/docs/.bench-pan-memory.json
 *
 * The script does not judge: it writes the raw measurement, and
 * sdk_check_bench_labels.mjs and sdk_check_pan_memory.mjs decide. Two kinds
 * of page, each on FIELD_REPS (3) fresh pages:
 *
 *  - PAN page (in both modes): after `ready`, GC and heap; the visible items
 *    and the labels of the visible items (at rest); then 24 real mouse drags
 *    of 240 px on the axis band (12 forward, 12 back), each 400 ms with a
 *    move every ~16 ms, 100 ms apart — frames recorded with rAF over the
 *    whole sequence; at the end GC, heap, nodes.
 *  - ZOOM page (only `labels`): a fresh page, Control + a real wheel at the
 *    centre of the view, 8 notches in and 8 out every 50 ms, 1.2x per notch
 *    (deltaY 45.6), and recording continues for 300 ms after the last notch.
 *    Then, outside the recording, the DENSITY LIMIT: as many 1.2x wheel
 *    notches in as it takes for one view width to hold at most 85% of the
 *    core's SHORTEN_DENSITY_LIMIT (1000); it waits until things settle and
 *    counts the visible items and their labels (by design: the label claim
 *    holds up to the limit, the 10 000-item view is about performance).
 *
 * A missed frame is counted the same way as in the comparison: V = 1000/60
 * ms, an rAF interval d > 1.5 V means round(d / V) - 1 lost frames; share =
 * lost / (lost + recorded intervals).
 *
 * Validity (it goes into the report, and the check fails on it): our own
 * server, our own port (31766, TL_BENCH_FIELD_PORT), the page's marker; a
 * FRESH dist (the core's and the element's build.json source fingerprint
 * matches the source); the drag really moved the view (+2880 px +-25% after
 * 12 drags, back to within one drag after 24); the zoom went above 4x and
 * came back; no drag or wheel edited an item.
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
// The limit is the renderer's own, not on the public entry: read from its source.
const SHORTEN_DENSITY_LIMIT = Number(/export const SHORTEN_DENSITY_LIMIT = ([\d_]+);/.exec(readFileSync(new URL("../packages/core/src/render.ts", import.meta.url), "utf8"))?.[1]?.replaceAll("_", "") ?? NaN);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "packages", "docs");
const coreDir = join(repoRoot, "packages", "core");
const elementDir = join(repoRoot, "packages", "web-component");
const PORT = Number(process.env.TL_BENCH_FIELD_PORT ?? 31766);
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
  console.error("usage: node scripts/sdk_bench_field.mjs labels|pan-memory");
  process.exit(2);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --- dist freshness -------------------------------------------------------
const build = (dir) => {
  const file = join(dir, "dist", "build.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).source ?? null : null;
};
const fresh = { core: build(coreDir) === sourceHash(), element: build(elementDir) === sourceHash(elementDir) };

// --- own server ------------------------------------------------------------
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
  server.once("error", (error) => fail(error.code === "EADDRINUSE" ? new Error(`port ${String(PORT)} is taken — we do not measure someone else's page`) : error));
  server.listen(PORT, "127.0.0.1", done);
});
const marker = await (await fetch(`${BASE}/bench/temporeum.html`)).text();
if (!marker.includes('data-bench-compare="temporeum"')) {
  server.close();
  throw new Error("something other than the throttled benchmark's page answers on the port");
}

// --- helpers -------------------------------------------------------------
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
  if ((await page.evaluate(() => window.benchCompare.marker)) !== "temporeum-bench-compare") throw new Error("not the benchmark page");
  await page.evaluate(() => window.benchCompare.ready);
  if (errors.length > 0) throw new Error(`page error: ${errors.join("; ")}`);
  return { context, page, cdp };
}

async function heap(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const get = (name) => metrics.find((entry) => entry.name === name)?.value ?? null;
  return { heapBytes: get("JSHeapUsedSize"), nodes: get("Nodes") };
}

/** The visible items, and how many of them show their label — according to the browser. */
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

/** The label coverage, once two readings taken 300 ms apart agree (at most 8 s). */
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
    // The density limit: outside the recording, on the same page, with a real wheel.
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

// --- measurement -----------------------------------------------------------
const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const report = { kind, browser: browser.version(), viewport: VIEWPORT, throttle: THROTTLE, items: N, repetitions: REPS, fresh, densityLimit: SHORTEN_DENSITY_LIMIT, pan: PAN, zoom: ZOOM, panRuns: [], zoomRuns: [] };
try {
  for (let rep = 0; rep < REPS; rep += 1) {
    const run = await panPage(browser);
    report.panRuns.push(run);
    console.log(
      `pan #${String(rep + 1)}: visible ${String(run.atRest.visibleItems)}, labelled ${String(run.atRest.labelledItems)}` +
        ` | missed ${(run.pan.missedShare * 100).toFixed(1)}% longest ${run.pan.longestFrameMs.toFixed(0)} ms` +
        ` | heap ${(run.heapAfterLoad / 1e6).toFixed(2)} -> ${(run.heapAfterPan / 1e6).toFixed(2)} MB (+${(run.heapGrowth / 1e6).toFixed(2)})` +
        ` | item nodes ${String(run.itemNodesAfterLoad)} -> ${String(run.itemNodesAfterPan)}`,
    );
    if (kind === "labels") {
      const zoom = await zoomPage(browser);
      report.zoomRuns.push(zoom);
      console.log(
        `zoom #${String(rep + 1)}: peak ${zoom.peakFactor.toFixed(2)}x end ${zoom.finalFactor.toFixed(2)}x` +
          ` | missed ${(zoom.missedShare * 100).toFixed(1)}% longest ${zoom.longestFrameMs.toFixed(0)} ms` +
          ` | at the limit (${zoom.atLimit.factor.toFixed(2)}x): visible ${String(zoom.atLimit.visibleItems)}, labelled ${String(zoom.atLimit.labelledItems)}`,
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
console.log(`report: ${out}`);
