#!/usr/bin/env node
/**
 * A szerveroldali proba: a LEFORDITOTT csomag fut-e DOM nelkul.
 *
 * Kulon processzben indul, mert a lenyeg a kiindulo allapot: itt nincs DOM,
 * es a DOM-szeru globalok NEM egyszeruen hianyoznak, hanem dobnak. Igy ha a
 * csomag barhol hozzaernek — betoltesnel vagy egy teljes tengely-szamitas
 * kozben —, az nem csendes undefined, hanem bukas.
 *
 * Hasznalat: node scripts/sdk_nodom_probe.mjs <packages/core utvonal>
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");
const esmBundle = join(packageDir, "dist", "index.mjs");
const cjsBundle = join(packageDir, "dist", "index.cjs");
// A P4 bongeszo-kotese. Kulon belepesi pont, es pont azert kell itt is
// megprobalni: egy SSR-bundler behuzhatja (egy komponens importalja), es ha
// az IMPORT barmit a DOM-tol kerdez, a szerver hibaval valaszol a kezdolapra.
const domEsmBundle = join(packageDir, "dist", "dom.mjs");
const domCjsBundle = join(packageDir, "dist", "dom.cjs");

for (const bundle of [esmBundle, cjsBundle, domEsmBundle, domCjsBundle]) {
  if (!existsSync(bundle)) {
    console.error(`  HIBA nincs lefordított csomag: ${bundle}`);
    console.error("\nG-NODOM BUKOTT: a szerveroldali próba NEM futott le.");
    process.exit(1);
  }
}

// --- A globalok elaknasitasa ------------------------------------------------

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
        throw new Error(`a mag hozzáért a(z) \`${name}\` globálhoz`);
      },
    });
    armed.push(name);
  } catch {
    // Egy-egy globált az engine nem engedi felülírni; ezt kiírjuk, nem
    // elhallgatjuk.
  }
}

for (const name of REQUIRED_POISON) {
  if (!armed.includes(name)) {
    console.error(`  HIBA a(z) \`${name}\` globált nem sikerült elaknásítani — a próba értéktelen`);
    process.exit(1);
  }
}

// --- A proba ----------------------------------------------------------------

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function exercise(api, label) {
  const domain = [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1)];
  const scale = api.createTimeScale(domain, 1200);
  const ticks = api.generateTicks(domain, 1200, { timeZone: "Europe/Budapest" });
  assert(ticks.length > 3, `${label}: a tengely üres`);
  assert(
    ticks.every((tick) => tick.time >= domain[0] && tick.time <= domain[1]),
    `${label}: tick a domainen kívül`,
  );

  const projector = api.createProjector("vertical");
  const box = projector.projectRect({
    main: scale.toMain(ticks[0].time),
    mainSize: 2,
    cross: 0,
    crossSize: 24,
  });
  assert(box.height === 2 && box.width === 24, `${label}: a függőleges projekció elcsúszott`);

  const zoomed = api.zoomDomainAt(domain, 1200, 600, 4);
  assert(
    Math.abs(api.createTimeScale(zoomed, 1200).toTime(600) - scale.toTime(600)) < 1,
    `${label}: a zoom nem a fókuszhoz horgonyzott`,
  );
  assert(api.startOf(domain[0], "year", "UTC") === domain[0], `${label}: startOf hibás`);
  assert(typeof api.VERSION === "string", `${label}: nincs VERSION`);

  // A RENDERELES is itt fut le, nem csak a geometria. A P3 allitasa az, hogy a
  // szerveroldali renderelés ugyanaz a kodut, mint a bongeszoben — ez az
  // allitas addig csak erv, amig egy elaknasitott DOM-u folyamatban le nem fut
  // egy teljes frame.
  const frame = api.renderTimeline({
    items: [
      { id: "a", start: domain[0], end: domain[0] + 86_400_000 * 40, label: "Szakasz" },
      { id: "b", start: domain[0] + 86_400_000 * 100, open: true, label: "Nyitott" },
    ],
    domain,
    width: 1200,
    height: 300,
    orientation: "vertical",
    theme: "dark",
    timeZone: "Europe/Budapest",
    decorations: [
      { kind: "banding" },
      { kind: "now", time: domain[0] + 86_400_000 * 50, label: "most" },
    ],
  });
  const svg = api.renderToSvgString(frame.scene);
  assert(svg.startsWith("<svg"), `${label}: a renderelés nem SVG-t adott`);
  assert(svg.includes("tl-item"), `${label}: a frame-ben nincs elem`);
  assert(svg.includes("tl-now"), `${label}: a frame-ben nincs dekoráció`);
  assert(svg.includes("--tl-surface:"), `${label}: a frame-ben nincs téma`);
  assert(frame.visibleCount === 2, `${label}: a culling elvitte a látható elemeket`);
  assert(api.countSceneNodes(frame.scene) > 10, `${label}: üres jelenet`);
  return ticks.length;
}

try {
  const esm = await import(pathToFileURL(esmBundle).href);
  const esmTicks = exercise(esm, "ESM");
  console.log(`  ok   dist/index.mjs: betöltve és lefutott DOM nélkül (${esmTicks} tick)`);

  const require = createRequire(pathToFileURL(join(packageDir, "package.json")).href);
  const cjs = require(cjsBundle);
  const cjsTicks = exercise(cjs, "CJS");
  console.log(`  ok   dist/index.cjs: betöltve és lefutott DOM nélkül (${cjsTicks} tick)`);

  const domEsm = await import(pathToFileURL(domEsmBundle).href);
  assert(
    typeof domEsm.attachInput === "function",
    "dist/dom.mjs: az attachInput nem jött ki a csomagból",
  );
  const domCjs = require(domCjsBundle);
  assert(
    typeof domCjs.attachInput === "function",
    "dist/dom.cjs: az attachInput nem jött ki a csomagból",
  );
  console.log("  ok   dist/dom.mjs és dist/dom.cjs: betöltve DOM nélkül, importkor semmi nem dob");

  console.log(`  ok   elaknásított globálok: ${armed.join(", ")}`);
} catch (error) {
  console.error(`  HIBA ${error instanceof Error ? error.message : String(error)}`);
  console.error("\nG-NODOM BUKOTT: a lefordított csomag nem fut DOM nélkül.");
  process.exit(1);
}
