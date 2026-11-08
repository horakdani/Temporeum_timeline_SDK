/**
 * The Gantt hooks' drawing: progress, baseline and milestone, in both
 * orientations — and that a plain item is drawn as before.
 */

import { expect, it } from "vitest";

import { milestoneHalf } from "../../src/gantt/box.js";
import { describeBaseline, ganttHooks, progressOf, routeDependencies, taskBox } from "../../src/gantt/index.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);

function find(node: SceneElement, test: (node: SceneElement) => boolean): SceneElement | undefined {
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const items: Item[] = [
  { id: "plain", start: ORIGIN, end: ORIGIN + 4 * DAY, label: "Plain", laneId: "a" },
  { id: "half", start: ORIGIN, end: ORIGIN + 10 * DAY, label: "Half", laneId: "b", progress: 0.5, baseline: { start: ORIGIN - 2 * DAY, end: ORIGIN + 8 * DAY } },
  { id: "gate", start: ORIGIN + 12 * DAY, label: "Gate", laneId: "c", kind: "milestone" },
];

describeBothOrientations("gantt drawing", (orientation) => {
  const frame = renderTimeline({
    items,
    lanes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    domain: [ORIGIN - 5 * DAY, ORIGIN + 20 * DAY],
    width: orientation === "horizontal" ? 1000 : 300,
    height: orientation === "horizontal" ? 300 : 1000,
    orientation,
    hooks: ganttHooks({}, { items, dependencies: [{ from: "half", to: "gate" }] }),
  });
  const along = orientation === "horizontal" ? "width" : "height";

  it("fills a bar as far as its progress, inside the bar", () => {
    const task = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "half");
    expect(task?.tag).toBe("g");
    expect(task?.attrs?.role).toBe("option");
    const bar = task?.children?.[0];
    const fill = find(task as SceneElement, (node) => node.attrs?.class === "tl-progress");
    expect(Number(fill?.attrs?.[along])).toBeCloseTo(Number(bar?.attrs?.[along]) / 2, 0);
    // One element per item answers to its id.
    expect(bar?.attrs?.["data-tl-id"]).toBeUndefined();
  });

  it("draws the baseline under the bar, over the planned span", () => {
    const baseline = find(frame.scene, (node) => node.attrs?.class === "tl-baseline");
    const bar = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "half")?.children?.[0];
    expect(baseline).toBeDefined();
    expect(Number(baseline?.attrs?.[along])).toBeCloseTo(Number(bar?.attrs?.[along]), 0);
  });

  it("draws a milestone as a diamond with its name", () => {
    const gate = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "gate");
    expect(gate?.tag).toBe("path");
    expect(String(gate?.attrs?.d)).toMatch(/Z$/);
    expect(String(gate?.attrs?.["aria-label"])).toContain("milestone");
    expect(String(gate?.attrs?.["aria-label"])).toContain("after Half");
  });

  it("rings a focused milestone with a diamond round its diamond, a bar with the default ring", () => {
    const focused = (focusedId: string): SceneElement | undefined =>
      find(
        renderTimeline({
          items,
          lanes: [{ id: "a" }, { id: "b" }, { id: "c" }],
          domain: [ORIGIN - 5 * DAY, ORIGIN + 20 * DAY],
          width: orientation === "horizontal" ? 1000 : 300,
          height: orientation === "horizontal" ? 300 : 1000,
          orientation,
          focusedId,
          hooks: ganttHooks({}, { items }),
        }).scene,
        (node) => node.attrs?.class === "tl-focus-ring",
      );
    const corners = (d: unknown): number[][] =>
      [...String(d).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    const ring = focused("gate");
    expect(ring?.tag).toBe("path");
    const diamond = corners(find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "gate")?.attrs?.d);
    const around = corners(ring?.attrs?.d);
    expect(around).toHaveLength(4);
    // The same centre, every corner further out: the ring follows the diamond, 3 px off each side.
    const centre = (points: number[][]): number[] => [0, 1].map((axis) => points.reduce((sum, point) => sum + (point[axis] ?? 0), 0) / 4);
    expect(centre(around)[0]).toBeCloseTo(centre(diamond)[0] ?? 0, 2);
    expect(centre(around)[1]).toBeCloseTo(centre(diamond)[1] ?? 0, 2);
    around.forEach((point, at) => {
      const [x, y] = point;
      const [cx, cy] = centre(diamond);
      const [dx, dy] = diamond[at] ?? [];
      expect(Math.hypot((x ?? 0) - (cx ?? 0), (y ?? 0) - (cy ?? 0))).toBeCloseTo(Math.hypot((dx ?? 0) - (cx ?? 0), (dy ?? 0) - (cy ?? 0)) + 3 * Math.SQRT2, 1);
    });
    expect(focused("plain")?.tag).toBe("rect");
  });

  it("leaves a plain item as it was, with the default name", () => {
    const plain = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "plain");
    expect(plain?.tag).toBe("rect");
    expect(String(plain?.attrs?.["aria-label"])).toMatch(/^Plain, /);
  });

  it("routes to a milestone's diamond, not its granularity", () => {
    const options = { scale: createTimeScale([ORIGIN - 5 * DAY, ORIGIN + 20 * DAY], 1000) };
    const layout = layoutItems(items);
    const [route] = routeDependencies(layout, [{ from: "half", to: "gate" }], options);
    const gate = layout.items.find((placed) => placed.item.id === "gate");
    const box = taskBox(gate as NonNullable<typeof gate>, options);
    expect(box.mainSize).toBe(2 * milestoneHalf(gate?.crossSize ?? 0));
    expect(route?.points[route.points.length - 1]?.main).toBe(box.main);
  });
});

it("reads progress and baseline", () => {
  expect(progressOf({ id: "a", start: 0, progress: 1.4 })).toBe(1);
  expect(progressOf({ id: "a", start: 0, progress: Number.NaN })).toBeUndefined();
  expect(describeBaseline({ id: "a", start: 0, end: 3 * DAY, baseline: { start: 0, end: DAY } })).toBe("2 d behind plan");
  expect(describeBaseline({ id: "a", start: 0, end: DAY, baseline: { start: 0, end: 3 * DAY } })).toBe("2 d ahead of plan");
  expect(describeBaseline({ id: "a", start: 0, end: DAY, baseline: { start: 0, end: DAY } })).toBe("on plan");
});

it("measures a plan with only a start against the start", () => {
  // Jan 1–10, planned to start Jan 1: on plan, not nine days behind it.
  expect(describeBaseline({ id: "a", start: 0, end: 9 * DAY, baseline: { start: 0 } })).toBe("on plan");
  expect(describeBaseline({ id: "a", start: 2 * DAY, end: 9 * DAY, baseline: { start: 0 } })).toBe("2 d behind plan");
  // A milestone against a planned span: its moment against the plan's start.
  expect(describeBaseline({ id: "m", start: DAY, kind: "milestone", baseline: { start: 0, end: 4 * DAY } })).toBe("1 d behind plan");
});
