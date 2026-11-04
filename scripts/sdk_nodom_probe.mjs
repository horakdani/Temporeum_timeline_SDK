#!/usr/bin/env node
/**
 * The server-side probe: does the BUILT package run without a DOM.
 *
 * It starts in a separate process, because the starting state is the point:
 * here there is no DOM, and the DOM-like globals do NOT simply go missing,
 * they throw. So if the package touches them anywhere — while loading or in
 * the middle of a full axis computation —, the result is not a silent
 * undefined but a failure.
 *
 * Usage: node scripts/sdk_nodom_probe.mjs <packages/core path>
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");
const esmBundle = join(packageDir, "dist", "index.mjs");
const cjsBundle = join(packageDir, "dist", "index.cjs");
// The browser binding. It is a separate entry point, and that is exactly why
// it must be tried here too: an SSR bundler may pull it in (a component
// imports it), and if the IMPORT asks the DOM for anything, the server
// answers the home page with an error.
const domEsmBundle = join(packageDir, "dist", "dom.mjs");
const domCjsBundle = join(packageDir, "dist", "dom.cjs");

for (const bundle of [esmBundle, cjsBundle, domEsmBundle, domCjsBundle]) {
  if (!existsSync(bundle)) {
    console.error(`  ERROR no built package: ${bundle}`);
    console.error("\nnodom FAILED: the server-side probe did NOT run.");
    process.exit(1);
  }
}

// --- Booby-trapping the globals ---------------------------------------------

const POISONED = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "fetch",
  "XMLHttpRequest",
];
const REQUIRED_POISON = ["window", "document", "localStorage"];

const armed = [];
for (const name of POISONED) {
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`the core touched the \`${name}\` global`);
      },
    });
    armed.push(name);
  } catch {
    // The engine does not allow overriding some globals; we report that, we
    // do not hide it.
  }
}

for (const name of REQUIRED_POISON) {
  if (!armed.includes(name)) {
    console.error(`  ERROR could not booby-trap the \`${name}\` global — the probe is worthless`);
    process.exit(1);
  }
}

// --- The probe --------------------------------------------------------------

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function exercise(api, label) {
  const domain = [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1)];
  const scale = api.createTimeScale(domain, 1200);
  const ticks = api.generateTicks(domain, 1200, { timeZone: "Europe/Budapest" });
  assert(ticks.length > 3, `${label}: the axis is empty`);
  assert(
    ticks.every((tick) => tick.time >= domain[0] && tick.time <= domain[1]),
    `${label}: a tick outside the domain`,
  );

  const projector = api.createProjector("vertical");
  const box = projector.projectRect({
    main: scale.toMain(ticks[0].time),
    mainSize: 2,
    cross: 0,
    crossSize: 24,
  });
  assert(box.height === 2 && box.width === 24, `${label}: the vertical projection is off`);

  const zoomed = api.zoomDomainAt(domain, 1200, 600, 4);
  assert(
    Math.abs(api.createTimeScale(zoomed, 1200).toTime(600) - scale.toTime(600)) < 1,
    `${label}: the zoom is not anchored to the focus`,
  );
  assert(api.startOf(domain[0], "year", "UTC") === domain[0], `${label}: startOf is wrong`);
  assert(typeof api.VERSION === "string", `${label}: no VERSION`);

  // RENDERING runs here too, not just the geometry. The claim is that
  // server-side rendering takes the same code path as in the browser — and
  // that claim is only an argument until a full frame has run in a process
  // with a booby-trapped DOM.
  const frame = api.renderTimeline({
    items: [
      { id: "a", start: domain[0], end: domain[0] + 86_400_000 * 40, label: "Stage" },
      { id: "b", start: domain[0] + 86_400_000 * 100, open: true, label: "Open" },
    ],
    domain,
    width: 1200,
    height: 300,
    orientation: "vertical",
    theme: "dark",
    timeZone: "Europe/Budapest",
    decorations: [
      { kind: "banding" },
      { kind: "now", time: domain[0] + 86_400_000 * 50, label: "now" },
    ],
  });
  const svg = api.renderToSvgString(frame.scene);
  assert(svg.startsWith("<svg"), `${label}: rendering did not produce SVG`);
  assert(svg.includes("tl-item"), `${label}: the frame has no item`);
  assert(svg.includes("tl-now"), `${label}: the frame has no decoration`);
  assert(svg.includes("--tl-surface:"), `${label}: the frame has no theme`);
  assert(frame.visibleCount === 2, `${label}: culling removed the visible items`);
  assert(api.countSceneNodes(frame.scene) > 10, `${label}: empty scene`);
  return ticks.length;
}

try {
  const esm = await import(pathToFileURL(esmBundle).href);
  const esmTicks = exercise(esm, "ESM");
  console.log(`  ok   dist/index.mjs: loaded and ran without a DOM (${esmTicks} ticks)`);

  const require = createRequire(pathToFileURL(join(packageDir, "package.json")).href);
  const cjs = require(cjsBundle);
  const cjsTicks = exercise(cjs, "CJS");
  console.log(`  ok   dist/index.cjs: loaded and ran without a DOM (${cjsTicks} ticks)`);

  const domEsm = await import(pathToFileURL(domEsmBundle).href);
  assert(
    typeof domEsm.attachInput === "function",
    "dist/dom.mjs: attachInput is not exported from the package",
  );
  const domCjs = require(domCjsBundle);
  assert(
    typeof domCjs.attachInput === "function",
    "dist/dom.cjs: attachInput is not exported from the package",
  );
  console.log("  ok   dist/dom.mjs and dist/dom.cjs: loaded without a DOM, nothing throws on import");

  console.log(`  ok   booby-trapped globals: ${armed.join(", ")}`);
} catch (error) {
  console.error(`  ERROR ${error instanceof Error ? error.message : String(error)}`);
  console.error("\nnodom FAILED: the built package does not run without a DOM.");
  process.exit(1);
}
