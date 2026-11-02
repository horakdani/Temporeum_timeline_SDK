#!/usr/bin/env node
/**
 * G-PERF and G-MEMORY: the measurement. In real Chromium, on the docs
 * package's bench.html page, along the page's OWN path (attachInput -> machine
 * -> frame loop -> element space -> patcher). The script does not judge: it
 * writes the raw measurement to a report, and sdk_check_perf.mjs /
 * sdk_check_memory.mjs say whether it passed. That way the thresholds live in
 * one place, and the report can be reviewed independently of them.
 *
 *   node scripts/sdk_bench.mjs perf     -> packages/core/.bench-perf.json
 *   node scripts/sdk_bench.mjs memory   -> packages/core/.bench-memory.json
 *   node scripts/sdk_bench.mjs public   -> packages/docs/.bench-public.json
 *   node scripts/sdk_bench.mjs deep     -> packages/docs/.bench-deep.json
 *   node scripts/sdk_bench.mjs wheel    -> packages/docs/.bench-wheel.json
 *
 * `wheel` (G-PERF-WHEEL) measures the vis comparison's zoom on BOTH paths,
 * the same way: a FRESH, quiet page (on the public path still untouched, no
 * extras), Control held down, a real `page.mouse.wheel` in the middle of the
 * view, 8 notches in and 8 out, every 50 ms, 1.2x per notch (deltaY 45.6:
 * exp(45.6 * 0.004)), and recording continues for 300 ms after the last
 * notch so the settling frames are included. Every variant runs on WHEEL_REPS
 * (3) fresh pages, and the check judges the median (the vis comparison also
 * reports the median). Negative controls: without element space on both
 * paths, and on the core page without a wheel run (?run=0: the host settles
 * after every notch).
 *
 * `deep` (G-PERF-DEEP) measures the 4x pinch (zoom-deep) on BOTH paths: on
 * the core page (bench.html) with the recommended path, without stepped
 * re-anchoring (?levels=0) and without element space — the two negative
 * controls —, and on the public page (bench-public.html) with createTimeline
 * and without element space.
 *
 * `public` (G-PERF-PUBLIC) runs the same measurement on the bench-public.html
 * page: there `createTimeline` draws from the shipped element bundle, so the
 * page walks the user's path instead of hand-wiring the core. The freshness
 * check there covers both the core AND the element source.
 *
 * Three things without which the measurement could lie:
 *
 *  1. OUR OWN server, on our own port (41738, TL_BENCH_PORT), and we check
 *     the page's marker: we never measure someone else's page (a lesson
 *     learned the hard way).
 *  2. A FRESH dist: the page reads the source fingerprint from
 *     dist/build.json, and the script recomputes it from the source. If they
 *     differ, the report is "stale" — and the check fails. A silently failed
 *     build would measure old code as green.
 *  3. The throttling IS APPLIED: CDP Emulation.setCPUThrottlingRate runs
 *     separately on every measured page, and the FAILURE of the negative
 *     control (without element space) proves that the measurement makes a
 *     difference — if the throttling had no effect, the control would pass
 *     too, and the check treats that as a failure.
 */

// `window` appears only in page.evaluate callbacks: those run in the
// BROWSER, not here. `fetch` and `setTimeout` are Node globals.
/* global fetch, performance, setTimeout, window */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { sourceHash } from "../packages/core/scripts/fingerprint.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(repoRoot, "packages", "core");
const elementDir = join(repoRoot, "packages", "web-component");
const docsDir = join(repoRoot, "packages", "docs");
const PORT = Number(process.env.TL_BENCH_PORT ?? 41738);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VIEWPORT = { width: 1440, height: 900 };
/** An approximation of a mid-range Android device: Lighthouse's mobile convention. Recorded in the state file. */
const THROTTLE = 4;
/**
 * The check's three scenarios, plus two informational ones. The check does
 * not judge those (they are not among its pre-agreed scenarios), it only
 * prints them: the 2x zoom fits within the space's allowed stretch, the
 * 960 px drag within the overscan. The 4x pinch shows what re-anchoring
 * during a gesture costs, and the long pan (4 x 1200 px) what entering
 * tiles cost.
 */
const SCENARIOS = ["pan", "zoom", "pan-labelled", "zoom-deep", "pan-long"];
/** The long pan: 24 drags x 240 px = 5760 px, about 4 view widths of the data. */
const SWIPES = 24;

/** The vis comparison's zoom (sdk_bench_compare.mjs ZOOM), with our deltaY. */
const WHEEL = { notches: 8, intervalMs: 50, deltaY: 45.6, tailMs: 300 };
const WHEEL_REPS = Number(process.env.TL_WHEEL_REPS ?? 3);

const kind = process.argv[2];
if (kind !== "perf" && kind !== "memory" && kind !== "public" && kind !== "deep" && kind !== "wheel") {
  console.error("usage: node scripts/sdk_bench.mjs perf|memory|public|deep|wheel");
  process.exit(2);
}
const PAGE = kind === "public" ? "bench-public.html" : "bench.html";
const MARKER = kind === "public" ? "temporeum-timeline-bench-public" : "temporeum-timeline-bench";

async function startServer() {
  const child = spawn(process.execPath, [join(docsDir, "e2e", "serve.mjs")], {
    env: { ...process.env, TL_E2E_PORT: String(PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited) {
      throw new Error(`the server did not start on port ${String(PORT)} (in use?)`);
    }
    try {
      const response = await fetch(`${BASE}/bench.html`);
      const text = await response.text();
      if (response.ok && text.includes('data-bench="temporeum-timeline"')) {
        return child;
      }
      throw new Error("something other than our page answers on the port");
    } catch (error) {
      if (String(error).includes("other than our page")) {
        child.kill();
        throw error;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  child.kill();
  throw new Error("the server did not answer within 10 s");
}

async function openBench(browser, query, target = { page: PAGE, marker: MARKER }) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/${target.page}?${query}`);
  await page.waitForFunction(() => window.tlBench !== undefined, undefined, { timeout: 20_000 });
  const identity = await page.evaluate(() => ({
    marker: window.tlBench.marker,
    build: window.tlBench.build,
    mode: window.tlBench.mode,
    poolLimit: window.tlBench.poolLimit,
    totalItems: window.tlBench.totalItems,
    levels: window.tlBench.levels,
    wheelRun: window.tlBench.wheelRun,
  }));
  if (identity.marker !== target.marker) {
    throw new Error("the page is not the benchmark page");
  }
  return { page, identity };
}

const expectedSource = kind === "public" ? `${sourceHash()}|${sourceHash(elementDir)}` : sourceHash();
const server = await startServer();
const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const report = {
  kind,
  browser: browser.version(),
  viewport: VIEWPORT,
  expectedSource,
  builds: [],
  runs: [],
};

/** A wheel run from Node, with real input; the page provides the recording. */
async function wheelZoom(page) {
  const before = await page.evaluate(() => window.tlBench.startWheel());
  const [start0, end0] = await page.evaluate(() => window.tlBench.domain());
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.keyboard.down("Control");
  let peak = 1;
  const began = performance.now();
  for (let index = 0; index < 2 * WHEEL.notches; index += 1) {
    const wait = began + index * WHEEL.intervalMs - performance.now();
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    await page.mouse.wheel(0, index < WHEEL.notches ? -WHEEL.deltaY : WHEEL.deltaY);
    if (index === WHEEL.notches - 1) {
      const [start, end] = await page.evaluate(() => window.tlBench.domain());
      peak = (end0 - start0) / (end - start);
    }
  }
  await new Promise((done) => setTimeout(done, WHEEL.tailMs));
  await page.keyboard.up("Control");
  const result = await page.evaluate(() => window.tlBench.stopWheel());
  const [start1, end1] = await page.evaluate(() => window.tlBench.domain());
  return { ...result, before, peakFactor: peak, finalFactor: (end0 - start0) / (end1 - start1) };
}

try {
  if (kind === "wheel") {
    report.throttle = THROTTLE;
    report.wheel = WHEEL;
    report.repetitions = WHEEL_REPS;
    const coreSource = sourceHash();
    const targets = [
      {
        path: "core",
        page: "bench.html",
        marker: "temporeum-timeline-bench",
        source: coreSource,
        modes: [
          ["space", "mode=space"],
          ["norun", "mode=space&run=0"],
          ["exact", "mode=exact"],
        ],
      },
      {
        path: "public",
        page: "bench-public.html",
        marker: "temporeum-timeline-bench-public",
        source: `${coreSource}|${sourceHash(elementDir)}`,
        // The vis comparison page's settings: editing on, density at its
        // default. The published number is produced on that page.
        modes: [
          ["space", "mode=space&editing=1&density=auto"],
          ["exact", "mode=exact&editing=1&density=auto"],
        ],
      },
    ];
    report.expectedSource = targets.map((target) => target.source).join("+");
    // For diagnostics: TL_WHEEL_MODES="space:mode=space&trace=1" runs only this.
    const only = process.env.TL_WHEEL_MODES?.split(",").map((entry) => entry.split(":"));
    for (const target of targets) {
      for (const [mode, query] of only ?? target.modes) {
        for (let rep = 0; rep < WHEEL_REPS; rep += 1) {
          const { page, identity } = await openBench(browser, query, target);
          report.builds.push({ path: target.path, expected: target.source, actual: identity.build?.source ?? null });
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
          const result = await wheelZoom(page);
          report.runs.push({
            ...result,
            path: target.path,
            mode,
            rep,
            levels: identity.levels ?? null,
            wheelRun: identity.wheelRun ?? null,
            totalItems: identity.totalItems,
            throttle: THROTTLE,
          });
          console.log(
            `${target.path.padEnd(7)} ${mode.padEnd(6)} #${String(rep + 1)} zoom-wheel visible ${String(result.before.visibleItems).padStart(4)}` +
              ` peak ${result.peakFactor.toFixed(2)}x end ${result.finalFactor.toFixed(2)}x anchors ${String(result.reanchors ?? "-")}` +
              `  missed vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
              `  longest ${result.longestFrameMs.toFixed(0)} ms  settle ${result.settleMs.toFixed(0)} ms` +
              `  wheel/draw ${String(result.inputEvents)}/${String(result.draws)}`,
          );
          await page.close();
        }
      }
    }
  } else if (kind === "deep") {
    report.throttle = THROTTLE;
    const coreSource = sourceHash();
    const targets = [
      {
        path: "core",
        page: "bench.html",
        marker: "temporeum-timeline-bench",
        source: coreSource,
        modes: [
          ["space", "mode=space"],
          ["flat", "mode=space&levels=0"],
          ["exact", "mode=exact"],
        ],
      },
      {
        path: "public",
        page: "bench-public.html",
        marker: "temporeum-timeline-bench-public",
        source: `${coreSource}|${sourceHash(elementDir)}`,
        modes: [
          ["space", "mode=space"],
          ["exact", "mode=exact"],
        ],
      },
    ];
    report.expectedSource = targets.map((target) => target.source).join("+");
    for (const target of targets) {
      for (const [mode, query] of target.modes) {
        const { page, identity } = await openBench(browser, query, target);
        report.builds.push({ path: target.path, expected: target.source, actual: identity.build?.source ?? null });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
        const result = await page.evaluate(() => window.tlBench.scenario("zoom-deep"));
        report.runs.push({ ...result, path: target.path, mode, levels: identity.levels ?? null, totalItems: identity.totalItems, throttle: THROTTLE });
        console.log(
          `${target.path.padEnd(7)} ${mode.padEnd(6)} zoom-deep visible ${String(result.before.visibleItems).padStart(4)}` +
            ` anchors ${String(result.reanchors ?? "-")}` +
            `  missed vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
            `  longest ${result.longestFrameMs.toFixed(0)} ms  settle ${result.settleMs.toFixed(0)} ms` +
            `  events/draws ${String(result.inputEvents)}/${String(result.draws)}`,
        );
        await page.close();
      }
    }
  } else if (kind === "perf" || kind === "public") {
    report.throttle = THROTTLE;
    for (const mode of ["space", "exact"]) {
      const { page, identity } = await openBench(browser, `mode=${mode}`);
      report.builds.push(identity.build?.source ?? null);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      for (const name of SCENARIOS) {
        const result = await page.evaluate((scenario) => window.tlBench.scenario(scenario), name);
        report.runs.push({ ...result, totalItems: identity.totalItems, throttle: THROTTLE });
        console.log(
          `${mode.padEnd(6)} ${name.padEnd(13)} visible ${String(result.before.visibleItems).padStart(4)}` +
            ` labels ${String(result.before.visibleLabels).padStart(4)}` +
            ` anchors ${String(result.reanchors ?? "-")}` +
            `  missed vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
            `  ${result.effectiveFps.toFixed(1)} fps  longest ${result.longestFrameMs.toFixed(0)} ms` +
            `  settle ${result.settleMs.toFixed(0)} ms  events/draws ${String(result.inputEvents)}/${String(result.draws)}`,
        );
      }
      await page.close();
    }
  } else {
    for (const pool of [null, 0]) {
      const { page, identity } = await openBench(browser, pool === null ? "" : `pool=${String(pool)}`);
      report.builds.push(identity.build?.source ?? null);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("HeapProfiler.enable");
      const samples = [];
      const first = await page.evaluate(() => window.tlBench.prepareLongPan());
      for (let index = 0; index < SWIPES; index += 1) {
        const sample = await page.evaluate(() => window.tlBench.swipe());
        await cdp.send("HeapProfiler.collectGarbage");
        const { metrics } = await cdp.send("Performance.getMetrics");
        const metric = (name) => metrics.find((entry) => entry.name === name)?.value ?? null;
        samples.push({ ...sample, cdpNodes: metric("Nodes"), jsHeapUsed: metric("JSHeapUsedSize") });
      }
      report.runs.push({ poolLimit: identity.poolLimit, totalItems: identity.totalItems, first, samples });
      const last = samples[samples.length - 1];
      console.log(
        `pool ${pool === null ? "default" : String(pool)}: created ${String(first.created)} -> ${String(last.created)},` +
          ` reused ${String(last.reused)}, live DOM ${String(last.domNodes)}, CDP Nodes ${String(last.cdpNodes)}`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

const out =
  kind === "public"
    ? join(docsDir, ".bench-public.json")
    : kind === "deep" || kind === "wheel"
      ? join(docsDir, `.bench-${kind}.json`)
      : join(coreDir, kind === "perf" ? ".bench-perf.json" : ".bench-memory.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${out}`);
