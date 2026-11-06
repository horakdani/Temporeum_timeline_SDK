import { describe, expect, it } from "vitest";

import { budgetMs } from "./time-budget.js";

import {
  DEFAULT_LANE_ID,
  findSublaneOverlap,
  itemRect,
  layoutItems,
  resolveSpan,
} from "../src/layout.js";
import { fitDensity } from "../src/responsive.js";
import { createTimeScale } from "../src/scale.js";
import type { Item, Lane } from "../src/types.js";
import { makeRandom } from "./property/harness.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 2, 10);

/** An item from a start day offset and a length in days. */
function days(id: string, startDay: number, lengthDays: number, extra: Partial<Item> = {}): Item {
  return { id, start: T0 + startDay * DAY, end: T0 + (startDay + lengthDays) * DAY, ...extra };
}

function rowsById(items: readonly { item: Item; row: number }[]): Record<string, number> {
  return Object.fromEntries(items.map((placed) => [placed.item.id, placed.row]));
}

describe("packing into sublanes", () => {
  it("puts non-overlapping items in the same sublane", () => {
    const layout = layoutItems([days("a", 0, 2), days("b", 3, 2), days("c", 6, 2)]);
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 0, c: 0 });
    expect(layout.rowCount).toBe(1);
  });

  it("treats touching items as not overlapping", () => {
    // [10, 12) and [12, 14): the span is half-open, so they share a sublane.
    const layout = layoutItems([days("a", 0, 2), days("b", 2, 2)]);
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 0 });
  });

  it("stacks overlapping items", () => {
    const layout = layoutItems([days("a", 0, 5), days("b", 1, 5), days("c", 2, 5)]);
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 1, c: 2 });
    expect(layout.rowCount).toBe(3);
  });

  it("fills an earlier gap rather than opening a new sublane", () => {
    // `short` fits after `a` in sublane 0; first fit is what finds it.
    const layout = layoutItems([days("a", 0, 2), days("long", 1, 10), days("short", 3, 1)]);
    expect(rowsById(layout.items)).toEqual({ a: 0, long: 1, short: 0 });
    expect(layout.rowCount).toBe(2);
  });

  it("does not depend on the order the host passes items in", () => {
    const items = [days("a", 0, 5), days("b", 1, 5), days("c", 2, 5)];
    const forwards = rowsById(layoutItems(items).items);
    const backwards = rowsById(layoutItems([...items].reverse()).items);
    expect(backwards).toEqual(forwards);
  });

  it("breaks a start-time tie by input order", () => {
    const layout = layoutItems([days("second", 0, 2), days("first", 0, 2)]);
    expect(rowsById(layout.items)).toEqual({ second: 0, first: 1 });
  });
});

describe("packing cost", () => {
  /** First fit the slow, obvious way: every placed span of every sublane. */
  function naiveRows(items: readonly Item[]): Record<string, number> {
    const occupied: { start: number; end: number }[][] = [];
    const rows: Record<string, number> = {};
    const sorted = items
      .map((item, index) => ({ item, index, span: resolveSpan(item) }))
      .sort((a, b) => a.span.start - b.span.start || a.index - b.index);
    for (const { item, span } of sorted) {
      const height = item.sublaneSpan ?? 1;
      const busy = (row: number) => (occupied[row] ?? []).some((o) => o.start < span.end && span.start < o.end);
      let base = 0;
      while (Array.from({ length: height }, (_, k) => busy(base + k)).some(Boolean)) base += 1;
      for (let k = 0; k < height; k += 1) (occupied[base + k] ??= []).push(span);
      rows[item.id] = base;
    }
    return rows;
  }

  it("places every item where a first fit over all placed spans would", () => {
    const random = makeRandom(0x4a11);
    for (let round = 0; round < 200; round += 1) {
      const items: Item[] = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, n) => {
        const start = T0 + Math.floor(random() * 30) * DAY;
        const kind = random();
        return {
          id: `i${String(n)}`,
          start,
          ...(kind < 0.3 ? {} : { end: start + Math.floor(random() * 6) * DAY }),
          ...(kind > 0.8 ? { sublaneSpan: 1 + Math.floor(random() * 3) } : {}),
          ...(kind > 0.9 ? { granularity: "day" as const } : {}),
        };
      });
      expect(rowsById(layoutItems(items).items)).toEqual(naiveRows(items));
    }
  });

  it("costs the sublanes it looks at, not the items already placed", () => {
    // R4: every placement scanned every span already in a sublane, so one lane
    // of back-to-back items was quadratic (30k items: 384 ms), and the density
    // fit ran the layout three times. 200k items took 126 s.
    const items: Item[] = Array.from({ length: 200_000 }, (_, n) => days(`i${String(n)}`, n, 1));
    const started = performance.now();
    const layout = layoutItems(items);
    fitDensity({ items, domain: [T0, T0 + 200_000 * DAY], width: 1000, height: 400, orientation: "horizontal" });
    expect(layout.rowCount).toBe(1);
    expect(performance.now() - started).toBeLessThan(budgetMs(3000));
  });
});

describe("lanes", () => {
  it("derives lanes from the items in order of first appearance", () => {
    const layout = layoutItems([
      days("a", 0, 2, { laneId: "work" }),
      days("b", 0, 2, { laneId: "home" }),
      days("c", 1, 2, { laneId: "work" }),
    ]);
    expect(layout.lanes.map((lane) => lane.lane.id)).toEqual(["work", "home"]);
    // Lanes are row blocks: `home` starts below everything `work` needed.
    expect(rowsById(layout.items)).toEqual({ a: 0, c: 1, b: 2 });
    expect(layout.rowCount).toBe(3);
  });

  it("keeps the caller's lane order and moves pinned lanes to the front", () => {
    const lanes: Lane[] = [{ id: "a" }, { id: "b", pinned: true }, { id: "c" }];
    const layout = layoutItems(
      [days("x", 0, 1, { laneId: "a" }), days("y", 0, 1, { laneId: "b" })],
      { lanes },
    );
    expect(layout.lanes.map((lane) => lane.lane.id)).toEqual(["b", "a", "c"]);
    expect(layout.lanes.map((lane) => lane.pinned)).toEqual([true, false, false]);
    expect(rowsById(layout.items)).toEqual({ y: 0, x: 1 });
  });

  it("gives an empty lane one sublane so it keeps its place", () => {
    const layout = layoutItems([days("x", 0, 1, { laneId: "b" })], {
      lanes: [{ id: "a" }, { id: "b" }],
    });
    expect(layout.lanes.map((lane) => lane.sublaneCount)).toEqual([1, 1]);
    expect(layout.rowCount).toBe(2);
    expect(layout.items[0]?.row).toBe(1);
  });

  it("puts an item naming an undeclared lane in the default lane", () => {
    const layout = layoutItems([days("x", 0, 1, { laneId: "ghost" })], {
      lanes: [{ id: DEFAULT_LANE_ID }],
    });
    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]?.laneId).toBe(DEFAULT_LANE_ID);
  });

  it("rejects two items with one id (R8)", () => {
    expect(() => layoutItems([days("a", 0, 1), days("b", 1, 2), days("a", 3, 4)])).toThrow(/Duplicate item id/);
  });

  it("rejects two lanes with one id", () => {
    expect(() => layoutItems([], { lanes: [{ id: "a" }, { id: "a" }] })).toThrow(/Duplicate lane id/);
  });
});

describe("pack modes", () => {
  const overlapping = [days("a", 0, 5), days("b", 1, 5), days("c", 2, 5)];

  it("packs by default", () => {
    expect(layoutItems(overlapping).rowCount).toBe(3);
  });

  it("puts everything in one sublane in overlap mode", () => {
    const layout = layoutItems(overlapping, { packMode: "overlap" });
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 0, c: 0 });
    expect(layout.rowCount).toBe(1);
    // Overlap mode is the host saying it wants the collisions drawn.
    expect(findSublaneOverlap(layout)).toBeDefined();
  });

  it("gives every item its own sublane in single mode", () => {
    const layout = layoutItems([days("a", 0, 1), days("b", 5, 1)], { packMode: "single" });
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 1 });
    expect(layout.rowCount).toBe(2);
  });

  it("lets a lane override the layout-wide mode", () => {
    const layout = layoutItems(
      [
        days("a", 0, 5, { laneId: "packed" }),
        days("b", 1, 5, { laneId: "packed" }),
        days("c", 0, 5, { laneId: "flat" }),
        days("d", 1, 5, { laneId: "flat" }),
      ],
      { lanes: [{ id: "packed" }, { id: "flat", packMode: "overlap" }], packMode: "pack" },
    );
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 1, c: 2, d: 2 });
  });
});

describe("per-item height", () => {
  it("reserves consecutive sublanes for a taller item", () => {
    const layout = layoutItems([days("tall", 0, 5, { sublaneSpan: 2 }), days("next", 1, 5)]);
    expect(rowsById(layout.items)).toEqual({ tall: 0, next: 2 });
    expect(layout.rowCount).toBe(3);
    expect(layout.items[0]?.crossSize).toBe(2 * 24 + 2);
  });

  it("will not squeeze a tall item into a one-sublane gap", () => {
    // Sublane 0 is free after day 2 and sublane 1 is busy throughout, so the
    // tall item has to go below both rather than into the gap.
    const layout = layoutItems([
      days("a", 0, 2),
      days("blocker", 0, 20),
      days("tall", 3, 2, { sublaneSpan: 2 }),
    ]);
    const rows = rowsById(layout.items);
    expect(rows["a"]).toBe(0);
    expect(rows["blocker"]).toBe(1);
    expect(rows["tall"]).toBe(2);
  });

  it("rejects a height that is not a positive whole number", () => {
    expect(() => layoutItems([days("a", 0, 1, { sublaneSpan: 0 })])).toThrow(/positive integer/);
    expect(() => layoutItems([days("a", 0, 1, { sublaneSpan: 1.5 })])).toThrow(/positive integer/);
    // R27: a span past the cap is refused before the packing loops and allocates for every row of it.
    expect(() => layoutItems([days("a", 0, 1, { sublaneSpan: 200_000_000 })])).toThrow(/at most 1000/);
    expect(layoutItems([days("a", 0, 1, { sublaneSpan: 1000 })]).items[0]?.sublaneSpan).toBe(1000);
  });
});

describe("resolveSpan", () => {
  it("gives an instant one millisecond, so two at the same time collide", () => {
    const span = resolveSpan({ id: "a", start: 1000 });
    expect(span).toEqual({ start: 1000, end: 1001, open: false });
    const layout = layoutItems([
      { id: "a", start: 1000 },
      { id: "b", start: 1000 },
      { id: "c", start: 1001 },
    ]);
    expect(rowsById(layout.items)).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("gives a day-granularity item the whole day", () => {
    const span = resolveSpan({ id: "a", start: Date.UTC(2025, 2, 15, 10, 30), granularity: "day" });
    expect(new Date(span.start).toISOString()).toBe("2025-03-15T00:00:00.000Z");
    expect(new Date(span.end).toISOString()).toBe("2025-03-16T00:00:00.000Z");
  });

  it("collides two events that share a day when the day is what is known", () => {
    const morning = { id: "m", start: Date.UTC(2025, 2, 15, 9), granularity: "day" } as const;
    const evening = { id: "e", start: Date.UTC(2025, 2, 15, 20), granularity: "day" } as const;
    expect(rowsById(layoutItems([morning, evening]).items)).toEqual({ m: 0, e: 1 });
    // Without the granularity they are two instants hours apart, so they share.
    expect(
      rowsById(layoutItems([{ id: "m", start: morning.start }, { id: "e", start: evening.start }]).items),
    ).toEqual({ m: 0, e: 0 });
  });

  it("runs a known interval to the end of its last unit", () => {
    const span = resolveSpan({
      id: "a",
      start: Date.UTC(2025, 2, 15, 10),
      end: Date.UTC(2025, 2, 20, 8),
      granularity: "day",
    });
    expect(new Date(span.end).toISOString()).toBe("2025-03-21T00:00:00.000Z");
  });

  it("uses the year as the unit at the coarse end", () => {
    const span = resolveSpan({ id: "a", start: Date.UTC(1969, 6, 20), granularity: "year" });
    expect(new Date(span.start).toISOString()).toBe("1969-01-01T00:00:00.000Z");
    expect(new Date(span.end).toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("resolves the unit in the host's zone", () => {
    // 2025-03-15T20:00Z is already the 16th in Kolkata (+05:30).
    const span = resolveSpan(
      { id: "a", start: Date.UTC(2025, 2, 15, 20), granularity: "day" },
      "Asia/Kolkata",
    );
    expect(new Date(span.start).toISOString()).toBe("2025-03-15T18:30:00.000Z");
  });

  it("survives an end before the start instead of hiding it", () => {
    const span = resolveSpan({ id: "a", start: 5000, end: 1000 });
    expect(span.start).toBe(5000);
    expect(span.end).toBeGreaterThan(span.start);
  });

  it("makes an open interval unbounded", () => {
    expect(resolveSpan({ id: "a", start: 1000, open: true })).toEqual({
      start: 1000,
      end: Number.POSITIVE_INFINITY,
      open: true,
    });
    expect(resolveSpan({ id: "a", start: 1000, end: 2000, open: true }).end).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("snaps an open interval's start to its unit too", () => {
    const span = resolveSpan(
      { id: "a", start: Date.UTC(2025, 2, 15, 10), granularity: "day", open: true },
      "UTC",
    );
    expect(new Date(span.start).toISOString()).toBe("2025-03-15T00:00:00.000Z");
    expect(span.end).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps everything after an open interval out of its sublane", () => {
    const layout = layoutItems([
      { id: "ongoing", start: T0, open: true },
      days("later", 100, 2),
      days("before", -10, 2),
    ]);
    expect(rowsById(layout.items)).toEqual({ before: 0, ongoing: 0, later: 1 });
  });
});

describe("cross positions and rects", () => {
  it("stacks sublanes and lanes with the given metrics", () => {
    const layout = layoutItems(
      [days("a", 0, 5, { laneId: "one" }), days("b", 1, 5, { laneId: "one" }), days("c", 0, 5, { laneId: "two" })],
      { metrics: { rowSize: 30, rowGap: 4, laneGap: 10 } },
    );
    expect(layout.items.map((placed) => [placed.item.id, placed.cross])).toEqual([
      ["a", 0],
      ["b", 34],
      ["c", 74],
    ]);
    // Two lanes: 2 sublanes + gap, then 10 of lane gap, then one sublane.
    expect(layout.crossSize).toBe(64 + 10 + 30);
  });

  it("honours a lane's minimum cross size", () => {
    const layout = layoutItems([days("a", 0, 1, { laneId: "big" })], {
      lanes: [{ id: "big", minCrossSize: 100 }, { id: "small" }],
    });
    expect(layout.lanes[0]?.crossSize).toBe(100);
    expect(layout.lanes[1]?.cross).toBe(108);
  });

  it("rejects a row size it cannot lay out with", () => {
    expect(() => layoutItems([], { metrics: { rowSize: 0 } })).toThrow(/positive number of pixels/);
  });

  it("turns a placed item into a box in (main, cross) space", () => {
    const domain = [T0, T0 + 10 * DAY] as const;
    const scale = createTimeScale(domain, 1000);
    const layout = layoutItems([days("a", 2, 3)]);
    const placed = layout.items[0];
    expect(placed).toBeDefined();
    if (placed === undefined) {
      return;
    }
    const rect = itemRect(placed, scale);
    expect(rect.main).toBeCloseTo(200, 6);
    expect(rect.mainSize).toBeCloseTo(300, 6);
    expect(rect.cross).toBe(0);
    expect(rect.crossSize).toBe(24);
  });

  it("clips an open interval to the domain instead of drawing an infinite box", () => {
    const domain = [T0, T0 + 10 * DAY] as const;
    const scale = createTimeScale(domain, 1000);
    const layout = layoutItems([{ id: "a", start: T0 + 2 * DAY, open: true }]);
    const placed = layout.items[0];
    if (placed === undefined) {
      throw new Error("no item");
    }
    const rect = itemRect(placed, scale);
    expect(rect.mainSize).toBeCloseTo(800, 6);
    expect(Number.isFinite(rect.mainSize)).toBe(true);
    expect(placed.span.open).toBe(true);
  });

  it("never produces a negative width", () => {
    const scale = createTimeScale([T0 + 50 * DAY, T0 + 60 * DAY], 1000);
    const layout = layoutItems([{ id: "a", start: T0, open: true }]);
    const placed = layout.items[0];
    if (placed === undefined) {
      throw new Error("no item");
    }
    expect(itemRect(placed, scale).mainSize).toBeGreaterThanOrEqual(0);
  });
});

describe("findSublaneOverlap", () => {
  it("finds nothing in a packed layout", () => {
    const layout = layoutItems([days("a", 0, 5), days("b", 1, 5), days("c", 2, 5), days("d", 20, 1)]);
    expect(findSublaneOverlap(layout)).toBeUndefined();
  });

  it("finds the pair in a layout that was built wrong", () => {
    // The invariant checker is only worth having if it rejects a bad layout,
    // so here is one by hand.
    const broken = layoutItems([days("a", 0, 5), days("b", 1, 5)]);
    const sabotaged = {
      ...broken,
      items: broken.items.map((placed) => ({ ...placed, row: 0, sublane: 0 })),
    };
    const found = findSublaneOverlap(sabotaged);
    expect(found).toBeDefined();
    expect([found?.a.item.id, found?.b.item.id].sort()).toEqual(["a", "b"]);
  });

  it("notices an overlap through a tall item's second sublane", () => {
    const base = layoutItems([days("tall", 0, 5, { sublaneSpan: 2 }), days("other", 1, 5)]);
    const sabotaged = {
      ...base,
      items: base.items.map((placed) =>
        placed.item.id === "other" ? { ...placed, row: 1, sublane: 1 } : placed,
      ),
    };
    expect(findSublaneOverlap(sabotaged)).toBeDefined();
  });
});
