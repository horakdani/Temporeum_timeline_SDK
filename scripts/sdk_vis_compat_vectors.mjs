#!/usr/bin/env node
/* global Element, window */
/**
 * A vis-compat referenciaja (P28): maga a vis-timeline 8.5.6.
 *
 *   node scripts/sdk_vis_compat_vectors.mjs
 *     -> packages/core/test/vis-compat/vectors.json
 *
 * A vis-timeline repo v8.5.6-os cimkejenek dokumentacios peldait
 * (examples/timeline/**.html) Chromiumban, Europe/Budapest zonaban futtatja,
 * ahogy vannak, a csomag standalone UMD-jevel. Egy init-szkript a `vis`
 * globalis Timeline-osztalyat egy alosztalyra csereli, amely minden peldanyt
 * es minden setOptions-hivast feljegyez. A lap nyugalma utan peldanyonkent
 * rogziti:
 *
 *  - a NYERS bemenetet: az elemek a vis sajat nyers DataSetjebol
 *    (`itemsData.rawDS.get()`, a kesobbi add/update is benne van), a csoportok
 *    a DataView alatti DataSetbol (a `visible: false` csoportok is), a
 *    felhasznalo opcioi (a setOptions-hivasok egymasra fesulve); a Date, a
 *    moment, a DOM-elem es a fuggveny cimkezve;
 *  - amit a vis CSINALT veluk: elemenkent a tipus (az ItemSet.types
 *    osztalyai szerint), a kezdet es a veg (item.data, a vis sajat
 *    konverzioja utan), a csoport (item.parent.groupId; a hatter- es a
 *    csoport nelkuli sav null), es hogy kirajzolhato-e (van szuloje, es az
 *    lathato); a lathato csoportok sorrendje (itemSet.groupIds).
 *
 * Mellette egy SAJAT lap (edge cases) ugyanigy, ugyanazzal a vis-szel: ISO
 * alakok (kiterjesztett, alap, het, ev napja, eltolassal, tort masodperc,
 * 24:00), ASP.NET- es szamjegy-szoveg, RFC 2822, szabad szoveg, ora-
 * atallitas resben es ismetlodo oraban, moment es Date; tipusok, egymasba
 * agyazott es rejtett csoportok, hianyzo csoport, csoport nelkuli hatter.
 *
 * Elofeltetel: a vis a packages/docs/.bench-work-ben (a bench:compare
 * telepiti), a peldak a .bench-work/src/vis-timeline alatt (git sparse
 * clone, v8.5.6). Kulso CDN-szkriptek: a moment a helyi peldanyra iranyitva,
 * a tobbi (jQuery, React, Babel) halozatrol; ami nem tolt be, az a pelda
 * kimarad, es a fajl `skipped` listajaba kerul az okaval.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(repo, "packages", "docs", ".bench-work");
const visPackage = join(work, "node_modules", "vis-timeline");
const visRepo = join(work, "src", "vis-timeline");
const examples = join(visRepo, "examples", "timeline");
const out = join(repo, "packages", "core", "test", "vis-compat", "vectors.json");
const TIME_ZONE = "Europe/Budapest";
const MAX_ITEMS = 120;

for (const [path, hint] of [
  [join(visPackage, "standalone", "umd", "vis-timeline-graph2d.min.js"), "npm run bench:compare -w @temporeum/timeline-docs (telepiti)"],
  [examples, "git clone --depth 1 --branch v8.5.6 --filter=blob:none --sparse https://github.com/visjs/vis-timeline.git packages/docs/.bench-work/src/vis-timeline && git -C packages/docs/.bench-work/src/vis-timeline sparse-checkout set examples/timeline"],
]) {
  if (!existsSync(path)) {
    console.error(`hianyzik: ${path}\n  -> ${hint}`);
    process.exit(1);
  }
}
const visVersion = JSON.parse(readFileSync(join(visPackage, "package.json"), "utf8")).version;
const momentDir = join(work, "node_modules", "moment");

const EDGE = `<!doctype html><html><head><meta charset="utf-8"><title>edge cases</title>
<script src="../../../standalone/umd/vis-timeline-graph2d.min.js"></script></head>
<body><div id="a"></div><div id="b"></div><div id="c"></div><script>
var m = vis.moment;
var strings = ["2026-03-02", "2026-03-02T10:15", "2026-03-02T10:15:30", "2026-03-02 10:15:30", "2026-03-02T10:15:30Z",
  "2026-03-02T10:15:30+05:30", "2026-03-02T10:15:30-0800", "2026-03-02T10:15:30+02", "2026-03-02T10:15:30.1234", "2026-03-02T10:15:30,5",
  "20260302", "20260302T101530", "2026-W10-3", "2026-W10", "2026-061", "2026061", "2026-03", "2026", "2026-03-02T24:00",
  "/Date(1772446530000)/", "/Date(1772446530000-0700)/", "1772446530000", "Mon, 02 Mar 2026 10:15:30 +0100", "2 Mar 2026 10:15 GMT",
  "Tue, 03 Mar 2026 10:15:30 PST", "2026/03/02 10:15:30", "March 2, 2026 10:15", "2026-3-2", "Mon Mar 02 2026 10:15:30 GMT+0100",
  "2026-03-29T02:30", "2026-03-29T01:59:59", "2026-03-29T03:00", "2026-10-25T02:30", "2026-10-25T01:30", "2026-10-25T03:00",
  "1999-12-31T23:59:59.999", "+002026-03-02", "0099-01-01", "2026-02-29", "2026-13-01", "2026-03-02T25:00"];
var items = strings.map(function (s, i) { return { id: "s" + i, start: s, content: s }; });
items.push({ id: "date", start: new Date(2026, 2, 2, 10, 15), end: new Date(2026, 2, 4), content: "Date" });
items.push({ id: "num", start: 1772446530000, end: 1772532930000, content: "number" });
items.push({ id: "moment", start: m("2026-03-05T08:00:00"), end: m("2026-03-06T08:00:00"), content: "moment" });
items.push({ id: "zero-end", start: -1000, end: 0, content: "epoch end" });
items.push({ id: "box-end", type: "box", start: "2026-03-07", end: "2026-03-09", content: "box with end" });
items.push({ id: "point", type: "point", start: "2026-03-08T12:00", content: "point" });
items.push({ id: "bg", type: "background", start: "2026-03-01", end: "2026-03-03" });
items.push({ id: "html", start: "2026-03-10", content: "<b>bold</b> &amp; plain" });
new vis.Timeline(document.getElementById("a"), new vis.DataSet(items), { start: "2026-03-01", end: "2026-03-31" });

var groups = new vis.DataSet([
  { id: 3, content: "Three", order: 2 }, { id: 1, content: "One", order: 1, nestedGroups: [11, 12] }, { id: 11, content: "One.one", order: 2 },
  { id: 12, content: "One.two", order: 1, nestedGroups: [121] }, { id: 121, content: "deep", order: 0 }, { id: 2, content: "Two", order: 3, visible: false },
  { id: 4, content: "Four", nestedGroups: [41], visible: false }, { id: 41, content: "under hidden" }, { id: "x", content: "<i>Ex</i>", order: 0 }]);
var grouped = [
  { id: "g1", group: 1, start: "2026-03-02", end: "2026-03-05", content: "in One" }, { id: "g11", group: 11, start: "2026-03-03", content: "in One.one" },
  { id: "g121", group: 121, start: "2026-03-04", end: "2026-03-06", content: "deep" }, { id: "g2", group: 2, start: "2026-03-02", content: "in hidden Two" },
  { id: "g41", group: 41, start: "2026-03-02", content: "under hidden Four" }, { id: "g9", group: 9, start: "2026-03-02", content: "no such group" },
  { id: "gnone", start: "2026-03-02", content: "no group" }, { id: "gbg", type: "background", start: "2026-03-10", end: "2026-03-12" },
  { id: "gbg1", type: "background", group: 3, start: "2026-03-13", end: "2026-03-14" }, { id: "gx", group: "x", start: 1772446530000, type: "point", content: "x" },
  { id: 7, group: "3", start: "2026-03-20", end: "2026-03-21", content: "numeric id, string group" }];
new vis.Timeline(document.getElementById("b"), new vis.DataSet(grouped), groups, { groupOrder: "order" });
new vis.Timeline(document.getElementById("c"), [{ id: "t1", start: "2026-03-02" }, { id: "t2", start: "2026-03-02", end: "2026-03-04" }], { type: "point", groupOrder: function (a, b) { return b.id - a.id; } });
</script></body></html>`;

// --- szerver ------------------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const ROOTS = [
  ["/standalone/", join(visPackage, "standalone")],
  ["/peer/", join(visPackage, "peer")],
  ["/styles/", join(visPackage, "styles")],
  ["/dist/", join(visPackage, "dist")],
  ["/examples/", join(visRepo, "examples")],
];
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
  if (pathname === "/examples/timeline/edge/edgeCases.html") {
    response.writeHead(200, { "content-type": TYPES[".html"] }).end(EDGE);
    return;
  }
  for (const [prefix, root] of ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    const file = resolve(join(root, decodeURIComponent(pathname.slice(prefix.length))));
    if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
      return;
    }
  }
  response.writeHead(404).end();
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${String(server.address().port)}`;

// --- a lapra injektalt felvevo ----------------------------------------------------
const RECORDER = () => {
  const instances = [];
  const options = new WeakMap();
  const holder = {};
  let wrapped;
  Object.defineProperty(holder, "Timeline", {
    configurable: true,
    enumerable: true,
    get: () => wrapped,
    set(Real) {
      wrapped = class extends Real {
        constructor(...args) {
          super(...args);
          instances.push(this);
        }
        setOptions(next) {
          if (next && typeof next === "object") options.set(this, { ...(options.get(this) ?? {}), ...next });
          return super.setOptions(next);
        }
      };
    },
  });
  let visValue = holder;
  Object.defineProperty(window, "vis", {
    configurable: true,
    get: () => visValue,
    set(value) {
      visValue = value;
    },
  });

  const tag = (value, depth) => {
    if (value === undefined) return { $undefined: true };
    if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
    if (value instanceof Date) return { $date: value.getTime() };
    if (value && value._isAMomentObject) return { $moment: value.valueOf() };
    if (typeof value === "function") return { $function: String(value) };
    if (typeof Element !== "undefined" && value instanceof Element) return { $element: value.outerHTML, text: value.textContent };
    if (depth > 4) return { $deep: true };
    if (Array.isArray(value)) return value.map((each) => tag(each, depth + 1));
    if (typeof value === "object") {
      const outObject = {};
      for (const key of Object.keys(value)) outObject[key] = tag(value[key], depth + 1);
      return outObject;
    }
    return { $unknown: String(value) };
  };

  window.__visCompatSnapshot = (limit) =>
    instances.map((timeline) => {
      const itemSet = timeline.itemSet;
      const types = itemSet.constructor.types;
      const kindOf = (item) => Object.keys(types).find((key) => item instanceof types[key]) ?? null;
      const rawItems = timeline.itemsData.rawDS.get().slice(0, limit);
      const keep = new Set(rawItems.map((each) => String(each.id)));
      const groupSet = timeline.groupsData ? (typeof timeline.groupsData.getDataSet === "function" ? timeline.groupsData.getDataSet() : timeline.groupsData) : null;
      const placed = [];
      for (const id of Object.keys(itemSet.items)) {
        if (!keep.has(String(id))) continue;
        const item = itemSet.items[id];
        const parent = item.parent;
        const groupId = parent ? parent.groupId : undefined;
        const special = groupId === null || groupId === "__background__" || groupId === "__ungrouped__";
        placed.push({
          id: String(id),
          kind: kindOf(item),
          start: item.data.start == null ? null : item.data.start.valueOf(),
          end: item.data.end == null ? null : item.data.end.valueOf(),
          group: parent === undefined ? null : special ? null : String(groupId),
          drawn: parent !== undefined && (special || itemSet.groupIds.map(String).includes(String(groupId))),
        });
      }
      return {
        items: tag(rawItems, 0),
        itemsTruncated: timeline.itemsData.rawDS.get().length > limit,
        groups: groupSet ? tag(groupSet.get(), 0) : null,
        options: tag(options.get(timeline) ?? {}, 0),
        vis: { items: placed, groupOrder: timeline.groupsData ? itemSet.groupIds.map(String) : null },
      };
    });
};

// --- futas ---------------------------------------------------------------------------
const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".html")) pages.push(relative(examples, path));
  }
};
walk(examples);
pages.push("edge/edgeCases.html");

const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const vectors = [];
const skipped = [];
try {
  for (const page of pages) {
    const context = await browser.newContext({ timezoneId: TIME_ZONE, locale: "en-US", viewport: { width: 1200, height: 800 } });
    await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/moment\.js\/[^/]+\/(moment(?:-with-locales)?)(?:\.min)?\.js|unpkg\.com\/moment@latest/, (route, request) => {
      const name = /moment-with-locales/.test(request.url()) ? "moment-with-locales.min.js" : "moment.min.js";
      route.fulfill({ status: 200, contentType: TYPES[".js"], body: readFileSync(join(momentDir, "min", name)) });
    });
    await context.addInitScript(RECORDER);
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(String(error.message).split("\n")[0]));
    try {
      await tab.goto(`${base}/examples/timeline/${page.split(sep).join("/")}`, { waitUntil: "load", timeout: 30_000 });
      await tab.waitForTimeout(1500);
      const snapshot = await tab.evaluate((limit) => (window.__visCompatSnapshot ? window.__visCompatSnapshot(limit) : null), MAX_ITEMS);
      if (snapshot === null || snapshot.length === 0) skipped.push({ page, reason: errors[0] ?? "no Timeline was created" });
      else {
        for (const [index, instance] of snapshot.entries()) {
          if (instance.vis.items.length === 0) skipped.push({ page: `${page}#${String(index)}`, reason: "no items" });
          else vectors.push({ page: snapshot.length > 1 ? `${page}#${String(index)}` : page, ...instance, pageErrors: errors });
        }
      }
    } catch (error) {
      skipped.push({ page, reason: String(error.message).split("\n")[0] });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

writeFileSync(
  out,
  `${JSON.stringify({ $comment: "scripts/sdk_vis_compat_vectors.mjs — do not edit by hand", visTimeline: visVersion, source: "github.com/visjs/vis-timeline v8.5.6 examples/timeline", timeZone: TIME_ZONE, maxItems: MAX_ITEMS, vectors, skipped }, null, 1)}\n`,
);
const items = vectors.reduce((sum, vector) => sum + vector.vis.items.length, 0);
console.log(`${String(vectors.length)} timeline, ${String(items)} elem, ${String(skipped.length)} kihagyva -> ${relative(repo, out)}`);
for (const each of skipped) console.log(`  kihagyva: ${each.page} — ${each.reason}`);
