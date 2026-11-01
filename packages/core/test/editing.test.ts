import { describe, expect, it } from "vitest";

import {
  applyPatches,
  createCommand,
  createHitTester,
  editCommand,
  invertPatch,
  modeForPart,
  movePatch,
  resizePatch,
  snapTime,
} from "../src/editing.js";
import type { EditHit } from "../src/editing.js";
import { layoutItems } from "../src/layout.js";
import { createTimeScale } from "../src/scale.js";
import type { Item, ItemPatch } from "../src/types.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function hitOf(item: Item, part: EditHit["part"] = "body"): EditHit {
  const layout = layoutItems([item]);
  const placed = layout.items[0];
  if (placed === undefined) {
    throw new Error("the item was not laid out");
  }
  return { item, span: placed.span, laneId: placed.laneId, part };
}

describe("snapTime", () => {
  it("leaves the time alone without a usable grid", () => {
    expect(snapTime(1234, undefined)).toBe(1234);
    expect(snapTime(1234, 0)).toBe(1234);
    expect(snapTime(1234, -DAY)).toBe(1234);
    expect(snapTime(1234, Number.POSITIVE_INFINITY)).toBe(1234);
  });

  it("rounds to the nearest grid point, not down", () => {
    expect(snapTime(START + DAY * 0.6, DAY)).toBe(START + DAY);
    expect(snapTime(START + DAY * 0.4, DAY)).toBe(START);
  });

  it("takes the phase of the grid from the origin", () => {
    const noon = START + DAY / 2;
    expect(snapTime(noon + 1000, DAY, noon)).toBe(noon);
    expect(snapTime(noon + DAY * 0.7, DAY, noon)).toBe(noon + DAY);
  });
});

describe("modeForPart", () => {
  it("maps every part to the edit it starts", () => {
    expect(modeForPart("body")).toBe("move");
    expect(modeForPart("start")).toBe("resize-start");
    expect(modeForPart("end")).toBe("resize-end");
  });
});

describe("createCommand", () => {
  const before: ItemPatch[] = [{ id: "a", start: START }];
  const after: ItemPatch[] = [{ id: "a", start: START + DAY }];

  it("swaps before and after in the inverse", () => {
    const command = createCommand("move", before, after, "Move");
    expect(command.inverse.before).toEqual(after);
    expect(command.inverse.after).toEqual(before);
    expect(command.inverse.type).toBe("move");
    expect(command.inverse.label).toBe("Move");
  });

  it("returns the SAME object for the inverse of the inverse", () => {
    const command = createCommand("move", before, after);
    expect(command.inverse.inverse).toBe(command);
    // Memoised: a second read is the same object, so a host can use it as a key.
    expect(command.inverse).toBe(command.inverse);
  });

  it("serialises to plain JSON instead of recursing forever", () => {
    const command = createCommand("move", before, after, "Move");
    const json = JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["after", "before", "label", "type"]);
    expect(json.inverse).toBeUndefined();
  });

  it("omits the label when there is none", () => {
    const command = createCommand("move", before, after);
    expect("label" in command).toBe(false);
  });

  it("refuses a before/after pair of different lengths", () => {
    expect(() => createCommand("move", before, [...after, { id: "b", start: 1 }])).toThrow(
      RangeError,
    );
  });

  it("refuses patches that describe different items", () => {
    expect(() => createCommand("move", before, [{ id: "b", start: 1 }])).toThrow(/"a" before/);
  });

  it("refuses an inverse that would restore a different field", () => {
    expect(() => createCommand("move", [{ id: "a", end: 1 }], after)).toThrow(/restores/);
  });
});

describe("movePatch", () => {
  const interval: Item = { id: "a", start: START + DAY, end: START + 3 * DAY };

  it("shifts both edges by the same amount", () => {
    const patch = movePatch(hitOf(interval), { deltaMs: 2 * DAY });
    expect(patch).toEqual({ id: "a", start: START + 3 * DAY, end: START + 5 * DAY });
  });

  it("snaps the start and keeps the duration", () => {
    const odd: Item = { id: "a", start: START + DAY + 3_600_000, end: START + DAY + 7_200_000 };
    const patch = movePatch(hitOf(odd), { deltaMs: DAY * 0.9, snapMs: DAY });
    expect(patch.start).toBe(START + 2 * DAY);
    // Two hours stayed two hours: snapping both edges would have squashed it.
    expect((patch.end ?? 0) - (patch.start ?? 0)).toBe(3_600_000);
  });

  it("gives an instant no end", () => {
    const patch = movePatch(hitOf({ id: "a", start: START }), { deltaMs: DAY });
    expect("end" in patch).toBe(false);
  });

  it("only patches the lane when it actually changes", () => {
    const inLane: Item = { id: "a", start: START, laneId: "l1" };
    expect("laneId" in movePatch(hitOf(inLane), { deltaMs: 0, laneId: "l1" })).toBe(false);
    expect(movePatch(hitOf(inLane), { deltaMs: 0, laneId: "l2" }).laneId).toBe("l2");
    expect(movePatch(hitOf(inLane), { deltaMs: 0, laneId: null }).laneId).toBeNull();
    // An item with no lane dropped into none is unchanged, not "set to null".
    expect("laneId" in movePatch(hitOf({ id: "a", start: START }), { deltaMs: 0, laneId: null })).toBe(
      false,
    );
  });
});

describe("resizePatch", () => {
  const interval: Item = { id: "a", start: START, end: START + 4 * DAY };

  it("moves the end and leaves the start alone", () => {
    const patch = resizePatch(hitOf(interval, "end"), { edge: "end", deltaMs: DAY });
    expect(patch).toEqual({ id: "a", end: START + 5 * DAY });
  });

  it("clamps instead of flipping the item", () => {
    const patch = resizePatch(hitOf(interval, "end"), {
      edge: "end",
      deltaMs: -10 * DAY,
      minDurationMs: DAY,
    });
    expect(patch?.end).toBe(START + DAY);
  });

  it("clamps the start edge against the end", () => {
    const patch = resizePatch(hitOf(interval, "start"), {
      edge: "start",
      deltaMs: 10 * DAY,
      minDurationMs: DAY,
    });
    expect(patch?.start).toBe(START + 3 * DAY);
  });

  it("uses one grid step as the smallest duration when snapping", () => {
    const patch = resizePatch(hitOf(interval, "end"), {
      edge: "end",
      deltaMs: -10 * DAY,
      snapMs: DAY,
    });
    expect(patch?.end).toBe(START + DAY);
  });

  it("turns an instant into an interval from its drawn end", () => {
    const instant: Item = { id: "a", start: START, granularity: "day" };
    const patch = resizePatch(hitOf(instant, "end"), { edge: "end", deltaMs: DAY });
    // The drawn end of a day-granular instant is the next midnight.
    expect(patch?.end).toBe(START + 2 * DAY);
  });

  it("refuses to drag the end of an open interval", () => {
    const open: Item = { id: "a", start: START, open: true };
    expect(resizePatch(hitOf(open, "end"), { edge: "end", deltaMs: DAY })).toBeUndefined();
  });

  it("returns nothing when the edge does not actually move", () => {
    expect(resizePatch(hitOf(interval, "end"), { edge: "end", deltaMs: 0 })).toBeUndefined();
    expect(resizePatch(hitOf(interval, "start"), { edge: "start", deltaMs: 0 })).toBeUndefined();
  });
});

describe("invertPatch", () => {
  it("restores exactly the keys the patch touched", () => {
    const item: Item = { id: "a", start: START, end: START + DAY, laneId: "l1" };
    expect(invertPatch(hitOf(item), { id: "a", start: 0 })).toEqual({ id: "a", start: START });
    expect(invertPatch(hitOf(item), { id: "a", laneId: "l2" })).toEqual({ id: "a", laneId: "l1" });
  });

  it("restores an absent end as null, not as a time", () => {
    const instant: Item = { id: "a", start: START, granularity: "day" };
    expect(invertPatch(hitOf(instant), { id: "a", end: 1 })).toEqual({ id: "a", end: null });
  });

  it("restores an absent lane as null", () => {
    expect(invertPatch(hitOf({ id: "a", start: START }), { id: "a", laneId: "l2" })).toEqual({
      id: "a",
      laneId: null,
    });
  });

  it("normalises a Date to epoch milliseconds", () => {
    const item: Item = { id: "a", start: new Date(START) };
    expect(invertPatch(hitOf(item), { id: "a", start: 0 })).toEqual({ id: "a", start: START });
  });
});

describe("applyPatches", () => {
  const items: Item[] = [
    { id: "a", start: START, end: START + DAY },
    { id: "b", start: START + 2 * DAY },
  ];

  it("returns untouched items by reference", () => {
    const next = applyPatches(items, [{ id: "a", start: START + DAY }]);
    expect(next[1]).toBe(items[1]);
    expect(next[0]).not.toBe(items[0]);
  });

  it("copies the list even with nothing to do", () => {
    const next = applyPatches(items, []);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });

  it("removes the end key rather than setting it to undefined", () => {
    const next = applyPatches(items, [{ id: "a", end: null }]);
    expect("end" in (next[0] ?? {})).toBe(false);
  });

  it("removes the lane key on null", () => {
    const next = applyPatches([{ id: "a", start: START, laneId: "l1" }], [
      { id: "a", laneId: null },
    ]);
    expect("laneId" in (next[0] ?? {})).toBe(false);
  });

  it("ignores a patch for an item that is gone", () => {
    expect(applyPatches(items, [{ id: "zzz", start: 0 }])).toEqual(items);
  });

  it("applies several patches for one item in order", () => {
    const next = applyPatches(items, [
      { id: "a", start: START + DAY },
      { id: "a", start: START + 2 * DAY },
    ]);
    expect(next[0]?.start).toBe(START + 2 * DAY);
  });
});

describe("a command and its inverse", () => {
  it("restores the exact starting state, key for key", () => {
    const items: Item[] = [
      { id: "a", start: START, end: START + DAY, laneId: "l1", label: "A" },
      { id: "b", start: START + 2 * DAY, granularity: "day" },
    ];
    const hits = [hitOf(items[0] as Item), hitOf(items[1] as Item, "end")];
    const after: ItemPatch[] = [
      { id: "a", start: START + 5 * DAY, end: START + 6 * DAY, laneId: "l2" },
      { id: "b", end: START + 4 * DAY },
    ];
    const command = editCommand("move", hits, after, "Edit");
    const moved = applyPatches(items, command.after);
    expect(moved[0]?.laneId).toBe("l2");
    expect(moved[1]?.end).toBe(START + 4 * DAY);
    const back = applyPatches(moved, command.inverse.after);
    expect(back).toStrictEqual(items);
  });

  it("refuses a patch list with no hit to invert against", () => {
    expect(() => editCommand("move", [], [{ id: "a", start: 0 }])).toThrow(/No hit/);
  });
});

describe("createHitTester", () => {
  const items: Item[] = [
    { id: "a", start: START, end: START + 10 * DAY, laneId: "l1" },
    { id: "b", start: START + 12 * DAY, end: START + 20 * DAY, laneId: "l2" },
    { id: "narrow", start: START + 22 * DAY, end: START + 22 * DAY + 3_600_000, laneId: "l2" },
    { id: "open", start: START + 24 * DAY, open: true, laneId: "l1" },
  ];
  const layout = layoutItems(items, { lanes: [{ id: "l1" }, { id: "l2" }] });
  const scale = createTimeScale([START, START + 30 * DAY], 600);
  const tester = createHitTester({ layout, scale, handleSize: 10 });

  function crossOf(id: string): number {
    const placed = layout.items.find((candidate) => candidate.item.id === id);
    if (placed === undefined) {
      throw new Error(`no ${id}`);
    }
    return placed.cross + placed.crossSize / 2;
  }

  it("finds nothing outside every item", () => {
    expect(tester.hitTest({ main: 0, cross: 1000 })).toBeUndefined();
    // Past the last item of lane l2. Lane l1 would still answer here: the
    // open interval reaches to the right edge, which is what open means.
    expect(tester.hitTest({ main: 599, cross: crossOf("b") })).toBeUndefined();
  });

  it("reports the body in the middle and a handle at each end", () => {
    const left = scale.toMain(START);
    const right = scale.toMain(START + 10 * DAY);
    expect(tester.hitTest({ main: (left + right) / 2, cross: crossOf("a") })?.part).toBe("body");
    expect(tester.hitTest({ main: left + 2, cross: crossOf("a") })?.part).toBe("start");
    expect(tester.hitTest({ main: right - 2, cross: crossOf("a") })?.part).toBe("end");
  });

  it("gives a narrow item no handles at all", () => {
    const narrow = scale.toMain(START + 22 * DAY);
    expect(tester.hitTest({ main: narrow, cross: crossOf("narrow") })?.part).toBe("body");
  });

  it("gives an unresizable item no handles", () => {
    const locked = layoutItems([{ id: "a", start: START, end: START + 10 * DAY, resizable: false }]);
    const lockedTester = createHitTester({ layout: locked, scale });
    const hit = lockedTester.hitTest({ main: scale.toMain(START) + 1, cross: 1 });
    expect(hit?.part).toBe("body");
  });

  it("gives an open interval no end handle", () => {
    const openEnd = scale.toMain(START + 30 * DAY) - 2;
    expect(tester.hitTest({ main: openEnd, cross: crossOf("open") })?.part).toBe("body");
  });

  it("uses the drawn minimum so an instant can still be grabbed", () => {
    const instantLayout = layoutItems([{ id: "i", start: START + 15 * DAY }]);
    const instantTester = createHitTester({ layout: instantLayout, scale, minItemMainSize: 8 });
    const main = scale.toMain(START + 15 * DAY);
    expect(instantTester.hitTest({ main: main + 6, cross: 1 })?.item.id).toBe("i");
    expect(instantTester.hitTest({ main: main + 20, cross: 1 })).toBeUndefined();
  });

  it("shifts every hit by the axis band the renderer reserves", () => {
    const inset = createHitTester({ layout, scale, crossInset: 40 });
    const main = scale.toMain(START + 5 * DAY);
    expect(inset.hitTest({ main, cross: crossOf("a") })).toBeUndefined();
    expect(inset.hitTest({ main, cross: crossOf("a") + 40 })?.item.id).toBe("a");
  });

  it("follows the lanes when they are scrolled", () => {
    const scrolled = createHitTester({ layout, scale, crossOffset: 30 });
    const main = scale.toMain(START + 5 * DAY);
    expect(scrolled.hitTest({ main, cross: crossOf("a") - 30 })?.item.id).toBe("a");
  });

  it("looks an item up by id, as a body hit", () => {
    expect(tester.lookup("b")?.part).toBe("body");
    expect(tester.lookup("b")?.laneId).toBe("l2");
    expect(tester.lookup("nope")).toBeUndefined();
  });

  it("names the lane under a cross coordinate", () => {
    expect(tester.laneAt(crossOf("a"))).toBe("l1");
    expect(tester.laneAt(crossOf("b"))).toBe("l2");
    expect(tester.laneAt(10_000)).toBeUndefined();
  });

  it("prefers the item drawn last where two share a row", () => {
    const stacked = layoutItems(
      [
        { id: "under", start: START, end: START + 10 * DAY },
        { id: "over", start: START, end: START + 10 * DAY },
      ],
      { packMode: "overlap" },
    );
    const overlapTester = createHitTester({ layout: stacked, scale });
    expect(overlapTester.hitTest({ main: 100, cross: 5 })?.item.id).toBe("over");
  });
});
