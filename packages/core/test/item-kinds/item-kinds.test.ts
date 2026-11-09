/**
 * The item-kinds check: box, point and background items, in both orientations.
 *
 * A box and a point are drawn — the shape and a line to the axis — are hit
 * by the hit tester like any item, and are options with an accessible name.
 * A background is drawn behind every item, in the background layer: it is
 * not an option, no pointer hits it, and it never covers an item.
 */

import { expect, it } from "vitest";

import { createHitTester } from "../../src/editing.js";
import { densityMetrics } from "../../src/density.js";
import { itemKindHooks, onRemoveHandle, removeHandleBox, splitBackgrounds, withoutId } from "../../src/items/index.js";
import { itemRect } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import { renderToSvgString } from "../../src/scene.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item, Orientation } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const DOMAIN = [ORIGIN, ORIGIN + 30 * DAY] as const;

const ITEMS: Item[] = [
  { id: "bar", start: ORIGIN + 2 * DAY, end: ORIGIN + 6 * DAY, label: "A range" },
  { id: "box", kind: "box", start: ORIGIN + 10 * DAY, label: "A box" },
  { id: "dot", kind: "point", start: ORIGIN + 15 * DAY, label: "A point" },
  { id: "back", kind: "background", start: ORIGIN + 1 * DAY, end: ORIGIN + 20 * DAY, label: "Sprint 1" },
];

function find(node: SceneElement, test: (node: SceneElement) => boolean): SceneElement | undefined {
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function layerOf(scene: SceneElement, name: string): SceneElement {
  const layer = find(scene, (node) => node.attrs?.["data-tl-layer"] === name || node.attrs?.class === `tl-layer tl-layer--${name}`);
  if (layer === undefined) throw new Error(`no ${name} layer`);
  return layer;
}

function frame(orientation: Orientation) {
  const split = splitBackgrounds(ITEMS);
  const width = 900;
  const height = 400;
  const result = renderTimeline({
    items: split.items,
    domain: DOMAIN,
    width,
    height,
    orientation,
    decorations: split.backgrounds,
    hooks: itemKindHooks(),
  });
  const metrics = densityMetrics(result.viewport.density, orientation);
  const tester = createHitTester({
    layout: result.layout,
    scale: createTimeScale(result.viewport.domain, result.viewport.mainSize),
    crossInset: metrics.axisSize,
    minItemMainSize: metrics.minItemMainSize,
    density: result.viewport.density,
  });
  return { result, split, tester, metrics };
}

describeBothOrientations("item kinds", (orientation) => {
  it("[claim:drawn] a box and a point are drawn with their shape and a line to the axis", () => {
    const { result } = frame(orientation);
    for (const [id, shape] of [["box", "rect"], ["dot", "circle"]] as const) {
      const node = find(result.scene, (each) => each.attrs?.["data-tl-id"] === id && each.tag === "g");
      expect(node, id).toBeDefined();
      expect(String(node?.attrs?.class)).toContain(`tl-item--${id === "box" ? "box" : "point"}`);
      expect(node?.children?.some((child) => child.tag === "line" && child.attrs?.class === "tl-item-line")).toBe(true);
      expect(node?.children?.some((child) => child.tag === shape)).toBe(true);
    }
    const svg = renderToSvgString(result.scene);
    expect(svg).toContain("tl-item-dot");
    expect(svg).toContain("tl-background");
  });

  it("draws the line to the axis as a guide a pointer goes through: it crosses the lanes above, and the hit test does not count it", () => {
    const { result } = frame(orientation);
    for (const id of ["box", "dot"]) {
      const node = find(result.scene, (each) => each.attrs?.["data-tl-id"] === id && each.tag === "g");
      const line = node?.children?.find((child) => child.attrs?.class === "tl-item-line");
      expect(line?.attrs?.["pointer-events"], id).toBe("none");
    }
  });

  it("[claim:named] every kind but the background is an option with an accessible name", () => {
    const { result } = frame(orientation);
    for (const id of ["bar", "box", "dot"]) {
      const node = find(result.scene, (each) => each.attrs?.["data-tl-id"] === id && each.attrs.role === "option");
      expect(node, id).toBeDefined();
      expect(String(node?.attrs?.["aria-label"])).toMatch(/^A (range|box|point)/);
      expect(find(node as SceneElement, (each) => each.tag === "title")).toBeDefined();
    }
    expect(find(result.scene, (each) => each.attrs?.["data-tl-id"] === "back")).toBeUndefined();
    expect(find(result.scene, (each) => each.attrs?.["data-tl-era"] === "bg:back")).toBeDefined();
  });

  it("[claim:hit] a box and a point are hit, a background never", () => {
    const { result, tester, metrics } = frame(orientation);
    const scale = createTimeScale(result.viewport.domain, result.viewport.mainSize);
    for (const id of ["bar", "box", "dot"]) {
      const placed = result.layout.items.find((each) => each.item.id === id);
      expect(placed, id).toBeDefined();
      if (placed === undefined) continue;
      const rect = itemRect(placed, scale);
      const point = { main: rect.main + 1, cross: rect.cross + metrics.axisSize + rect.crossSize / 2 };
      expect(tester.hitTest(point)?.item.id).toBe(id);
    }
    // Inside the background's span, on every row and off any item: nothing.
    const backStart = scale.toMain(ORIGIN + 1 * DAY);
    const backEnd = scale.toMain(ORIGIN + 20 * DAY);
    for (let main = backStart + 1; main < backEnd; main += 7) {
      for (let cross = metrics.axisSize; cross < 300; cross += 5) {
        const hit = tester.hitTest({ main, cross }, "touch");
        expect(hit?.item.id).not.toBe("back");
      }
    }
  });

  it("[claim:never-covers] a background is drawn before every item, in the background layer", () => {
    const { result, split } = frame(orientation);
    expect(split.items.map((item) => item.id)).toEqual(["bar", "box", "dot"]);
    const order: string[] = [];
    const walk = (node: SceneElement): void => {
      if (node.attrs?.["data-tl-era"] === "bg:back") order.push("back");
      if (node.attrs?.role === "option") order.push(String(node.attrs["data-tl-id"]));
      for (const child of node.children ?? []) walk(child);
    };
    walk(result.scene);
    expect(order[0]).toBe("back");
    expect(order.slice(1).sort()).toEqual(["bar", "box", "dot"]);
    const background = layerOf(result.scene, "background");
    expect(find(background, (node) => node.attrs?.["data-tl-era"] === "bg:back")).toBeDefined();
    expect(find(background, (node) => node.attrs?.role === "option")).toBeUndefined();
  });

  it("draws a remove handle on a selected item when asked, outside the item", () => {
    const split = splitBackgrounds(ITEMS);
    const result = renderTimeline({
      items: split.items,
      domain: DOMAIN,
      width: 900,
      height: 400,
      orientation,
      selectedIds: ["bar"],
      hooks: itemKindHooks({}, { removable: true }),
    });
    expect(find(result.scene, (node) => node.attrs?.["data-tl-remove"] === "bar")).toBeDefined();
    expect(find(result.scene, (node) => node.attrs?.["data-tl-remove"] === "box")).toBeUndefined();
    const box = { main: 100, mainSize: 40, cross: 50, crossSize: 24 };
    const handle = removeHandleBox(box);
    expect(handle.main).toBeGreaterThan(box.main + box.mainSize);
    expect(onRemoveHandle(box, { main: handle.main + 2, cross: handle.cross + 2 })).toBe(true);
    expect(onRemoveHandle(box, { main: box.main + 2, cross: box.cross + 2 })).toBe(false);
    expect(onRemoveHandle(box, { main: handle.main - 3, cross: handle.cross }, 4)).toBe(true);
  });

  it("rings a focused point with a circle round its dot, and every other item with the default ring", () => {
    const focusOn = (focusedId: string, hooks = itemKindHooks()) =>
      renderTimeline({ items: splitBackgrounds(ITEMS).items, domain: DOMAIN, width: 900, height: 400, orientation, focusedId, hooks });
    const result = focusOn("dot");
    const rings = (scene: SceneElement): SceneElement[] => {
      const out: SceneElement[] = [];
      const walk = (node: SceneElement): void => {
        if (node.attrs?.class === "tl-focus-ring") out.push(node);
        for (const child of node.children ?? []) walk(child);
      };
      walk(scene);
      return out;
    };
    const [ring] = rings(result.scene);
    const dot = find(result.scene, (node) => node.attrs?.class === "tl-item-dot");
    // A circle, on the dot's centre, wider than the dot by the ring's gap: not a pill round the row.
    expect(rings(result.scene)).toHaveLength(1);
    expect(ring?.tag).toBe("circle");
    expect(ring?.attrs?.cx).toBe(dot?.attrs?.cx);
    expect(ring?.attrs?.cy).toBe(dot?.attrs?.cy);
    expect(Number(ring?.attrs?.r)).toBe(Number(dot?.attrs?.r) + 3);
    // A range and a box keep the rounded rect round their box.
    for (const id of ["bar", "box"]) expect(rings(focusOn(id).scene).map((node) => node.tag), id).toEqual(["rect"]);
    // A host's own ring is kept for what the kinds do not draw.
    const own = itemKindHooks({ renderFocus: () => ({ tag: "ellipse", attrs: { class: "tl-focus-ring" } }) });
    expect(rings(focusOn("bar", own).scene).map((node) => node.tag)).toEqual(["ellipse"]);
    expect(rings(focusOn("dot", own).scene).map((node) => node.tag)).toEqual(["circle"]);
  });

  it("starts a point's label past its dot, not under it", () => {
    const { result, metrics } = frame(orientation);
    const dot = find(result.scene, (node) => node.attrs?.class === "tl-item-dot");
    const label = find(result.scene, (node) => node.attrs?.["data-tl-label"] === "dot");
    expect(label?.attrs?.class).toBe("tl-label tl-label--after");
    const r = Number(dot?.attrs?.r);
    // Across, the text starts after its padding, along the axis; down, the line's top is where it starts. Down a
    // vertical timeline the label started 2 px past the dot's centre, and the dot's lower half lay on the text.
    const start = orientation === "horizontal" ? Number(label?.attrs?.x) + metrics.labelPadding : Number(label?.attrs?.y);
    const dotEnd = Number(dot?.attrs?.[orientation === "horizontal" ? "cx" : "cy"]) + r;
    expect(start).toBeGreaterThanOrEqual(dotEnd);
  });
});

it("leaves a list without backgrounds as it is, and an open background reaching the end", () => {
  const plain: Item[] = [{ id: "a", start: ORIGIN }];
  expect(splitBackgrounds(plain).items).toBe(plain);
  const open = splitBackgrounds([{ id: "o", kind: "background", start: ORIGIN, open: true, className: "x" }]);
  expect(open.backgrounds[0]).toMatchObject({ id: "bg:o", className: "tl-background x" });
  expect(open.backgrounds[0]?.end).toBe(Number.MAX_SAFE_INTEGER);
  const hooks = itemKindHooks({ renderItem: () => null }, { removable: true });
  const none = renderTimeline({ items: plain, domain: DOMAIN, width: 300, height: 200, selectedIds: ["a"], hooks });
  expect(find(none.scene, (node) => node.attrs?.["data-tl-id"] === "a")).toBeUndefined();
});

it("moves an item's id off the node it wraps, and leaves a node without one as it is", () => {
  const bare: SceneElement = { tag: "rect" };
  expect(withoutId(bare)).toBe(bare);
  const plain: SceneElement = { tag: "rect", attrs: { class: "tl-item" } };
  expect(withoutId(plain)).toBe(plain);
  const owned = withoutId({ tag: "rect", attrs: { class: "tl-item", "data-tl-id": "a" } });
  expect(owned.attrs?.["data-tl-id"]).toBeUndefined();
  expect(owned.attrs?.class).toBe("tl-item");
});
