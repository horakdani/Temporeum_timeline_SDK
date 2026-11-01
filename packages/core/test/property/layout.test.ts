import { afterAll, describe, expect, it } from "vitest";

import { findSublaneOverlap, layoutItems, resolveSpan } from "../../src/layout.js";
import type { Layout } from "../../src/layout.js";
import type { Item } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";

const CASES = 600;

/**
 * The invariants, over generated input.
 *
 * Unit tests check the cases I thought of; these check the ones I did not.
 * The headline property is the one the whole layout exists for — **no two
 * items that overlap in time ever share a row** — and it is checked with the
 * same exported function a host would use, not with a copy of the logic.
 */
describe("layout properties", () => {
  it("never puts two overlapping items in the same row", () => {
    forAll(
      "no overlap in a row",
      CASES,
      0x5eed,
      (random) => generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 }),
      ({ items, lanes }) => {
        const layout = layoutItems(items, lanes === undefined ? {} : { lanes });
        const clash = findSublaneOverlap(layout);
        if (clash === undefined) {
          return undefined;
        }
        return `${clash.a.item.id} and ${clash.b.item.id} share row ${String(clash.a.row)}`;
      },
    );
  });

  it("places every item exactly once", () => {
    forAll(
      "every item placed once",
      CASES,
      0xc0ffee,
      (random) => generateCase(random, { open: true, tall: true, granularity: true, lanes: 4 }),
      ({ items }) => {
        const layout = layoutItems(items);
        if (layout.items.length !== items.length) {
          return `${String(items.length)} items in, ${String(layout.items.length)} out`;
        }
        const seen = new Set(layout.items.map((placed) => placed.item.id));
        if (seen.size !== items.length) {
          return "an item was placed twice";
        }
        for (const placed of layout.items) {
          const lane = layout.lanes.find((candidate) => candidate.lane.id === placed.laneId);
          if (lane === undefined) {
            return `${placed.item.id} landed in no lane`;
          }
          if (placed.row < lane.rowOffset || placed.row >= lane.rowOffset + lane.sublaneCount) {
            return `${placed.item.id} is outside its lane's rows`;
          }
        }
        return undefined;
      },
    );
  });

  it("uses exactly as many sublanes as the busiest instant needs", () => {
    // For intervals, first fit over a start-sorted sequence is optimal: the
    // number of rows equals the largest number of items overlapping at once.
    // More rows than that would be waste the user sees as empty bands.
    forAll(
      "sublane count is minimal",
      CASES,
      0xbeef,
      (random) => generateCase(random, { granularity: true }),
      ({ items }) => {
        const layout = layoutItems(items);
        const needed = maxConcurrent(items);
        const used = layout.lanes[0]?.sublaneCount ?? 1;
        if (items.length === 0) {
          return used === 1 ? undefined : "an empty layout should still hold one row";
        }
        return used === Math.max(needed, 1)
          ? undefined
          : `${String(used)} rows used, ${String(needed)} needed`;
      },
    );
  });

  it("does not depend on the order the items arrive in", () => {
    // Lane *order* is defined by first appearance, so reversing the input
    // legitimately reorders the lanes. The claim is about the packing: with
    // the lanes named, the row an item gets must not depend on input order.
    const lanes = [{ id: "lane0" }, { id: "lane1" }, { id: "lane2" }];
    forAll(
      "order independence",
      CASES,
      0xd1ce,
      (random) =>
        generateCase(random, { open: true, granularity: true, lanes: 3, distinctStarts: true }),
      ({ items }) => {
        const forwards = rowMap(layoutItems(items, { lanes }));
        const reversed = rowMap(layoutItems([...items].reverse(), { lanes }));
        for (const item of items) {
          const before = forwards.get(item.id);
          const after = reversed.get(item.id);
          if (before !== after) {
            return `${item.id} moved from row ${String(before)} to ${String(after)}`;
          }
        }
        return undefined;
      },
    );
  });

  it("catches a layout that violates the invariant", () => {
    // The guard on the guard: if `findSublaneOverlap` could not fail, every
    // property above would be vacuous.
    const layout = layoutItems([
      { id: "a", start: 0, end: 10_000 },
      { id: "b", start: 5_000, end: 15_000 },
    ]);
    expect(findSublaneOverlap(layout)).toBeUndefined();
    const flattened: Layout = {
      ...layout,
      items: layout.items.map((placed) => ({ ...placed, row: 0, sublane: 0 })),
    };
    expect(findSublaneOverlap(flattened)).toBeDefined();
  });

  afterAll(() => {
    // The gate reads this: a property suite that silently ran zero cases is
    // the failure mode a green tick would otherwise hide.
    writePropertyReport("layout");
  });
});

function rowMap(layout: Layout): Map<string, number> {
  return new Map(layout.items.map((placed) => [placed.item.id, placed.row]));
}

/** The largest number of items overlapping at any one instant. */
function maxConcurrent(items: readonly Item[]): number {
  const edges: { at: number; delta: number }[] = [];
  for (const item of items) {
    const span = resolveSpan(item);
    edges.push({ at: span.start, delta: 1 });
    edges.push({ at: span.end, delta: -1 });
  }
  // Ends before starts at the same instant: the span is half-open, so an item
  // ending exactly where another begins is not concurrent with it.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let most = 0;
  for (const edge of edges) {
    current += edge.delta;
    most = Math.max(most, current);
  }
  return most;
}
