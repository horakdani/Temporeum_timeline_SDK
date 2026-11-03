/**
 * The cut between pages, and the stylesheet the PDF is coloured from.
 *
 * The cut's promise is a property of the layout alone: no break goes
 * through an item unless the item is taller than a page, the bands cover
 * the layout without a gap or an overlap, and each item starts in exactly
 * one band.
 */

import { describe, expect, it } from "vitest";

import { bandLayout, contentRange, onBand, paginate } from "../../src/export/paginate.js";
import { printPages, resolvePaper } from "../../src/export/pages.js";
import { computeStyle, parseStyleSheet, sheetOf } from "../../src/export/style.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { DARK_THEME, LIGHT_THEME } from "../../src/theme.js";
import type { Item, Lane } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

describe("paginate", () => {
  it("[claim:no-item-lost] never breaks through an item that fits a page where a break could spare it, and covers the layout once", () => {
    const random = makeRandom(0x5eed);
    for (let index = 0; index < 60; index += 1) {
      const lanes: Lane[] = Array.from({ length: 1 + Math.floor(random() * 10) }, (_, at) => ({ id: `l${String(at)}` }));
      const items: Item[] = Array.from({ length: 1 + Math.floor(random() * 120) }, (_, at) => {
        const start = T0 + Math.floor(random() * 40) * DAY;
        return {
          id: `i${String(at)}`,
          start,
          end: start + (1 + Math.floor(random() * 6)) * DAY,
          laneId: lanes[Math.floor(random() * lanes.length)]?.id ?? "l0",
          ...(random() < 0.1 ? { sublaneSpan: 1 + Math.floor(random() * 4) } : {}),
        };
      });
      const layout = layoutItems(items, { lanes });
      const capacity = 30 + Math.floor(random() * 300);
      const bands = paginate(layout, capacity);
      expect(bands[0]?.from).toBe(0);
      expect(bands[bands.length - 1]?.to).toBe(layout.crossSize);
      bands.forEach((band, at) => {
        if (at > 0) expect(band.from).toBe(bands[at - 1]?.to);
        expect(band.to - band.from).toBeLessThanOrEqual(capacity);
        expect(band.to).toBeGreaterThan(band.from);
      });
      for (const placed of layout.items) {
        expect(bands.filter((band) => onBand(placed, band))).toHaveLength(1);
      }
      // A break goes through an item that fits a page only where no place on
      // that page spares every such item: rows of items that overlap, each
      // shorter than a page, can together be taller than one. Searched by
      // hand over every edge in the layout, not taken from the cut's own list.
      const fits = layout.items.filter((placed) => placed.crossSize <= capacity);
      const spares = (at: number): boolean => !fits.some((placed) => placed.cross < at && placed.cross + placed.crossSize > at);
      const edges = [layout.crossSize, ...layout.lanes.map((lane) => lane.cross), ...layout.items.flatMap((placed) => [placed.cross, placed.cross + placed.crossSize])];
      for (const band of bands) {
        if (spares(band.to)) continue;
        expect(edges.filter((at) => at > band.from && at <= Math.min(band.from + capacity, layout.crossSize) && spares(at)), `case ${String(index)}, page ${String(band.from)}`).toEqual([]);
      }
      const total = bands.reduce((sum, band) => sum + bandLayout(layout, band).items.length, 0);
      expect(total).toBe(layout.items.length);
    }
  });

  it("cuts an item taller than a page at the page's edge, on the page it starts on", () => {
    const layout = layoutItems([{ id: "tall", start: T0, end: T0 + DAY, sublaneSpan: 10 }]);
    const bands = paginate(layout, 50);
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0]).toEqual({ from: 0, to: 50 });
    expect(bands.filter((band) => bandLayout(layout, band).items.length > 0)).toHaveLength(1);
  });

  it("gives an empty layout one empty page, and refuses a page with no room", () => {
    const empty = layoutItems([]);
    expect(paginate(empty, 100)).toEqual([{ from: 0, to: empty.crossSize }]);
    expect(() => paginate(layoutItems([]), 0)).toThrow(RangeError);
    expect(() => paginate(layoutItems([]), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("prints the items' whole range, an open item to its start, an instant with an hour either side", () => {
    const layout = layoutItems([
      { id: "a", start: T0, end: T0 + 10 * DAY },
      { id: "b", start: T0 + 20 * DAY },
    ]);
    const range = contentRange(layout, 0);
    expect(range).toEqual([T0, T0 + 20 * DAY]);
    expect(contentRange(layoutItems([{ id: "x", start: T0 }]), 0.02)).toEqual([T0 - 3_600_000, T0 + 3_600_000]);
    expect(contentRange(layoutItems([]))).toBeUndefined();
  });
});

describe("paper", () => {
  it("resolves sheets to points and their printable box to CSS pixels", () => {
    expect(resolvePaper()).toEqual({ width: 842, height: 595, margin: 36, contentWidth: 1026, contentHeight: 697 });
    expect(resolvePaper({ size: "letter", orientation: "portrait", margin: 0 })).toEqual({ width: 612, height: 792, margin: 0, contentWidth: 816, contentHeight: 1056 });
    expect(resolvePaper({ size: [300, 200] }).width).toBe(300);
    expect(() => resolvePaper({ size: "a5", margin: 300 })).toThrow(RangeError);
  });

  it("prints the domain when no item gives a range, a given range when asked, and its own layout when one is passed", () => {
    const domain = [T0, T0 + DAY] as const;
    const empty = printPages({ items: [], domain, width: 100, height: 100 });
    expect(empty).toHaveLength(1);
    expect(empty[0]?.frame.viewport.domain).toEqual(domain);
    const items: Item[] = [{ id: "a", start: T0, end: T0 + DAY }];
    const asked = printPages({ items, domain, width: 100, height: 100, theme: "dark" }, { range: [T0 - DAY, T0 + 2 * DAY] });
    expect(asked[0]?.frame.viewport.domain).toEqual([T0 - DAY, T0 + 2 * DAY]);
    expect(asked[0]?.frame.scene.attrs?.["data-tl-theme"]).toBe("dark");
    const layout = layoutItems(items);
    expect(printPages({ items, domain, width: 100, height: 100, layout })[0]?.frame.layout.items[0]?.item).toBe(items[0]);
    // Light on paper, and an image: no focus stop.
    const plain = printPages({ items, domain, width: 100, height: 100 })[0]?.frame.scene.attrs;
    expect(plain?.["data-tl-theme"]).toBe("light");
    expect(plain?.tabindex).toBeUndefined();
  });
});

describe("the stylesheet the PDF reads", () => {
  it("applies rules by class and tag, tokens through var(), the cascade's order, and SVG inheritance", () => {
    const sheet = parseStyleSheet(
      [
        ".tl{--tl-x:#111;font-size:12px}",
        "@media (prefers-color-scheme:dark){.tl{--tl-x:#eee}}",
        "@keyframes spin{to{opacity:0}}",
        ".tl .a{fill:var(--tl-x);stroke:var(--tl-missing, #222)}",
        ".tl .a.b{fill:#333}",
        ".tl .a:focus{fill:#f00}",
        ".tl .z[data-x]{fill:#f00}",
        ".tl .c>div{padding:0 0 0 7px}",
        ".tl rect{stroke-width:3}",
        ".tl .dangling{fill:#444",
      ].join(""),
    );
    expect(sheet.vars.get("--tl-x")).toBe("#111");
    const root = computeStyle({ tag: "svg", attrs: { class: "tl" } }, {}, sheet);
    expect(root["font-size"]).toBe("12px");
    const a = computeStyle({ tag: "rect", attrs: { class: "a", fill: "#999", opacity: 0.5 } }, root, sheet);
    expect(a.fill).toBe("#111");
    expect(a.stroke).toBe("#222");
    expect(a["stroke-width"]).toBe("3");
    expect(a["font-size"]).toBe("12px");
    expect(a.opacity).toBe("0.5");
    expect(computeStyle({ tag: "rect", attrs: { class: "a b" } }, root, sheet).fill).toBe("#333");
    expect(computeStyle({ tag: "rect", attrs: { class: "a", style: "fill:#555" } }, root, sheet).fill).toBe("#555");
    expect(computeStyle({ tag: "div", attrs: {} }, root, sheet).padding).toBe("0 0 0 7px");
    // Opacity is not inherited; fill is.
    const child = computeStyle({ tag: "g" }, a, sheet);
    expect(child.opacity).toBeUndefined();
    expect(child.fill).toBe("#111");
    expect(parseStyleSheet("").rules).toEqual([]);
    expect(parseStyleSheet("@media print{.a{fill:red}").rules).toEqual([]);
  });

  it("takes the tokens of a root rule with an attribute only where the scene's root has it (M7)", () => {
    const frame = (theme: "auto" | "light" | "dark", instanceId?: string) =>
      renderTimeline({ items: [{ id: "a", start: T0, end: T0 + DAY }], domain: [T0, T0 + 3 * DAY], width: 400, height: 120, theme, ...(instanceId === undefined ? {} : { instanceId }) }).scene;
    for (const scope of [undefined, "one"]) {
      // auto: the light tokens, then the dark ones only under a media query or a dark root.
      expect(sheetOf(frame("auto", scope)).vars.get("--tl-surface"), String(scope)).toBe(LIGHT_THEME.tokens.surface);
      expect(sheetOf(frame("light", scope)).vars.get("--tl-surface")).toBe(LIGHT_THEME.tokens.surface);
      expect(sheetOf(frame("dark", scope)).vars.get("--tl-surface")).toBe(DARK_THEME.tokens.surface);
    }
    // An auto frame pinned dark the way the exporters pin it: its root says dark.
    const pinned = frame("auto");
    const dark = { ...pinned, attrs: { ...pinned.attrs, "data-tl-theme": "dark" } };
    expect(sheetOf(dark).vars.get("--tl-surface")).toBe(DARK_THEME.tokens.surface);
    // A rule with an attribute matches the node that has it.
    const sheet = parseStyleSheet('.tl{fill:#111}.tl[data-k="v"]{fill:#222}.tl[data-on]{stroke:#333}');
    expect(computeStyle({ tag: "svg", attrs: { class: "tl" } }, {}, sheet)).toEqual({ fill: "#111" });
    expect(computeStyle({ tag: "svg", attrs: { class: "tl", "data-k": "v", "data-on": "" } }, {}, sheet)).toEqual({ fill: "#222", stroke: "#333" });
    expect(computeStyle({ tag: "svg", attrs: { class: "tl", "data-k": "w" } }, {}, sheet)).toEqual({ fill: "#111" });
  });

  it("collects every <style> in a scene", () => {
    const sheet = sheetOf({ tag: "svg", children: [{ tag: "style", text: ".tl{--a:1}" }, { tag: "g", children: [{ tag: "style", text: ".tl{--b:2}" }, { tag: "style" }] }] });
    expect([...sheet.vars.keys()]).toEqual(["--a", "--b"]);
  });
});
