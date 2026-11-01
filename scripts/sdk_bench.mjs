#!/usr/bin/env node
/**
 * G-PERF es G-MEMORY: a meres. Igazi Chromiumban, a docs csomag bench.html
 * lapjan, a lap SAJAT utjan (attachInput -> gep -> kepkocka-hurok -> elemter
 * -> foltozo). A szkript nem itel: kiirja a nyers merest egy riportba, es a
 * sdk_check_perf.mjs / sdk_check_memory.mjs mondja meg, atment-e. Igy a
 * kuszobok egy helyen vannak, es a riport a kuszoboktol fuggetlenul
 * visszanezheto.
 *
 *   node scripts/sdk_bench.mjs perf     -> packages/core/.bench-perf.json
 *   node scripts/sdk_bench.mjs memory   -> packages/core/.bench-memory.json
 *   node scripts/sdk_bench.mjs public   -> packages/docs/.bench-public.json
 *   node scripts/sdk_bench.mjs deep     -> packages/docs/.bench-deep.json
 *   node scripts/sdk_bench.mjs wheel    -> packages/docs/.bench-wheel.json
 *
 * A `wheel` (P15, G-PERF-WHEEL) a vis-osszevetes zoomjat meri MINDKET uton,
 * ugyanugy: FRISS, csendes lap (a publikus uton meg erintetlen, raadas
 * nelkul), Control lenyomva, valodi `page.mouse.wheel` a nezet kozepen, 8
 * lepes be es 8 ki, 50 ms-onkent, lepesenkent 1,2x (deltaY 45,6:
 * exp(45,6 * 0,004)), es a felvetel az utolso lepes utan meg 300 ms-ig tart,
 * hogy a nyugalmi kepkockak is benne legyenek. Minden valtozat WHEEL_REPS (3)
 * friss lapon fut, a check a mediant iteli meg (a vis-osszevetes is mediant
 * kozol). Negativ kontroll: elemter nelkul mindket uton, es a mag lapjan
 * gorgo-sorozat nelkul (?run=0: a hoszt minden lepes utan nyugalomba all).
 *
 * A `deep` (P14, G-PERF-DEEP) a 4x-es csipest (zoom-deep) meri MINDKET uton:
 * a mag lapjan (bench.html) az ajanlott uttal, a lepcsos ujrahorgonyzas
 * nelkul (?levels=0) es elemter nelkul — a ket negativ kontroll —, a publikus
 * lapon (bench-public.html) a createTimeline-nal es elemter nelkul.
 *
 * A `public` (P13, G-PERF-PUBLIC) ugyanezt a merest a bench-public.html
 * lapon futtatja: ott a `createTimeline` a shippelt element-bundle-bol rajzol,
 * a lap a mag kezi huzalozasa helyett a felhasznalo utjat jarja. A friss-
 * seg-ellenorzes ott a core ES az element forrasara is kiterjed.
 *
 * Harom dolog, ami nelkul a meres hazudhatna:
 *
 *  1. SAJAT szerver, sajat porton (41738, TL_BENCH_PORT), es a lap jelolojet
 *     ellenorizzuk: idegen lapot nem merunk (ez a P6 elotti tanulsag).
 *  2. FRISS dist: a lap kiolvassa a dist/build.json forras-lenyomatat, a
 *     szkript ujraszamolja a forrasbol. Ha elter, a riport "stale" — es a
 *     check bukik. Egy nemán elbukott build regi kodot merne zolden.
 *  3. A lassitas ALKALMAZVA van: a CDP Emulation.setCPUThrottlingRate minden
 *     merő lapra kulon fut, es a negativ kontroll (elemter nelkul) BUKASA
 *     bizonyitja, hogy a meres kulonbseget tesz — ha a lassitas nem hatna,
 *     a kontroll is atmenne, es a check ezt bukasnak veszi.
 */

// A `window` kizarolag a page.evaluate visszahivasaiban szerepel: azok a
// BONGESZOBEN futnak, nem itt. A `fetch` es a `setTimeout` Node-globalok.
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
/** A kozep-Android kozelitese: a Lighthouse mobil-konvencioja. Rogzitve a state.json-ban. */
const THROTTLE = 4;
/**
 * A kapu harom forgatokonyve, es ket tajekoztato. Azokat a check nem iteli
 * meg (a kapu elore rogzitett forgatokonyvei kozott nincsenek ott), csak
 * kiirja: a 2x-es zoom belefer a ter megengedett nyujtasaba, a 960 px-es
 * huzas a rahagyasba. A 4x-es csipesz megmutatja, mennyibe kerul a gesztus
 * alatti ujrahorgonyzas, a hosszu pasztazas (4 x 1200 px), mennyibe a
 * belepo csempek.
 */
const SCENARIOS = ["pan", "zoom", "pan-labelled", "zoom-deep", "pan-long"];
/** A hosszu pasztazas: 24 huzas x 240 px = 5760 px, az adat ~4 nezetnyi szelessege. */
const SWIPES = 24;

/** A vis-osszevetes zoomja (sdk_bench_compare.mjs ZOOM), a mi deltaY-unkkal. */
const WHEEL = { notches: 8, intervalMs: 50, deltaY: 45.6, tailMs: 300 };
const WHEEL_REPS = Number(process.env.TL_WHEEL_REPS ?? 3);

const kind = process.argv[2];
if (kind !== "perf" && kind !== "memory" && kind !== "public" && kind !== "deep" && kind !== "wheel") {
  console.error("hasznalat: node scripts/sdk_bench.mjs perf|memory|public|deep|wheel");
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
      throw new Error(`a szerver nem indult el a ${String(PORT)} porton (foglalt?)`);
    }
    try {
      const response = await fetch(`${BASE}/bench.html`);
      const text = await response.text();
      if (response.ok && text.includes('data-bench="temporeum-timeline"')) {
        return child;
      }
      throw new Error("a porton nem a mi lapunk valaszol");
    } catch (error) {
      if (String(error).includes("nem a mi lapunk")) {
        child.kill();
        throw error;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  child.kill();
  throw new Error("a szerver 10 s alatt sem valaszolt");
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
    throw new Error("a lap nem a meres lapja");
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

/** Egy gorgo-sorozat a Node-bol, valodi bemenettel; a lap a felvetelt adja. */
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
        // A vis-osszevetes lapjanak beallitasa: szerkesztes be, a surusseg
        // alaperteke. A kozolt szam azon a lapon szuletik.
        modes: [
          ["space", "mode=space&editing=1&density=auto"],
          ["exact", "mode=exact&editing=1&density=auto"],
        ],
      },
    ];
    report.expectedSource = targets.map((target) => target.source).join("+");
    // Diagnosztikahoz: TL_WHEEL_MODES="space:mode=space&trace=1" csak ezt futtatja.
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
            `${target.path.padEnd(7)} ${mode.padEnd(6)} #${String(rep + 1)} zoom-wheel lathato ${String(result.before.visibleItems).padStart(4)}` +
              ` csucs ${result.peakFactor.toFixed(2)}x vege ${result.finalFactor.toFixed(2)}x horgony ${String(result.reanchors ?? "-")}` +
              `  kihagyott vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
              `  leghosszabb ${result.longestFrameMs.toFixed(0)} ms  nyugvo ${result.settleMs.toFixed(0)} ms` +
              `  gorgo/rajz ${String(result.inputEvents)}/${String(result.draws)}`,
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
          `${target.path.padEnd(7)} ${mode.padEnd(6)} zoom-deep lathato ${String(result.before.visibleItems).padStart(4)}` +
            ` horgony ${String(result.reanchors ?? "-")}` +
            `  kihagyott vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
            `  leghosszabb ${result.longestFrameMs.toFixed(0)} ms  nyugvo ${result.settleMs.toFixed(0)} ms` +
            `  esemeny/rajz ${String(result.inputEvents)}/${String(result.draws)}`,
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
          `${mode.padEnd(6)} ${name.padEnd(13)} lathato ${String(result.before.visibleItems).padStart(4)}` +
            ` cimke ${String(result.before.visibleLabels).padStart(4)}` +
            ` horgony ${String(result.reanchors ?? "-")}` +
            `  kihagyott vsync ${(result.missedVsyncShare * 100).toFixed(1).padStart(5)}%` +
            `  ${result.effectiveFps.toFixed(1)} fps  leghosszabb ${result.longestFrameMs.toFixed(0)} ms` +
            `  nyugvo ${result.settleMs.toFixed(0)} ms  esemeny/rajz ${String(result.inputEvents)}/${String(result.draws)}`,
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
        `pool ${pool === null ? "alap" : String(pool)}: letrehozva ${String(first.created)} -> ${String(last.created)},` +
          ` ujrahasznositva ${String(last.reused)}, el DOM ${String(last.domNodes)}, CDP Nodes ${String(last.cdpNodes)}`,
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
console.log(`riport: ${out}`);
