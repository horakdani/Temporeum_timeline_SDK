/**
 * G-TASK-GRID: the task grid's rows line up with the lanes, and only the
 * rows in view are made.
 *
 * Three claims:
 *
 *  - after any scroll across, every grid row starts and ends where the
 *    rendered frame draws its lane (`rows-aligned`);
 *  - the same after a group is collapsed: the rows are the lanes the frame
 *    still has, on their lines (`aligned-after-collapse`);
 *  - with 10 000 lanes the window holds the rows in view plus the overscan
 *    and nothing else, at every scroll (`virtualized`).
 */

import { describe, expect, it } from "vitest";

import { gridKeyStep, resolveGridKey, revealOffset, taskGridRows } from "../../src/gantt/index.js";
import { densityMetrics } from "../../src/density.js";
import { groupView } from "../../src/groups/index.js";
import type { Group } from "../../src/groups/index.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item, Lane, Orientation } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);
const SEED = Number(process.env.SDK_TASK_GRID_SEED ?? 2022);

/** The drawn lanes' far edges and, where not clipped under the axis, their near ones. */
function laneBoxes(scene: SceneElement, orientation: Orientation): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  const walk = (node: SceneElement): void => {
    const id = node.attrs?.["data-tl-lane"];
    if (node.tag === "rect" && typeof id === "string") {
      const from = Number(orientation === "horizontal" ? node.attrs?.y : node.attrs?.x);
      const size = Number(orientation === "horizontal" ? node.attrs?.height : node.attrs?.width);
      out.set(id, { from, to: from + size });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(scene);
  return out;
}

function project(random: () => number, laneCount: number): { items: Item[]; lanes: Lane[] } {
  const lanes: Lane[] = Array.from({ length: laneCount }, (_, at) => ({ id: `l${String(at)}`, label: `Lane ${String(at)}` }));
  const items: Item[] = [];
  for (let at = 0; at < laneCount * 2; at += 1) {
    const start = ORIGIN + Math.floor(random() * 30) * DAY;
    items.push({ id: `t${String(at)}`, start, end: start + (1 + Math.floor(random() * 8)) * DAY, laneId: (lanes[Math.floor(random() * laneCount)] as Lane).id });
  }
  return { items, lanes };
}

function expectAligned(
  items: readonly Item[],
  lanes: readonly Lane[],
  orientation: Orientation,
  crossOffset: number,
): number {
  const width = orientation === "horizontal" ? 1000 : 500;
  const height = orientation === "horizontal" ? 500 : 1000;
  const crossSize = orientation === "horizontal" ? height : width;
  const metrics = densityMetrics("comfortable", orientation);
  const frame = renderTimeline({ items, lanes, domain: [ORIGIN, ORIGIN + 40 * DAY], width, height, orientation, crossOffset });
  const drawn = laneBoxes(frame.scene, orientation);
  const window = taskGridRows(frame.layout, { crossInset: metrics.axisSize, crossOffset, crossSize, overscan: 0 });
  let compared = 0;
  for (const row of window.rows) {
    const lane = drawn.get(row.lane.lane.id);
    if (lane === undefined) continue;
    expect(row.cross + row.crossSize).toBeCloseTo(lane.to, 6);
    if (row.cross >= metrics.axisSize) expect(row.cross).toBeCloseTo(lane.from, 6);
    compared += 1;
  }
  // Every lane the frame draws in view has its row (the frame also draws a
  // row's worth past the far edge, which the grid leaves to its overscan).
  for (const [id, lane] of drawn) {
    if (lane.from < crossSize) expect(window.rows.some((row) => row.lane.lane.id === id)).toBe(true);
  }
  return compared;
}

describeBothOrientations("task grid", (orientation) => {
  it("[claim:rows-aligned] every row is on its lane's line, at every scroll", () => {
    const random = makeRandom(SEED);
    let compared = 0;
    // 80 projects: a vertical row is six times a horizontal one, so fewer
    // lanes are in each frame to compare.
    for (let at = 0; at < 80; at += 1) {
      const { items, lanes } = project(random, 1 + Math.floor(random() * 60));
      const frame = layoutItems(items, { lanes });
      for (const offset of [0, 7, 33.5, frame.crossSize / 3, frame.crossSize / 2]) {
        compared += expectAligned(items, lanes, orientation, offset);
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it("[claim:aligned-after-collapse] after a group is collapsed the rows are the lanes left, on their lines", () => {
    const random = makeRandom(SEED + 1);
    let compared = 0;
    for (let at = 0; at < 30; at += 1) {
      const groups: Group[] = Array.from({ length: 6 }, (_, index) => ({
        id: `g${String(index)}`,
        label: `Group ${String(index)}`,
        ...(index > 1 && random() < 0.5 ? { parentId: `g${String(Math.floor(random() * index))}` } : {}),
      }));
      const items: Item[] = Array.from({ length: 30 }, (_, index) => {
        const start = ORIGIN + Math.floor(random() * 30) * DAY;
        return { id: `t${String(index)}`, start, end: start + 2 * DAY, laneId: `g${String(Math.floor(random() * 6))}` };
      });
      const collapsed = [`g${String(Math.floor(random() * 6))}`];
      const view = groupView(groups, items, { collapsed });
      compared += expectAligned(view.items, view.lanes, orientation, 0);
      compared += expectAligned(view.items, view.lanes, orientation, 20);
      const shown = new Set(view.lanes.map((lane) => lane.id));
      const window = taskGridRows(layoutItems(view.items, { lanes: view.lanes }), { crossInset: 0, crossOffset: 0, crossSize: 1e9 });
      for (const row of window.rows) expect(shown.has(row.lane.lane.id)).toBe(true);
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("[claim:virtualized] 10 000 rows: the window is the rows in view plus the overscan", () => {
    const lanes: Lane[] = Array.from({ length: 10_000 }, (_, at) => ({ id: `l${String(at)}` }));
    const items: Item[] = lanes.map((lane, at) => ({ id: `t${String(at)}`, start: ORIGIN + (at % 30) * DAY, end: ORIGIN + ((at % 30) + 3) * DAY, laneId: lane.id }));
    const layout = layoutItems(items, { lanes });
    const crossSize = 600;
    const inset = 30;
    const overscan = 4;
    for (const offset of [0, 1, 999.5, layout.crossSize / 2, layout.crossSize - crossSize + inset]) {
      const window = taskGridRows(layout, { crossInset: inset, crossOffset: offset, crossSize, overscan });
      expect(window.total).toBe(10_000);
      const inView = layout.lanes.filter((lane) => lane.cross + lane.crossSize > offset && lane.cross < offset + crossSize - inset);
      expect(window.rows.length).toBeLessThanOrEqual(inView.length + 2 * overscan);
      expect(window.rows.length).toBeLessThan(100);
      for (const lane of inView) expect(window.rows.some((row) => row.lane === lane)).toBe(true);
      // Rows are numbered among all of them, the header row being the first.
      for (const row of window.rows) expect(row.index).toBe(layout.lanes.indexOf(row.lane) + 2);
    }
  });
});

describe("task grid keys", () => {
  const sample = { key: "ArrowDown", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0 };

  it("walks the rows along the cross axis, in both orientations", () => {
    expect(resolveGridKey(sample, "horizontal")).toBe("next");
    expect(resolveGridKey({ ...sample, key: "ArrowRight" }, "vertical")).toBe("next");
    expect(resolveGridKey({ ...sample, key: "ArrowLeft" }, "vertical")).toBe("previous");
    expect(resolveGridKey({ ...sample, key: "Enter" }, "horizontal")).toBe("open");
    expect(resolveGridKey({ ...sample, altKey: true }, "horizontal")).toBeUndefined();
  });

  it("steps, pages and stops at the ends", () => {
    expect(gridKeyStep(100, 0, "next")).toBe(1);
    expect(gridKeyStep(100, 0, "previous")).toBeUndefined();
    expect(gridKeyStep(100, 5, "pageDown", 10)).toBe(15);
    expect(gridKeyStep(100, 95, "pageDown", 10)).toBe(99);
    expect(gridKeyStep(100, 50, "first")).toBe(0);
    expect(gridKeyStep(100, 50, "last")).toBe(99);
    expect(gridKeyStep(100, 50, "open")).toBeUndefined();
    expect(gridKeyStep(0, 0, "next")).toBeUndefined();
  });

  it("scrolls a lane into view only when it is out of it", () => {
    expect(revealOffset({ cross: 100, crossSize: 20 }, 0, 300, 30)).toBe(0);
    expect(revealOffset({ cross: 400, crossSize: 20 }, 0, 300, 30)).toBe(150);
    expect(revealOffset({ cross: 10, crossSize: 20 }, 50, 300, 30)).toBe(10);
  });
});
