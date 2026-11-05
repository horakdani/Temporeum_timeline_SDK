import { expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { createHitTester } from "../../src/editing.js";
import { crossAxisOf, mainAxisOf } from "../../src/geometry.js";
import { planSceneSpace } from "../../src/scene-space.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { Item, Lane, Orientation } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

/**
 * Culling along both axes, the lane scroll, and the scene space.
 *
 * The three are one subject: what gets a node, where the node sits, and which
 * attributes a frame has to write. Every claim is made in `(main, cross)`
 * and checked in both orientations — a culling test that only ran
 * horizontally would let a vertical timeline draw every lane it has.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);
const WIDTH = 800;
const HEIGHT = 600;

/** Twenty lanes of ten items each: more lanes than the container shows. */
function grid(): { readonly items: readonly Item[]; readonly lanes: readonly Lane[] } {
  const items: Item[] = [];
  const lanes: Lane[] = [];
  for (let lane = 0; lane < 20; lane += 1) {
    lanes.push({ id: `l${String(lane)}` });
    for (let index = 0; index < 10; index += 1) {
      const start = T0 + index * 10 * DAY;
      items.push({
        id: `l${String(lane)}-${String(index)}`,
        start,
        end: start + 6 * DAY,
        laneId: `l${String(lane)}`,
        label: `E${String(index)}`,
      });
    }
  }
  return { items, lanes };
}

function layerOf(scene: SceneElement, name: string): SceneElement {
  const layer = (scene.children ?? []).find(
    (child) => child.attrs?.class === `tl-layer tl-layer--${name}`,
  );
  if (layer === undefined) {
    throw new Error(`no ${name} layer`);
  }
  return layer;
}

function ids(scene: SceneElement): readonly string[] {
  return (layerOf(scene, "items").children ?? []).map((node) => String(node.attrs?.["data-tl-id"]));
}

function num(value: string | number | undefined): number {
  if (typeof value !== "number") {
    throw new Error(`expected a number, got ${String(value)}`);
  }
  return value;
}

/** `matrix(a b c d e f)` → the main-axis scale and shift for an orientation. */
function mainTransform(layer: SceneElement, orientation: Orientation): { k: number; t: number } {
  const text = String(layer.attrs?.transform ?? "");
  const parts = /^matrix\(([^)]*)\)$/.exec(text)?.[1]?.split(" ").map(Number);
  if (parts === undefined || parts.length !== 6) {
    throw new Error(`not a matrix: "${text}"`);
  }
  return orientation === "horizontal"
    ? { k: parts[0] as number, t: parts[4] as number }
    : { k: parts[3] as number, t: parts[5] as number };
}

describeBothOrientations("culling", (orientation) => {
  const { items, lanes } = grid();
  const metrics = densityMetrics("comfortable", orientation);
  const mainKey = mainAxisOf(orientation);
  const crossKey = crossAxisOf(orientation);
  const mainExtent = orientation === "horizontal" ? "width" : "height";
  const crossExtent = orientation === "horizontal" ? "height" : "width";
  const base: RenderOptions = {
    items,
    lanes,
    domain: [T0 + 20 * DAY, T0 + 50 * DAY],
    width: WIDTH,
    height: HEIGHT,
    orientation,
  };

  it("draws nothing outside the viewport plus the margin, along time", () => {
    const result = renderTimeline(base);
    const scale = createTimeScale([T0 + 20 * DAY, T0 + 50 * DAY], result.viewport.mainSize);
    for (const placed of result.layout.items) {
      const from = scale.toMain(placed.span.start);
      const to = scale.toMain(placed.span.end);
      const drawn = ids(result.scene).includes(placed.item.id);
      const reachable = to > -metrics.rowSize && from < result.viewport.mainSize + metrics.rowSize;
      expect(drawn && !reachable).toBe(false);
    }
    // And something was culled at all, or the test proves nothing.
    expect(ids(result.scene).length).toBeLessThan(items.length / 2);
  });

  it("draws nothing beyond the last visible lane plus the margin, across", () => {
    const result = renderTimeline(base);
    expect(result.contentCrossSize).toBeGreaterThan(result.viewport.crossSize);
    for (const node of layerOf(result.scene, "items").children ?? []) {
      expect(num(node.attrs?.[crossKey])).toBeLessThan(result.viewport.crossSize + metrics.rowSize);
    }
    // The lanes past the edge are gone too, not only their items.
    const laneCount = (layerOf(result.scene, "lanes").children ?? []).length;
    expect(laneCount).toBeGreaterThan(0);
    expect(laneCount).toBeLessThan(lanes.length);
  });

  it("draws an instant just before the edge whose minimum width reaches into view", () => {
    const edge = T0 + 20 * DAY;
    const result = renderTimeline({
      ...base,
      items: [{ id: "sliver", start: edge - 1, end: edge - 1, laneId: "l0" }],
    });
    // The span ends a millisecond before the domain, but it is drawn at the
    // minimum width — so a slice of it is on screen and must have a node.
    expect(ids(result.scene)).toEqual(["sliver"]);
  });

  it("follows the lane scroll, clips at the axis band, and agrees with the hit tester", () => {
    const scroll = 3 * (metrics.rowSize + metrics.laneGap) + 5;
    const result = renderTimeline({ ...base, crossOffset: scroll });
    const unscrolled = renderTimeline(base);
    // Lane 0 is fully scrolled away; a later lane comes into view.
    expect(ids(result.scene)).not.toContain("l0-3");
    expect(ids(unscrolled.scene)).toContain("l0-3");
    for (const node of layerOf(result.scene, "items").children ?? []) {
      expect(num(node.attrs?.[crossKey])).toBeGreaterThanOrEqual(metrics.axisSize);
    }
    for (const node of layerOf(result.scene, "lanes").children ?? []) {
      expect(num(node.attrs?.[crossKey])).toBeGreaterThanOrEqual(metrics.axisSize);
    }
    // What is drawn is what is hit: the centre of every fully visible node
    // hit-tests, with the same scroll, to that node's item.
    const tester = createHitTester({
      layout: result.layout,
      scale: createTimeScale([T0 + 20 * DAY, T0 + 50 * DAY], result.viewport.mainSize),
      crossInset: metrics.axisSize,
      crossOffset: scroll,
    });
    let checked = 0;
    for (const node of layerOf(result.scene, "items").children ?? []) {
      const main = num(node.attrs?.[mainKey]) + num(node.attrs?.[mainExtent]) / 2;
      const cross = num(node.attrs?.[crossKey]) + num(node.attrs?.[crossExtent]) / 2;
      if (main < 0 || main > result.viewport.mainSize || cross > result.viewport.crossSize) {
        continue;
      }
      expect(tester.hitTest({ main, cross })?.item.id).toBe(node.attrs?.["data-tl-id"]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("draws what lies inside the margin, on both axes", () => {
    // Along time: an item that ends half a margin before the left edge.
    const scale = createTimeScale([T0 + 20 * DAY, T0 + 50 * DAY], orientation === "horizontal" ? WIDTH : HEIGHT);
    const justBefore = T0 + 20 * DAY - (metrics.rowSize / 2) * scale.msPerPx;
    const alongTime = renderTimeline({
      ...base,
      items: [{ id: "before", start: justBefore - 2 * DAY, end: justBefore, laneId: "l0" }],
    });
    expect(ids(alongTime.scene)).toEqual(["before"]);
    // Across: scroll so that one lane starts two pixels past the far edge.
    const result = renderTimeline(base);
    const lane = result.layout.lanes.find(
      (laid) => laid.cross + metrics.axisSize > result.viewport.crossSize + metrics.rowSize,
    );
    if (lane === undefined) {
      throw new Error("no lane beyond the edge to scroll to");
    }
    const scroll = lane.cross + metrics.axisSize - (result.viewport.crossSize + 2);
    const scrolled = renderTimeline({ ...base, crossOffset: scroll });
    expect(ids(scrolled.scene).some((id) => id.startsWith(`${lane.lane.id}-`))).toBe(true);
  });

  it("rejects a scroll that is not a number", () => {
    expect(() => renderTimeline({ ...base, crossOffset: Number.NaN })).toThrow(RangeError);
  });
});

describeBothOrientations("scene space", (orientation) => {
  const { items, lanes } = grid();
  const mainKey = mainAxisOf(orientation);
  const crossKey = crossAxisOf(orientation);
  const mainExtent = orientation === "horizontal" ? "width" : "height";
  const domain: readonly [number, number] = [T0 + 20 * DAY, T0 + 50 * DAY];
  const base: RenderOptions = { items, lanes, domain, width: WIDTH, height: HEIGHT, orientation };
  const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT;
  const msPerPx = (30 * DAY) / mainSize;

  /** A layer's nodes, with the tile groups of a frame in a space opened up. */
  /** A label's text: on the node itself for an SVG `<text>`, on its one HTML line in a `foreignObject`. */
  const textOf = (node: SceneElement): string | undefined => node.text ?? node.children?.[0]?.text;

  function leaves(layer: SceneElement): SceneElement[] {
    const out: SceneElement[] = [];
    for (const node of layer.children ?? []) {
      if (node.attrs?.["data-tl-tile"] !== undefined) {
        out.push(...(node.children ?? []));
      } else {
        out.push(node);
      }
    }
    return out;
  }

  function nodesById(scene: SceneElement): Map<string, SceneElement> {
    return new Map(leaves(layerOf(scene, "items")).map((node) => [String(node.attrs?.["data-tl-id"]), node]));
  }

  /** A space grown to its full overscan at rest, the way a host gets there. */
  function grown(view = { domain, mainSize }): SceneSpace {
    let space = planSceneSpace(undefined, view, { settle: true });
    for (let frame = 0; frame < 40; frame += 1) {
      const next = planSceneSpace(space, view, { settle: true });
      if (next === space) {
        return space;
      }
      space = next;
    }
    throw new Error("the overscan never finished growing");
  }

  it("leaves the frame exactly as it was when no space is given", () => {
    const result = renderTimeline(base);
    for (const name of ["background", "axis", "lanes", "items", "labels", "foreground", "overlay"]) {
      expect(layerOf(result.scene, name).attrs?.transform).toBeUndefined();
    }
    expect(JSON.stringify(result.scene)).not.toContain("data-tl-tile");
  });

  it("maps every item, through the layer transform, onto its exact place", () => {
    const exact = nodesById(renderTimeline(base).scene);
    // A space anchored elsewhere and at another scale: the transform has to
    // do real work for the comparison to mean anything.
    const space = { origin: T0 + 3 * DAY, msPerPx: msPerPx * 1.3 };
    const spaced = renderTimeline({ ...base, space });
    const { k, t } = mainTransform(layerOf(spaced.scene, "items"), orientation);
    expect(k).toBeCloseTo(1.3, 6);
    const drawn = nodesById(spaced.scene);
    let compared = 0;
    for (const [id, reference] of exact) {
      const from = num(reference.attrs?.[mainKey]);
      const size = num(reference.attrs?.[mainExtent]);
      // Clipped at a viewport edge in the exact frame: its drawn box is the
      // clip, not the item, and is not comparable.
      if (from <= -1 || from + size >= mainSize + 1) {
        continue;
      }
      const node = drawn.get(id);
      if (node === undefined) {
        throw new Error(`${id} is on screen in the exact frame but not drawn in the space`);
      }
      expect(k * num(node.attrs?.[mainKey]) + t).toBeCloseTo(from, 2);
      expect(k * num(node.attrs?.[mainExtent])).toBeCloseTo(size, 2);
      expect(node.attrs?.[crossKey]).toBe(reference.attrs?.[crossKey]);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(10);
    expect(spaced.visibleCount).toBe(drawn.size);
  });

  it("puts the overlay and the labels in the items' space", () => {
    const result = renderTimeline({
      ...base,
      space: { origin: T0, msPerPx },
      selectedIds: ["l0-3"],
      hooks: { renderDetail: (context) => ({ tag: "rect", attrs: { x: context.box.main } }) },
    });
    const transform = layerOf(result.scene, "items").attrs?.transform;
    expect(transform).toBeDefined();
    expect(layerOf(result.scene, "overlay").attrs?.transform).toBe(transform);
    expect(layerOf(result.scene, "labels").attrs?.transform).toBe(transform);
    expect(leaves(layerOf(result.scene, "overlay"))).toHaveLength(1);
  });

  it("draws labels, ticks and lanes in the space, each mapped onto its exact place", () => {
    const exact = renderTimeline(base);
    // Shifted, not stretched: text is then comparable to the digit.
    const spaced = renderTimeline({ ...base, space: grown() });
    const items = mainTransform(layerOf(spaced.scene, "items"), orientation);
    const frame = mainTransform(layerOf(spaced.scene, "axis"), orientation);
    expect(items.k).toBe(1);
    expect(frame.k).toBe(1);
    const key = (node: SceneElement, t: number): string =>
      `${String(textOf(node))}|${String(node.attrs?.[crossKey])}|${(num(node.attrs?.[mainKey]) + t).toFixed(2)}`;

    const labels = new Set(leaves(layerOf(spaced.scene, "labels")).map((node) => key(node, items.t)));
    let checked = 0;
    for (const node of leaves(layerOf(exact.scene, "labels"))) {
      const main = num(node.attrs?.[mainKey]);
      // A label pinned to the edge in the exact frame is pinned in the space
      // only at rest; this frame is drawn at rest, but compare the interior.
      if (main < 20 || main > mainSize - 40) {
        continue;
      }
      expect(labels.has(key(node, 0))).toBe(true);
      checked += 1;
    }
    // Every interior label was checked; a vertical frame fits fewer.
    expect(checked).toBeGreaterThan(5);

    const tickKey = orientation === "horizontal" ? "x1" : "y1";
    const ticks = new Set(
      leaves(layerOf(spaced.scene, "axis"))
        .filter((node) => node.tag === "line")
        .map((node) => (num(node.attrs?.[tickKey]) + frame.t).toFixed(2)),
    );
    const exactTicks = leaves(layerOf(exact.scene, "axis")).filter((node) => node.tag === "line");
    expect(exactTicks.length).toBeGreaterThan(3);
    for (const node of exactTicks) {
      expect(ticks.has(num(node.attrs?.[tickKey]).toFixed(2))).toBe(true);
    }

    const exactLanes = leaves(layerOf(exact.scene, "lanes"));
    const spacedLanes = leaves(layerOf(spaced.scene, "lanes"));
    expect(spacedLanes.map((node) => node.attrs?.["data-tl-lane"])).toEqual(
      exactLanes.map((node) => node.attrs?.["data-tl-lane"]),
    );
    for (const node of spacedLanes) {
      const from = num(node.attrs?.[mainKey]) + frame.t;
      expect(from).toBeLessThanOrEqual(0);
      expect(from + num(node.attrs?.[mainExtent])).toBeGreaterThanOrEqual(mainSize);
    }
  });

  it("rewrites only the items that came into view when a pan stays in the space", () => {
    let space = planSceneSpace(undefined, { domain, mainSize });
    const before = nodesById(renderTimeline({ ...base, space }).scene);
    const panned: readonly [number, number] = [domain[0] + 4 * DAY, domain[1] + 4 * DAY];
    space = planSceneSpace(space, { domain: panned, mainSize });
    const after = nodesById(renderTimeline({ ...base, domain: panned, space }).scene);
    let kept = 0;
    for (const [id, node] of after) {
      const old = before.get(id);
      if (old !== undefined) {
        expect(node.attrs).toEqual(old.attrs);
        kept += 1;
      }
    }
    expect(kept).toBeGreaterThan(10);
    expect(after.size).toBeGreaterThan(0);
  });

  it("rewrites only the items that came into view when a zoom stays in the space", () => {
    let space = planSceneSpace(undefined, { domain, mainSize });
    const before = nodesById(renderTimeline({ ...base, space }).scene);
    // 1.2x out about the middle: inside the default 1.5x.
    const middle = (domain[0] + domain[1]) / 2;
    const half = ((domain[1] - domain[0]) / 2) * 1.2;
    const zoomed: readonly [number, number] = [middle - half, middle + half];
    const next = planSceneSpace(space, { domain: zoomed, mainSize });
    expect(next.origin).toBe(space.origin);
    expect(next.msPerPx).toBe(space.msPerPx);
    space = next;
    const result = renderTimeline({ ...base, domain: zoomed, space });
    const after = nodesById(result.scene);
    let kept = 0;
    for (const [id, node] of after) {
      const old = before.get(id);
      if (old !== undefined) {
        expect(node.attrs).toEqual(old.attrs);
        kept += 1;
      }
    }
    expect(kept).toBeGreaterThan(10);
    // Zooming out shows more: some items are new, and only those were written.
    expect(after.size).toBeGreaterThan(before.size);
    expect(mainTransform(layerOf(result.scene, "items"), orientation).k).toBeCloseTo(1 / 1.2, 6);
  });

  it("hands back the very same layer children while a frame stays inside what is drawn", () => {
    const space = { ...grown(), atRest: false };
    const first = renderTimeline({ ...base, space });
    const panned: readonly [number, number] = [domain[0] + 3 * DAY, domain[1] + 3 * DAY];
    const second = renderTimeline({ ...base, domain: panned, space });
    for (const name of ["background", "axis", "lanes", "items", "foreground", "overlay"]) {
      expect(layerOf(second.scene, name).children).toBe(layerOf(first.scene, name).children);
    }
    // The labels too, tile by tile: a gesture's frame adds the
    // labels the edges cut off in a group of their own, which moves with the
    // view — the tiles' labels are the very same nodes.
    const tilesOf = (scene: SceneElement): SceneElement[] =>
      (layerOf(scene, "labels").children ?? []).filter((node) => node.attrs?.class !== "tl-edge-labels");
    const before = tilesOf(first.scene);
    const after = tilesOf(second.scene);
    expect(after).toHaveLength(before.length);
    after.forEach((tile, index) => expect(tile).toBe(before[index]));
    expect(layerOf(second.scene, "items").attrs?.transform).not.toBe(
      layerOf(first.scene, "items").attrs?.transform,
    );
  });

  it("draws only the tiles that came in when a pan reaches past what is drawn", () => {
    let space = planSceneSpace(undefined, { domain, mainSize });
    const before = layerOf(renderTimeline({ ...base, space }).scene, "items").children ?? [];
    // Half a viewport: two tiles come in, the rest stay.
    const panned: readonly [number, number] = [domain[0] + 15 * DAY, domain[1] + 15 * DAY];
    space = planSceneSpace(space, { domain: panned, mainSize });
    const after = layerOf(renderTimeline({ ...base, domain: panned, space }).scene, "items").children ?? [];
    const old = new Map(before.map((tile) => [tile.attrs?.["data-tl-tile"], tile]));
    let reused = 0;
    let drawn = 0;
    for (const tile of after) {
      const previous = old.get(tile.attrs?.["data-tl-tile"]);
      // The first tile takes what starts before the range, so it is the one
      // kept tile allowed to change.
      if (previous !== undefined && tile !== after[0]) {
        expect(tile).toBe(previous);
        reused += 1;
      } else if (previous === undefined) {
        drawn += 1;
      }
    }
    expect(reused).toBeGreaterThanOrEqual(2);
    expect(drawn).toBeGreaterThanOrEqual(1);
  });

  it("leaves the tiles alone when a gesture stops and starts", () => {
    const resting = grown();
    const atRest = renderTimeline({ ...base, space: resting });
    const moving = renderTimeline({ ...base, space: { ...resting, atRest: false } });
    expect(layerOf(moving.scene, "items").children).toBe(layerOf(atRest.scene, "items").children);
    const tilesAtRest = (layerOf(atRest.scene, "labels").children ?? []).filter(
      (node) => node.attrs?.["data-tl-tile"] !== undefined,
    );
    expect(tilesAtRest).toEqual(layerOf(moving.scene, "labels").children);
    tilesAtRest.forEach((tile, index) => {
      expect(tile).toBe((layerOf(moving.scene, "labels").children ?? [])[index]);
    });
  });

  // Until 1.0.0-rc.4 only at rest: during a gesture the label stayed where
  // the item starts, off-screen, and came back when the gesture ended.
  it("pins the label of an item the near edge cuts off, at rest and during a gesture alike", () => {
    const long: Item = { id: "long", start: domain[0] - 5 * DAY, end: domain[0] + 12 * DAY, label: "Lengthy" };
    const options: RenderOptions = { domain, width: WIDTH, height: HEIGHT, orientation, items: [long] };
    const resting = grown();
    /** The label nodes with that text, where they land on the screen — through any group's own transform. */
    const onScreen = (scene: SceneElement): number[] => {
      const layer = layerOf(scene, "labels");
      const { k, t } = mainTransform(layer, orientation);
      const found: number[] = [];
      for (const node of leaves(layer)) {
        if (node.attrs?.class === "tl-edge-labels") {
          const group = mainTransform(node, orientation);
          for (const child of node.children ?? []) {
            if (textOf(child) === "Lengthy") {
              found.push(k * (group.k * num(child.attrs?.[mainKey]) + group.t) + t);
            }
          }
        } else if (textOf(node) === "Lengthy") {
          found.push(k * num(node.attrs?.[mainKey]) + t);
        }
      }
      return found.filter((main) => main >= 0 && main < mainSize);
    };
    const exact = leaves(layerOf(renderTimeline(options).scene, "labels"));
    expect(exact).toHaveLength(1);
    const want = num(exact[0]?.attrs?.[mainKey]);
    const pinned = onScreen(renderTimeline({ ...options, space: resting }).scene);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toBeCloseTo(want, 2);
    // During a gesture, the same place on the screen.
    const moving = onScreen(renderTimeline({ ...options, space: { ...resting, atRest: false } }).scene);
    expect(moving).toHaveLength(1);
    expect(moving[0]).toBeCloseTo(want, 2);
    // Unless the host asked for bare frames: then nothing is added.
    expect(onScreen(renderTimeline({ ...options, space: { ...resting, atRest: false, bare: true } }).scene)).toHaveLength(0);
  });

  it("does not pin a label whose own is still partly on screen", () => {
    // Starts a sliver before the edge: its own label, drawn where it starts,
    // reaches into view. A pin there would put the same text twice.
    const near: Item = { id: "near", start: domain[0] - DAY / 4, end: domain[0] + 12 * DAY, label: "Nearby" };
    const options: RenderOptions = { domain, width: WIDTH, height: HEIGHT, orientation, items: [near] };
    const scene = renderTimeline({ ...options, space: grown() }).scene;
    const texts = leaves(layerOf(scene, "labels")).filter((node) => textOf(node) === "Nearby");
    expect(texts).toHaveLength(1);
  });

  it("keeps the label after an item that ends near its tile's end, during a gesture too", () => {
    // A short item ending a few pixels before the first tile's end: its label
    // does not fit inside, so it goes after — across the tile edge. A tile
    // used to give that label up; an exact frame keeps it.
    const tile = mainSize / 4;
    const msPerPx = (domain[1] - domain[0]) / mainSize;
    const short: Item = {
      id: "short",
      start: domain[0] + (tile - 10) * msPerPx,
      end: domain[0] + (tile - 4) * msPerPx,
      label: "A",
    };
    const options: RenderOptions = { domain, width: WIDTH, height: HEIGHT, orientation, items: [short] };
    const exact = renderTimeline(options).labels.kept;
    expect(exact.map((label) => [label.id, label.placement])).toEqual([["short", "after"]]);
    const moving = planSceneSpace(undefined, { domain, mainSize });
    expect(moving.atRest).toBe(false);
    const kept = renderTimeline({ ...options, space: moving }).labels.kept;
    expect(kept.map((label) => [label.id, label.placement])).toEqual([["short", "after"]]);
    expect((kept[0]?.box.main ?? 0) + (kept[0]?.box.mainSize ?? 0)).toBeGreaterThan(tile);
  });

  it("never lets a label run past the next tile, and reserves the items there", () => {
    // The same short item, with a second one starting right after the tile
    // edge in its row: the label would land on it, so it is given up — in
    // the exact frame and in the space alike.
    const tile = mainSize / 4;
    const msPerPx = (domain[1] - domain[0]) / mainSize;
    const short: Item = {
      id: "short",
      start: domain[0] + (tile - 10) * msPerPx,
      end: domain[0] + (tile - 4) * msPerPx,
      label: "A",
    };
    const next: Item = { id: "next", start: domain[0] + (tile + 2) * msPerPx, end: domain[0] + (tile + 60) * msPerPx };
    const options: RenderOptions = { domain, width: WIDTH, height: HEIGHT, orientation, items: [short, next] };
    const exact = renderTimeline(options).labels.kept;
    expect(exact.map((label) => label.id)).toEqual([]);
    const kept = renderTimeline({ ...options, space: planSceneSpace(undefined, { domain, mainSize }) }).labels.kept;
    expect(kept.map((label) => label.id)).toEqual([]);
    // Also when the second item lies past the drawn range: the first tile's
    // reservations reach into the next tile whether it is drawn or not.
    const firstTileOnly = { origin: domain[0], msPerPx, extent: [domain[0], domain[0] + tile * msPerPx] as const };
    // A fresh array: the tile cache is keyed by it, and must not answer here.
    const alone = renderTimeline({ ...options, items: [{ ...short }, { ...next }], space: firstTileOnly });
    expect(alone.labels.kept.map((label) => label.id)).toEqual([]);
  });

  it("holds a maxLabels ceiling across the whole frame at rest, not per tile", () => {
    // Each tile holds a share of the ceiling, so a viewport across five
    // tiles shows more than one label during a gesture; at rest the frame
    // places the viewport's labels as an exact frame does, and shows those.
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes, maxLabels: 1 };
    const resting = grown();
    const rest = renderTimeline({ ...options, space: resting });
    const exact = renderTimeline(options);
    expect(rest.labels.kept.map((label) => label.id)).toEqual(exact.labels.kept.map((label) => label.id));
    expect(leaves(layerOf(rest.scene, "labels"))).toHaveLength(1);
    const moving = renderTimeline({ ...options, space: { ...resting, atRest: false } });
    expect(moving.labels.kept.length).toBeGreaterThan(1);
  });

  it("draws a frame at rest the same, whether its labels came from the last frame's cache or not", () => {
    // The rest labels are cached per items array, keyed by what decides them
    // (by the items and the tile labels' boxes, no longer by entry). A
    // fresh copy of the array is a cold cache: every frame must match one.
    const { items: original, lanes } = grid();
    // One array throughout, as a host keeps it; below, an item in it is
    // replaced — the same count, the same view, another label.
    const items = [...original];
    const cold = (options: RenderOptions): string =>
      JSON.stringify(renderTimeline({ ...options, items: [...options.items] }).scene);
    const warm = (options: RenderOptions): string => JSON.stringify(renderTimeline(options).scene);
    const view = { domain, mainSize };
    let space = planSceneSpace(undefined, view, { settle: true });
    const frames: RenderOptions[] = [];
    // The overscan growing, a strip per frame, before and after the view.
    for (let frame = 0; frame < 6; frame += 1) {
      frames.push({ ...base, items, lanes, space });
      space = planSceneSpace(space, view, { settle: true });
    }
    // Then what the cache must not carry over: density, a ceiling, the
    // lanes scrolled, a narrower container.
    frames.push({ ...base, items, lanes, space, density: "dense" });
    frames.push({ ...base, items, lanes, space, density: "dense", maxLabels: 2 });
    frames.push({ ...base, items, lanes, space, crossOffset: 40 });
    const narrow = orientation === "horizontal" ? { width: WIDTH / 2 } : { height: HEIGHT / 2 };
    const half = { domain, mainSize: mainSize / 2 };
    frames.push({ ...base, ...narrow, items, lanes, space: grown(half) });
    for (const options of frames) {
      expect(warm(options)).toBe(cold(options));
    }
    // A label only the frame at rest draws — pinned at the near edge — with
    // another text of the same length: nothing a tile shows changes.
    const pinned: Item[] = [{ id: "long", start: domain[0] - 5 * DAY, end: domain[0] + 12 * DAY, label: "Lengthy" }];
    const settled: RenderOptions = { domain, width: WIDTH, height: HEIGHT, orientation, items: pinned, space: grown() };
    expect(warm(settled)).toBe(cold(settled));
    pinned[0] = { ...(pinned[0] as Item), label: "Shorter" };
    expect(warm(settled)).toBe(cold(settled));
    expect(warm(settled)).toContain("Shorter");
  });

  it("stands the old scale in for a stepped re-anchor, and a pinch back finds its tiles", () => {
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes };
    const resting = grown();
    const before = layerOf(renderTimeline({ ...options, space: resting }).scene, "items").children ?? [];
    const middle = (domain[0] + domain[1]) / 2;
    const half = (domain[1] - domain[0]) / 2 / 1.7;
    const zoomed: readonly [number, number] = [middle - half, middle + half];
    const stepped = planSceneSpace(resting, { domain: zoomed, mainSize }, { levels: true });
    expect(stepped.msPerPx).toBe(resting.msPerPx / 2);
    const first = renderTimeline({ ...options, domain: zoomed, space: stepped });
    expect(first.pendingTiles).toBeGreaterThan(0);
    // A tile of the old scale, its very children, under one transform.
    const doubled = orientation === "horizontal" ? "matrix(2 0 0 1 0 0)" : "matrix(1 0 0 2 0 0)";
    const stood = (layerOf(first.scene, "items").children ?? []).filter((tile) => tile.attrs?.transform === doubled);
    expect(stood.length).toBeGreaterThan(0);
    for (const tile of stood) {
      expect(before.some((old) => old.children === tile.children)).toBe(true);
    }
    // Back to where it started: the first scale's tiles are still there.
    const back = planSceneSpace(stepped, { domain, mainSize }, { levels: true });
    expect(back.msPerPx).toBe(resting.msPerPx);
    const again = renderTimeline({ ...options, space: back });
    expect(again.pendingTiles).toBe(0);
    const reused = (layerOf(again.scene, "items").children ?? []).filter((tile) => before.includes(tile));
    expect(reused.length).toBeGreaterThan(0);
  });

  it("brings a scale it goes back to on screen a budget at a time, while the one it leaves stands in", () => {
    // Its tiles are drawn, but showing them moves every item back in at
    // another scale — what the browser pays for drawing them. A wheel zoom's
    // last notch out once did that in one frame.
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes };
    const resting = grown();
    const before = layerOf(renderTimeline({ ...options, space: resting }).scene, "items").children ?? [];
    const middle = (domain[0] + domain[1]) / 2;
    const half = (domain[1] - domain[0]) / 2 / 1.7;
    const zoomed: readonly [number, number] = [middle - half, middle + half];
    const stepped = planSceneSpace(resting, { domain: zoomed, mainSize }, { levels: true });
    // The finer scale, refilled to the end.
    let frames = 0;
    while (renderTimeline({ ...options, domain: zoomed, space: stepped }).pendingTiles > 0) {
      frames += 1;
      expect(frames).toBeLessThan(40);
    }
    // Back out: the first scale's tiles are cached, and come back paced.
    const back = planSceneSpace(stepped, { domain, mainSize }, { levels: true });
    expect(back.msPerPx).toBe(resting.msPerPx);
    const halved = orientation === "horizontal" ? "matrix(0.5 0 0 1 0 0)" : "matrix(1 0 0 0.5 0 0)";
    const firstBack = renderTimeline({ ...options, space: back });
    expect(firstBack.pendingTiles).toBeGreaterThan(0);
    expect((layerOf(firstBack.scene, "items").children ?? []).some((tile) => tile.attrs?.transform === halved)).toBe(true);
    let result = firstBack;
    for (let frame = 0; result.pendingTiles > 0; frame += 1) {
      expect(frame).toBeLessThan(40);
      const next = renderTimeline({ ...options, space: back });
      expect(next.pendingTiles).toBeLessThan(result.pendingTiles);
      result = next;
    }
    // Then exactly the first scale's own tiles, the very ones drawn before.
    const shown = layerOf(result.scene, "items").children ?? [];
    expect(shown.some((tile) => tile.attrs?.transform === halved)).toBe(false);
    expect(shown.filter((tile) => !before.includes(tile)).map((tile) => tile.attrs?.["data-tl-tile"])).toEqual([
      shown[0]?.attrs?.["data-tl-tile"],
    ]);
    // At rest nothing is paced: the frame is the exact one at once.
    const settledBack = planSceneSpace(back, { domain, mainSize }, { settle: true, levels: true });
    expect(settledBack.budget).toBeUndefined();
    expect(renderTimeline({ ...options, space: settledBack }).pendingTiles).toBe(0);
  });

  // R96: of two scales as near, the stand-in was the one first in the cache
  // — on a wheel zoom's step out, the scale it started at, hidden since its
  // first step: every stand-in tile came back into the page whole (2,900
  // attributes, a 30-40 ms patch at a 4x slowdown) instead of the tiles on
  // screen taking a transform.
  it("stands in with the tiles on screen, of two scales as near, when a zoom steps back out", () => {
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes };
    const resting = grown();
    renderTimeline({ ...options, space: resting });
    const middle = (domain[0] + domain[1]) / 2;
    const around = (factor: number): readonly [number, number] => {
      const half = (domain[1] - domain[0]) / 2 / factor;
      return [middle - half, middle + half];
    };
    const fill = (frame: RenderOptions): ReturnType<typeof renderTimeline> => {
      let result = renderTimeline(frame);
      for (let step = 0; step < 200 && result.pendingTiles > 0; step += 1) result = renderTimeline(frame);
      expect(result.pendingTiles).toBe(0);
      return result;
    };
    // In two steps, to a quarter, each filled to the end...
    const half = planSceneSpace(resting, { domain: around(1.7), mainSize }, { levels: true });
    expect(half.msPerPx).toBe(resting.msPerPx / 2);
    fill({ ...options, domain: around(1.7), space: half });
    const quarter = planSceneSpace(half, { domain: around(3.4), mainSize }, { levels: true });
    expect(quarter.msPerPx).toBe(resting.msPerPx / 4);
    fill({ ...options, domain: around(3.4), space: quarter });
    // ...and out again, squeezed nearly to half, the quarter's tiles on screen.
    const squeezed = planSceneSpace(quarter, { domain: around(2.1), mainSize }, { levels: true });
    expect(squeezed.msPerPx).toBe(quarter.msPerPx);
    const last = fill({ ...options, domain: around(2.1), space: squeezed });
    const onScreen = new Set((layerOf(last.scene, "items").children ?? []).map((tile) => tile.children));
    // The step out: the half's tiles come back paced, and what stands in
    // for them meanwhile is what was on screen, under a transform. Only near
    // the ends does the first scale stand in, one group a side at most: past
    // what the quarter drew, and at its first tile, which is cut at the
    // range's start and lends itself to no other range.
    const out = planSceneSpace(squeezed, { domain: around(1.95), mainSize }, { levels: true });
    expect(out.msPerPx).toBe(half.msPerPx);
    const first = renderTimeline({ ...options, domain: around(1.95), space: out });
    expect(first.pendingTiles).toBeGreaterThan(0);
    const tiles = layerOf(first.scene, "items").children ?? [];
    const at = (shown: boolean): number[] =>
      tiles.flatMap((tile, index) => (tile.attrs?.transform !== undefined && onScreen.has(tile.children) === shown ? [index] : []));
    const kept = at(true);
    const hidden = at(false);
    expect(kept.length).toBeGreaterThan(hidden.length);
    expect(hidden.length).toBeLessThanOrEqual(2);
    expect(hidden.filter((index) => index > 4 && index < tiles.length - 5)).toEqual([]);
  });

  // Until 1.0.0-rc.4 a stepped gesture drew its new tiles bare, and their
  // labels were gone until it came to rest.
  it("draws a stepped gesture's new tiles with their labels, and the frame at rest is exact", () => {
    // Wide enough apart that labels fit once zoomed in two-fold.
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes, density: "comfortable" };
    const resting = grown();
    renderTimeline({ ...options, space: resting });
    const middle = (domain[0] + domain[1]) / 2;
    const half = (domain[1] - domain[0]) / 2 / 1.7;
    const zoomed: readonly [number, number] = [middle - half, middle + half];
    const stepped = planSceneSpace(resting, { domain: zoomed, mainSize }, { levels: true });
    expect(stepped.bare).toBeUndefined();
    let frame = renderTimeline({ ...options, domain: zoomed, space: stepped });
    for (let step = 0; step < 200 && frame.pendingTiles > 0; step += 1) {
      frame = renderTimeline({ ...options, domain: zoomed, space: stepped });
    }
    // Every tile in view drawn at the new scale, with its labels: every
    // label of the exact frame is on screen during the gesture too.
    expect(frame.pendingTiles).toBe(0);
    const { k, t } = mainTransform(layerOf(frame.scene, "labels"), orientation);
    const onScreen = new Set(
      frame.labels.kept
        .filter((label) => {
          const from = k * label.box.main + t;
          return from < mainSize && from + k * label.box.mainSize > 0;
        })
        .map((label) => label.id),
    );
    const exact = renderTimeline({ ...options, domain: zoomed });
    expect(exact.labels.kept.length).toBeGreaterThan(0);
    for (const label of exact.labels.kept) {
      expect(onScreen.has(label.id)).toBe(true);
    }
    // The gesture ends where it is: the frame at rest is exact again.
    const settled = planSceneSpace(stepped, { domain: zoomed, mainSize }, { levels: true, settle: true });
    const rest = renderTimeline({ ...options, domain: zoomed, space: settled });
    expect(rest.labels.kept.map((label) => label.id).sort()).toEqual(exact.labels.kept.map((label) => label.id).sort());
  });

  it("draws everything when a scale does not nest, and keeps three scales at most", () => {
    const { items, lanes } = grid();
    const options: RenderOptions = { ...base, items, lanes };
    const resting = grown();
    renderTimeline({ ...options, space: resting });
    // The same origin, a scale that is no power of two off: a cache of its own.
    const odd = renderTimeline({ ...options, space: { ...resting, msPerPx: resting.msPerPx * 1.3, budget: 1 } });
    expect(odd.pendingTiles).toBe(0);
    // Four nested scales in a row: the oldest is let go, nothing breaks.
    let space: SceneSpace = { ...resting, budget: 1 };
    const middle = (domain[0] + domain[1]) / 2;
    for (const factor of [0.5, 0.25, 0.125, 0.0625]) {
      // The viewport of that scale, about the middle.
      const half = ((domain[1] - domain[0]) / 2) * factor;
      space = { ...space, msPerPx: resting.msPerPx * factor, extent: [middle - half, middle + half] };
      let frame = renderTimeline({ ...options, space });
      for (let step = 0; step < 100 && frame.pendingTiles > 0; step += 1) {
        frame = renderTimeline({ ...options, space });
      }
      expect(frame.pendingTiles).toBe(0);
    }
  });

  it("redraws a tile when the selection changes inside it", () => {
    const space = grown();
    const detail = { renderDetail: () => ({ tag: "circle" }) };
    const plain = renderTimeline({ ...base, space, hooks: detail });
    const chosen = renderTimeline({ ...base, space, hooks: detail, selectedIds: ["l1-3"] });
    const node = nodesById(chosen.scene).get("l1-3");
    expect(String(node?.attrs?.class)).toContain("tl-item--selected");
    expect(String(nodesById(plain.scene).get("l1-3")?.attrs?.class)).not.toContain("tl-item--selected");
    expect(leaves(layerOf(chosen.scene, "overlay"))).toHaveLength(1);
    // Only the tile holding it was redrawn; the rest came back as they were.
    const before = layerOf(plain.scene, "items").children ?? [];
    const after = layerOf(chosen.scene, "items").children ?? [];
    expect(after.filter((tile, index) => tile !== before[index])).toHaveLength(1);
  });

  it("rejects a space with no scale, or an extent that is not a range", () => {
    expect(() => renderTimeline({ ...base, space: { origin: T0, msPerPx: 0 } })).toThrow(RangeError);
    expect(() =>
      renderTimeline({ ...base, space: { origin: Number.NaN, msPerPx: 1 } }),
    ).toThrow(RangeError);
    expect(() =>
      renderTimeline({ ...base, space: { origin: T0, msPerPx, extent: [domain[1], domain[0]] } }),
    ).toThrow(RangeError);
  });
});
