/**
 * The live-data check: on generated sequences of updates, the incremental update
 * gives the same frame as a full reload.
 *
 * Each case starts from a generated timeline and applies a sequence of
 * batches — adds, field changes (a move in time, to another lane, a span),
 * removals — keeping the layout up to date with `relayout` alone. After
 * every batch the layout is compared to `layoutItems` of the same items, and
 * the frame drawn from it to the frame a full reload draws, node for node.
 */

import { describe, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { layoutItems } from "../../src/layout.js";
import type { Layout, LayoutOptions } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import { applyItemChanges, relayout } from "../../src/shared/live-data.js";
import type { ItemChanges } from "../../src/shared/live-data.js";
import type { Item, Lane, PackMode } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 2, 2);
const SEED = 0x11ce;
const CASES = 40;
const BATCHES = 12;
// The renderer's own rows for the frame below: comfortable, horizontal.
const FRAME_METRICS = (() => {
  const metrics = densityMetrics("comfortable", "horizontal");
  return { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap };
})();

function itemOf(random: () => number, id: string, lanes: readonly string[]): Item {
  const start = T0 + Math.floor(random() * 30) * DAY + Math.floor(random() * 24) * HOUR;
  const kind = random();
  return {
    id,
    start,
    // Some instants, some open-ended, most ranges.
    ...(kind < 0.1 ? {} : kind < 0.15 ? {} : { end: start + (1 + Math.floor(random() * 96)) * HOUR }),
    ...(random() < 0.9 ? { laneId: lanes[Math.floor(random() * lanes.length)] as string } : {}),
    ...(random() < 0.1 ? { sublaneSpan: 2 } : {}),
    label: `Item ${id}`,
  };
}

function batchOf(random: () => number, items: readonly Item[], lanes: readonly string[], next: () => string): ItemChanges {
  const add: Item[] = [];
  const update: { id: string; start?: number; end?: number; laneId?: string }[] = [];
  const remove: string[] = [];
  const count = 1 + Math.floor(random() * 4);
  for (let k = 0; k < count; k += 1) {
    const roll = random();
    const victim = items[Math.floor(random() * items.length)];
    if (roll < 0.35 || victim === undefined) add.push(itemOf(random, next(), lanes));
    else if (roll < 0.7 && !update.some((each) => each.id === victim.id)) {
      const start = T0 + Math.floor(random() * 30) * DAY;
      update.push(random() < 0.5 ? { id: victim.id, start, end: start + 5 * HOUR } : { id: victim.id, laneId: lanes[Math.floor(random() * lanes.length)] as string });
    } else if (!update.some((each) => each.id === victim.id)) remove.push(victim.id);
  }
  return { add, update, remove };
}

const frameOf = (items: readonly Item[], lanes: readonly Lane[] | undefined, layout?: Layout): string =>
  renderToSvgString(
    renderTimeline({
      items,
      ...(lanes === undefined ? {} : { lanes }),
      ...(layout === undefined ? {} : { layout }),
      domain: [T0, T0 + 32 * DAY],
      width: 1200,
      height: 600,
    }).scene,
  );

describe("live data", () => {
  it("[claim:incremental-equals-full] keeps, batch after batch, the layout and the frame a full reload gives", () => {
    const random = makeRandom(SEED);
    let batches = 0;
    let repacked = 0;
    for (let index = 0; index < CASES; index += 1) {
      const laneIds = ["a", "b", "c", "d", "e"].slice(0, 2 + Math.floor(random() * 4));
      // Declared lanes in half the cases, derived from the items in the rest.
      const declared = random() < 0.5 ? laneIds.map((id) => ({ id, label: id.toUpperCase(), ...(random() < 0.2 ? { packMode: "single" as PackMode } : {}) })) : undefined;
      const options: LayoutOptions = {
        ...(declared === undefined ? {} : { lanes: declared }),
        metrics: FRAME_METRICS,
      };
      let serial = 0;
      const next = (): string => `n${String(index)}-${String((serial += 1))}`;
      let items: readonly Item[] = Array.from({ length: 10 + Math.floor(random() * 40) }, () => itemOf(random, next(), laneIds));
      let layout = layoutItems(items, options);
      for (let b = 0; b < BATCHES; b += 1) {
        const applied = applyItemChanges(items, batchOf(random, items, laneIds, next));
        layout = relayout(layout, applied.items, applied.lanes, options);
        items = applied.items;
        const full = layoutItems(items, options);
        expect(layout, `case ${String(index)}, batch ${String(b)}`).toEqual(full);
        expect(frameOf(items, declared, layout)).toBe(frameOf(items, declared));
        if (applied.lanes.size < (declared?.length ?? laneIds.length)) repacked += 1;
        batches += 1;
      }
    }
    expect(batches).toBe(CASES * BATCHES);
    // Most batches touch only some lanes: the incremental path is the one tested.
    expect(repacked).toBeGreaterThan(batches / 3);
  });

  it("[claim:incremental-equals-full] keeps what it does not touch: the same placements, moved across only", () => {
    const lanes: Lane[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const items: Item[] = [
      { id: "1", start: T0, end: T0 + DAY, laneId: "a" },
      { id: "2", start: T0, end: T0 + DAY, laneId: "b" },
      { id: "3", start: T0, end: T0 + DAY, laneId: "c" },
    ];
    const before = layoutItems(items, { lanes });
    // A second row in lane a: lanes b and c slide down, their items are the same objects moved.
    const applied = applyItemChanges(items, { add: [{ id: "4", start: T0, end: T0 + DAY, laneId: "a" }] });
    expect([...applied.lanes]).toEqual(["a"]);
    const after = relayout(before, applied.items, applied.lanes, { lanes });
    expect(after).toEqual(layoutItems(applied.items, { lanes }));
    const moved = after.items.find((placed) => placed.item.id === "3");
    expect(moved?.item).toBe(items[2]);
    expect(moved?.cross).toBeGreaterThan(before.items.find((placed) => placed.item.id === "3")?.cross ?? Infinity);
    // Nothing touched before it: lane a's own lane object is a new one, c's unchanged layout lane is kept when nothing moved.
    const none = relayout(after, applied.items, new Set(), { lanes });
    expect(none.lanes[2]).toBe(after.lanes[2]);
  });

  it("lays out from scratch when the lanes themselves change, and for an item in an undeclared lane", () => {
    const items: Item[] = [{ id: "1", start: T0, end: T0 + DAY, laneId: "x" }];
    const before = layoutItems(items);
    // A new derived lane.
    const applied = applyItemChanges(items, { add: [{ id: "2", start: T0, end: T0 + DAY, laneId: "y" }] });
    expect(relayout(before, applied.items, applied.lanes)).toEqual(layoutItems(applied.items));
    // Declared lanes, an item naming none of them: it lands in the default lane.
    const lanes: Lane[] = [{ id: "" }, { id: "a" }];
    const start = layoutItems([{ id: "1", start: T0, laneId: "a" }], { lanes });
    const stray = applyItemChanges([{ id: "1", start: T0, laneId: "a" }], { add: [{ id: "s", start: T0, laneId: "nowhere" }] });
    expect(relayout(start, stray.items, stray.lanes, { lanes })).toEqual(layoutItems(stray.items, { lanes }));
    // Duplicate lane ids are the full layout's error.
    expect(() => relayout(start, stray.items, stray.lanes, { lanes: [{ id: "a" }, { id: "a" }] })).toThrow(/Duplicate lane id/);
  });

  it("applies a batch in order — adds, updates, removals — and refuses a forked or a missing item", () => {
    const items: Item[] = [
      { id: "a", start: T0, end: T0 + DAY, laneId: "l", label: "A" },
      { id: "b", start: T0, laneId: "m" },
    ];
    const applied = applyItemChanges(items, {
      add: [{ id: "c", start: T0 + DAY }],
      update: [{ id: "a", label: undefined, laneId: "m" }],
      remove: ["b", "b", "missing"],
    });
    expect(applied.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(applied.items[0]).toEqual({ id: "a", start: T0, end: T0 + DAY, laneId: "m" });
    expect(applied.removed.map((item) => item.id)).toEqual(["b"]);
    expect([...applied.lanes].sort()).toEqual(["", "l", "m"]);
    expect(items[0]?.label).toBe("A");
    expect(() => applyItemChanges(items, { add: [{ id: "a", start: T0 }] })).toThrow(/already there/);
    expect(() => applyItemChanges(items, { update: [{ id: "zz", start: T0 }] })).toThrow(/no item with that id/);
    expect(applyItemChanges(items, {}).items).toEqual(items);
  });
});
