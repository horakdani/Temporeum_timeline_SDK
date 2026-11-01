import { expect, it } from "vitest";

import { crossAxisOf, mainAxisOf, projectRect } from "../../src/geometry.js";
import { itemRect, layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";
import type { Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 2, 10);
const MAIN_SIZE = 1000;

const ITEMS: readonly Item[] = [
  { id: "a", start: T0, end: T0 + 5 * DAY, laneId: "work" },
  { id: "b", start: T0 + DAY, end: T0 + 6 * DAY, laneId: "work" },
  { id: "c", start: T0 + 2 * DAY, end: T0 + 3 * DAY, laneId: "home" },
  { id: "ongoing", start: T0 + 4 * DAY, open: true, laneId: "home" },
];

describeBothOrientations("layout projection", (orientation) => {
  const scale = createTimeScale([T0, T0 + 10 * DAY], MAIN_SIZE);
  const layout = layoutItems(ITEMS);
  const main = mainAxisOf(orientation);
  const cross = crossAxisOf(orientation);
  const mainExtent = orientation === "horizontal" ? "width" : "height";
  const crossExtent = orientation === "horizontal" ? "height" : "width";

  it("sends time to the time axis and lanes to the lane axis", () => {
    const placed = layout.items.find((candidate) => candidate.item.id === "b");
    if (placed === undefined) {
      throw new Error("item b was not laid out");
    }
    const screen = projectRect(itemRect(placed, scale), orientation);
    expect(screen[main]).toBeCloseTo(100, 6);
    expect(screen[mainExtent]).toBeCloseTo(500, 6);
    // Second sublane of the first lane: one row plus the gap.
    expect(screen[cross]).toBe(26);
    expect(screen[crossExtent]).toBe(24);
  });

  it("keeps the lanes in cross order whichever way time runs", () => {
    const byLane = new Map(
      layout.items.map((placed) => [
        placed.item.id,
        projectRect(itemRect(placed, scale), orientation)[cross],
      ]),
    );
    // work occupies two sublanes (0, 26); home starts after the lane gap.
    expect(byLane.get("a")).toBe(0);
    expect(byLane.get("b")).toBe(26);
    expect(byLane.get("c")).toBe(58);
    expect(byLane.get("ongoing")).toBe(58);
  });

  it("never lets two items in the same row overlap on the time axis", () => {
    const rows = new Map<number, { from: number; to: number }[]>();
    for (const placed of layout.items) {
      const screen = projectRect(itemRect(placed, scale), orientation);
      const box = { from: screen[main], to: screen[main] + screen[mainExtent] };
      const bucket = rows.get(placed.row);
      if (bucket === undefined) {
        rows.set(placed.row, [box]);
      } else {
        for (const other of bucket) {
          expect(box.from >= other.to || box.to <= other.from).toBe(true);
        }
        bucket.push(box);
      }
    }
    expect(rows.size).toBe(layout.rowCount);
  });

  it("clips an open interval to the container, not past it", () => {
    const placed = layout.items.find((candidate) => candidate.item.id === "ongoing");
    if (placed === undefined) {
      throw new Error("the open item was not laid out");
    }
    const screen = projectRect(itemRect(placed, scale), orientation);
    expect(screen[main] + screen[mainExtent]).toBeCloseTo(MAIN_SIZE, 6);
  });
});
