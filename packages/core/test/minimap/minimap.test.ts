/**
 * G-MINIMAP: dragging the overview strip's window gives the view the
 * corresponding pan gives — and so do its keys. Generated views and drags,
 * with and without hidden dates, in both orientations.
 */

import { describe, expect, it } from "vitest";

import { layoutItems } from "../../src/layout.js";
import { createTimeScale, panDomainBy } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import { createHiddenDates } from "../../src/tools/hidden.js";
import {
  DEFAULT_MINIMAP_SIZE,
  MIN_WINDOW_SIZE,
  MINIMAP_STEP,
  minimapCss,
  minimapDragDomain,
  minimapExtent,
  minimapGeometry,
  minimapJumpDomain,
  minimapKeyDomain,
  minimapNodes,
} from "../../src/tools/minimap.js";
import type { Domain, Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 5);

function items(random: () => number, count: number): Item[] {
  return Array.from({ length: count }, (_, index) => {
    const start = T0 + Math.floor(random() * 120) * DAY + Math.floor(random() * 24) * HOUR;
    return { id: `i${String(index)}`, start, end: start + (1 + Math.floor(random() * 60)) * HOUR, laneId: `l${String(index % 4)}` };
  });
}

const near = (a: Domain, b: Domain): void => {
  expect(a[0]).toBeCloseTo(b[0], -1);
  expect(a[1]).toBeCloseTo(b[1], -1);
};

describeBothOrientations("the overview strip", (orientation) => {
  it("[claim:drag-is-pan] moves the view by what a drag of its window stands for — the pan of the same distance in the view", () => {
    const random = makeRandom(0x3a9);
    let compared = 0;
    for (const hiddenDates of [undefined, createHiddenDates([{ start: T0 + 18 * HOUR, end: T0 + DAY + 8 * HOUR, repeat: "daily" }])]) {
      for (let index = 0; index < 40; index += 1) {
        const layout = layoutItems(items(random, 5 + Math.floor(random() * 40)));
        const from = T0 + Math.floor(random() * 100) * DAY;
        const domain: Domain = [from, from + (1 + Math.floor(random() * 20)) * DAY];
        const mainSize = 500 + Math.floor(random() * 900);
        const geometry = minimapGeometry(minimapExtent(layout, domain), domain, mainSize, hiddenDates);
        const delta = (random() - 0.5) * 200;
        const grab = geometry.window.main + geometry.window.mainSize / 2;
        const dragged = minimapDragDomain(domain, grab, grab + delta, geometry);
        // The same distance, in the view's own pixels.
        const view = createTimeScale(domain, mainSize, hiddenDates);
        const pixels = (delta * geometry.scale.msPerPx) / view.msPerPx;
        near(dragged, panDomainBy(domain, mainSize, pixels, hiddenDates));
        // And the window moved by the drag, on the strip.
        const after = minimapGeometry(geometry.extent, dragged, mainSize, hiddenDates);
        if (geometry.window.mainSize > MIN_WINDOW_SIZE && after.window.main > 0 && after.window.main + after.window.mainSize < mainSize) {
          expect(after.window.main - geometry.window.main).toBeCloseTo(delta, 0);
        }
        compared += 1;
      }
    }
    expect(compared).toBe(80);
  });

  it("[claim:keyboard] pans a tenth of the view with an arrow, a whole one with a page, and goes to the extent's ends", () => {
    const layout = layoutItems(items(makeRandom(9), 20));
    const domain: Domain = [T0 + 20 * DAY, T0 + 30 * DAY];
    const geometry = minimapGeometry(minimapExtent(layout, domain), domain, 1000);
    near(minimapKeyDomain(domain, "later", geometry), panDomainBy(domain, 1000, 1000 * MINIMAP_STEP));
    near(minimapKeyDomain(domain, "earlier", geometry), panDomainBy(domain, 1000, -1000 * MINIMAP_STEP));
    near(minimapKeyDomain(domain, "pageLater", geometry), panDomainBy(domain, 1000, 1000 * MINIMAP_STEP * 10));
    near(minimapKeyDomain(domain, "pageEarlier", geometry), panDomainBy(domain, 1000, -1000 * MINIMAP_STEP * 10));
    const first = minimapKeyDomain(domain, "first", geometry);
    expect(first[0]).toBeCloseTo(geometry.extent[0], -2);
    const last = minimapKeyDomain(domain, "last", geometry);
    expect(last[1]).toBeCloseTo(geometry.extent[1], -2);
    // The span is the view's: the keys pan, they do not zoom.
    expect(first[1] - first[0]).toBeCloseTo(domain[1] - domain[0], -1);
  });

  it("centres the view on a press beside the window, by the same pan", () => {
    const layout = layoutItems(items(makeRandom(11), 20));
    const domain: Domain = [T0 + 20 * DAY, T0 + 30 * DAY];
    const geometry = minimapGeometry(minimapExtent(layout, domain), domain, 1000);
    const jumped = minimapJumpDomain(domain, 50, geometry);
    expect((jumped[0] + jumped[1]) / 2).toBeCloseTo(geometry.scale.toTime(50), -2);
  });

  it("draws a background, the items and the window across the far edge, hidden from assistive technology's reading", () => {
    const layout = layoutItems(items(makeRandom(13), 12));
    const domain: Domain = [T0 + 20 * DAY, T0 + 30 * DAY];
    const geometry = minimapGeometry(minimapExtent(layout, domain), domain, 900);
    const nodes = minimapNodes(layout, geometry, { orientation, cross: 300, size: DEFAULT_MINIMAP_SIZE });
    expect(nodes.map((node) => node.attrs?.class)).toEqual(["tl-minimap", "tl-minimap-items", "tl-minimap-window"]);
    const window = nodes[2] as SceneElement;
    const along = Number(orientation === "horizontal" ? window.attrs?.x : window.attrs?.y);
    const across = Number(orientation === "horizontal" ? window.attrs?.y : window.attrs?.x);
    expect(along).toBeCloseTo(geometry.window.main, 6);
    expect(across).toBe(301);
    expect(minimapCss(".tl")).toContain(".tl .tl-minimap-window");
    // A view outside every item still has its window on the strip.
    const empty = minimapNodes(layoutItems([]), minimapGeometry(domain, domain, 900), { orientation, cross: 0, size: 20 });
    expect(empty.map((node) => node.attrs?.class)).toEqual(["tl-minimap", "tl-minimap-window"]);
  });

  it("spans every item and the view, an open item from its start; and keeps a deep zoom's window grabbable", () => {
    const layout = layoutItems([{ id: "open", start: T0 + 50 * DAY }, { id: "a", start: T0, end: T0 + DAY }]);
    const extent = minimapExtent(layout, [T0 + 10 * DAY, T0 + 11 * DAY]);
    expect(extent[0]).toBeLessThan(T0);
    expect(extent[1]).toBeGreaterThan(T0 + 50 * DAY);
    const geometry = minimapGeometry(extent, [T0 + 10 * DAY, T0 + 10 * DAY + 1000], 800);
    expect(geometry.window.mainSize).toBe(MIN_WINDOW_SIZE);
  });
});

describe("the overview strip — numbers", () => {
  it("has the defaults the element documents", () => {
    expect(DEFAULT_MINIMAP_SIZE).toBe(36);
    expect(MINIMAP_STEP).toBe(0.1);
  });
});
