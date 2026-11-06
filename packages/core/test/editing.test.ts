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
import { layoutItems, resolveSpan } from "../src/layout.js";
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

  it("puts a grid finer than a day on the zone's whole hours, where the axis ticks are, in a half-hour zone too (X17)", () => {
    const HOUR = 3_600_000;
    const wall = (time: number, timeZone: string): string => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
    const at = Date.UTC(2026, 5, 10, 6, 20); // 11:50 in Kolkata, 12:05 in Kathmandu, 08:20 in Budapest
    expect(wall(snapTime(at, HOUR, undefined, "Asia/Kolkata"), "Asia/Kolkata")).toBe("12:00");
    expect(wall(snapTime(at, HOUR, undefined, "Asia/Kathmandu"), "Asia/Kathmandu")).toBe("12:00");
    expect(wall(snapTime(at, HOUR, undefined, "America/St_Johns"), "America/St_Johns")).toBe("04:00");
    expect(wall(snapTime(at, 15 * 60_000, undefined, "Asia/Kathmandu"), "Asia/Kathmandu")).toBe("12:00");
    // Two-hour steps on the zone's even hours, winter and summer alike.
    expect(wall(snapTime(at, 2 * HOUR, undefined, "Europe/Budapest"), "Europe/Budapest")).toBe("08:00");
    expect(wall(snapTime(Date.UTC(2026, 0, 10, 7, 20), 2 * HOUR, undefined, "Europe/Budapest"), "Europe/Budapest")).toBe("08:00");
    // An hour is still an hour on the night the clocks go back: the repeated 02:00 is its own slot.
    const back = Date.UTC(2026, 9, 25, 1, 10); // 02:10 CET, the second 02:00
    expect(snapTime(back, HOUR, undefined, "Europe/Budapest")).toBe(Date.UTC(2026, 9, 25, 1));
    expect(snapTime(back - HOUR, HOUR, undefined, "Europe/Budapest")).toBe(Date.UTC(2026, 9, 25, 0));
    // An origin still sets the phase.
    expect(wall(snapTime(at, HOUR, Date.UTC(2026, 0, 1), "Asia/Kolkata"), "Asia/Kolkata")).toBe("11:30"); // UTC midnight is 05:30 there
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

describe("a day grid in a zone (R10)", () => {
  const zone = "Europe/Budapest";
  const local = (iso: string): number => {
    // Budapest is UTC+1 in winter and UTC+2 in summer.
    const t = Date.parse(`${iso}Z`);
    return t - (new Date(t).getUTCMonth() >= 3 && new Date(t).getUTCMonth() <= 8 ? 2 : 1) * 3_600_000;
  };

  it("lands on local midnight in winter and in summer", () => {
    expect(snapTime(local("2024-01-15T10:00:00"), DAY, undefined, zone)).toBe(local("2024-01-15T00:00:00"));
    expect(snapTime(local("2024-07-15T10:00:00"), DAY, undefined, zone)).toBe(local("2024-07-15T00:00:00"));
    expect(snapTime(local("2024-07-15T13:00:00"), DAY, undefined, zone)).toBe(local("2024-07-16T00:00:00"));
  });

  it("keeps a week grid on local midnights, anchored at a local origin", () => {
    const monday = local("2024-01-01T00:00:00");
    expect(snapTime(local("2024-07-10T09:00:00"), 7 * DAY, monday, zone)).toBe(local("2024-07-08T00:00:00"));
  });

  it("leaves a grid finer than a day on the instant line, and UTC as it was", () => {
    const t = local("2024-07-15T10:20:00");
    expect(snapTime(t, 3_600_000, undefined, zone)).toBe(snapTime(t, 3_600_000));
    expect(snapTime(t, DAY, undefined, "UTC")).toBe(snapTime(t, DAY));
  });

  it("moves an item onto local midnight", () => {
    const item: Item = { id: "a", start: local("2024-07-15T09:00:00") };
    const hit: EditHit = { item, span: resolveSpan(item, zone), laneId: "", part: "body" };
    expect(movePatch(hit, { deltaMs: DAY, snapMs: DAY, timeZone: zone }).start).toBe(local("2024-07-16T00:00:00"));
  });
});

describe("the drawn edge of an item known to the day (R6)", () => {
  const hit = (item: Item, part: EditHit["part"], zone = "UTC"): EditHit => ({ item, span: resolveSpan(item, zone), laneId: "", part });
  const instant: Item = { id: "a", start: Date.UTC(2024, 0, 1, 10), granularity: "day" };

  it("does nothing when the end is dragged by nothing", () => {
    expect(resizePatch(hit(instant, "end"), { edge: "end", deltaMs: 0 })).toBeUndefined();
    expect(resizePatch(hit(instant, "end"), { edge: "end", deltaMs: 0, snapMs: DAY })).toBeUndefined();
  });

  it("draws one more day for an end dragged one day later — by pointer and by key", () => {
    // A key press is the same resize with the grid step as its delta.
    const patch = resizePatch(hit(instant, "end"), { edge: "end", deltaMs: DAY, snapMs: DAY });
    expect(resolveSpan({ ...instant, end: patch?.end as number })).toEqual({
      start: Date.UTC(2024, 0, 1),
      end: Date.UTC(2024, 0, 3),
      open: false,
    });
  });

  it("holds the same for a month and a year", () => {
    for (const granularity of ["month", "year"] as const) {
      const item: Item = { id: "m", start: Date.UTC(2024, 4, 20), granularity };
      expect(resizePatch(hit(item, "end"), { edge: "end", deltaMs: 0 })).toBeUndefined();
      const patch = resizePatch(hit(item, "end"), { edge: "end", deltaMs: 1 });
      const drawn = resolveSpan({ ...item, end: patch?.end as number });
      expect(drawn.end).toBe(granularity === "month" ? Date.UTC(2024, 6, 1) : Date.UTC(2026, 0, 1));
    }
  });

  it("shrinks an interval to its first day and no further", () => {
    const interval: Item = { id: "b", start: Date.UTC(2024, 0, 1, 10), end: Date.UTC(2024, 0, 5, 14), granularity: "day" };
    const patch = resizePatch(hit(interval, "end"), { edge: "end", deltaMs: -30 * DAY, snapMs: DAY });
    expect(resolveSpan({ ...interval, end: patch?.end as number }).end).toBe(Date.UTC(2024, 0, 2));
  });

  it("does not round a drag of nothing to the next day for a stored afternoon", () => {
    const afternoon: Item = { id: "c", start: Date.UTC(2024, 0, 1, 14), end: Date.UTC(2024, 0, 3, 14), granularity: "day" };
    expect(resizePatch(hit(afternoon, "start"), { edge: "start", deltaMs: 0, snapMs: DAY })).toBeUndefined();
    expect(resizePatch(hit(afternoon, "end"), { edge: "end", deltaMs: 0, snapMs: DAY })).toBeUndefined();
    expect(movePatch(hit(afternoon, "body"), { deltaMs: 0, snapMs: DAY })).toMatchObject({ start: Date.UTC(2024, 0, 1, 14) });
  });

  it("moves the start by the drawn day, in the item's zone", () => {
    const zone = "Europe/Budapest";
    const item: Item = { id: "d", start: Date.UTC(2024, 6, 10, 8), end: Date.UTC(2024, 6, 12, 8), granularity: "day" };
    const patch = resizePatch(hit(item, "start", zone), { edge: "start", deltaMs: -DAY, snapMs: DAY, timeZone: zone });
    // Local midnight of 9 July, CEST.
    expect(patch?.start).toBe(Date.UTC(2024, 6, 8, 22));
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
    // The drawn end of a day-granular instant is the next midnight; one day
    // later it is the midnight after that. A stored end known to the day is
    // inclusive, so the item is stored as ending on 2 January, and is drawn
    // over two days — one more than it had.
    expect(patch?.end).toBe(START + DAY);
    expect(resolveSpan({ ...instant, end: patch?.end as number })).toEqual({ start: START, end: START + 2 * DAY, open: false });
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
