import { expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { crossAxisOf, mainAxisOf } from "../../src/geometry.js";
import { renderTimeline } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 2, 10);
const DOMAIN: readonly [number, number] = [T0, T0 + 20 * DAY];
const WIDTH = 900;
const HEIGHT = 420;

const ITEMS: readonly Item[] = [
  { id: "early", start: T0 + DAY, end: T0 + 4 * DAY, label: "Első", laneId: "work" },
  { id: "overlap", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Átfedő", laneId: "work" },
  { id: "late", start: T0 + 15 * DAY, end: T0 + 18 * DAY, label: "Utolsó", laneId: "home" },
  { id: "ongoing", start: T0 + 10 * DAY, open: true, label: "Nyitott", laneId: "home" },
];
const LANES = [{ id: "work" }, { id: "home" }];

function layerOf(scene: SceneElement, name: string): readonly SceneElement[] {
  const layer = (scene.children ?? []).find(
    (child) => child.attrs?.class === `tl-layer tl-layer--${name}`,
  );
  return layer?.children ?? [];
}

function number(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

function allNodes(node: SceneElement): readonly SceneElement[] {
  return [node, ...(node.children ?? []).flatMap((child) => allNodes(child))];
}

describeBothOrientations("render projection", (orientation) => {
  const metrics = densityMetrics("comfortable", orientation);
  const result = renderTimeline({
    items: ITEMS,
    lanes: LANES,
    domain: DOMAIN,
    width: WIDTH,
    height: HEIGHT,
    orientation,
    decorations: [{ kind: "banding" }, { kind: "now", time: T0 + 8 * DAY, label: "most" }],
  });
  const mainKey = mainAxisOf(orientation);
  const crossKey = crossAxisOf(orientation);
  const mainExtent = orientation === "horizontal" ? "width" : "height";
  const crossExtent = orientation === "horizontal" ? "height" : "width";
  const { mainSize, crossSize } = result.viewport;

  function itemNode(id: string): SceneElement {
    const node = layerOf(result.scene, "items").find((candidate) => candidate.attrs?.["data-tl-id"] === id);
    if (node === undefined) {
      throw new Error(`item ${id} was not drawn`);
    }
    return node;
  }

  it("keeps every item inside the container, overdraw aside", () => {
    for (const node of layerOf(result.scene, "items")) {
      const main = number(node.attrs?.[mainKey]);
      const cross = number(node.attrs?.[crossKey]);
      expect(main).toBeGreaterThanOrEqual(-metrics.rowSize);
      expect(main + number(node.attrs?.[mainExtent])).toBeLessThanOrEqual(mainSize + metrics.rowSize);
      expect(cross).toBeGreaterThanOrEqual(metrics.axisSize);
      expect(cross + number(node.attrs?.[crossExtent])).toBeLessThanOrEqual(crossSize + 1);
    }
  });

  it("sends later times further along the time axis", () => {
    expect(number(itemNode("late").attrs?.[mainKey])).toBeGreaterThan(
      number(itemNode("early").attrs?.[mainKey]),
    );
  });

  it("stacks the lanes along the lane axis, in lane order", () => {
    const lanes = layerOf(result.scene, "lanes");
    expect(lanes).toHaveLength(2);
    expect(number(lanes[1]?.attrs?.[crossKey])).toBeGreaterThan(
      number(lanes[0]?.attrs?.[crossKey]),
    );
    // Sublanes inside a lane also stack on the cross axis.
    expect(number(itemNode("overlap").attrs?.[crossKey])).toBeGreaterThan(
      number(itemNode("early").attrs?.[crossKey]),
    );
  });

  it("gives the axis the first band of the lane axis", () => {
    for (const lane of layerOf(result.scene, "lanes")) {
      expect(number(lane.attrs?.[crossKey])).toBeGreaterThanOrEqual(metrics.axisSize);
    }
    for (const node of layerOf(result.scene, "axis")) {
      if (node.tag !== "text") {
        continue;
      }
      expect(number(node.attrs?.[crossKey])).toBeLessThanOrEqual(metrics.axisSize);
    }
  });

  it("runs a tick line across the whole lane axis at one instant", () => {
    const lines = layerOf(result.scene, "axis").filter((node) => node.tag === "line");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(number(line.attrs?.[`${mainKey}1`])).toBeCloseTo(number(line.attrs?.[`${mainKey}2`]));
      expect(number(line.attrs?.[`${crossKey}1`])).toBe(0);
      expect(number(line.attrs?.[`${crossKey}2`])).toBe(crossSize);
    }
  });

  it("never rotates a line of text", () => {
    // A vertical timeline with sideways labels is a timeline nobody reads.
    for (const node of allNodes(result.scene)) {
      if (node.tag === "text") {
        expect(node.attrs?.transform).toBeUndefined();
        expect(node.attrs?.["writing-mode"]).toBeUndefined();
      }
    }
  });

  it("packs the same rows whichever way the time axis runs", () => {
    // Pixels differ between orientations — a column is wider than a row is
    // tall — but the packing is the same, because collision is in time.
    const rows = new Map(result.layout.items.map((placed) => [placed.item.id, placed.row]));
    expect([...rows.entries()].sort()).toEqual([
      ["early", 0],
      // The open interval is packed first — it starts earlier — and reaches
      // past every viewport, so nothing follows it in its sublane.
      ["late", 3],
      ["ongoing", 2],
      ["overlap", 1],
    ]);
  });

  it("emits no NaN coordinate anywhere in the scene", () => {
    for (const node of allNodes(result.scene)) {
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        if (typeof value === "number") {
          expect(Number.isFinite(value), `${node.tag}.${name}`).toBe(true);
        }
      }
    }
  });
});
