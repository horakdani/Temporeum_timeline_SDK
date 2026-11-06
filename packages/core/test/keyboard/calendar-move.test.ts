/**
 * An item known to a unit moves by whole units of its own calendar (Y1, Y8),
 * and a keyboard step is at least ten pixels' worth, not exactly one unit
 * (Y2). Before, the stored start and end shifted by the milliseconds the
 * drawn start moved: a quarter written Jan 1 – Mar 31 by the month became
 * Feb – May a month later, an item on the 31st skipped February, and a
 * millisecond-precision item stepped one millisecond per press.
 */
import { describe, expect, it } from "vitest";

import { movePatch } from "../../src/editing.js";
import { createHitTester } from "../../src/editing.js";
import { createInputMachine } from "../../src/input.js";
import type { EditEndEffect, InputEffect } from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import type { KeySample } from "../../src/keyboard.js";
import { layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";
import type { Item } from "../../src/types.js";

const DAY = 864e5;
const HOUR = 36e5;
const VIEW: [number, number] = [Date.UTC(2025, 0, 1), Date.UTC(2027, 0, 1)];
const WIDTH = 800;

function key(name: string, modifiers: Partial<KeySample> = {}): KeySample {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0, ...modifiers };
}

function press(item: Item, name: string, modifiers: Partial<KeySample>, timeZone?: string, view: [number, number] = VIEW) {
  const layout = layoutItems([item], { lanes: [{ id: "l1" }], ...(timeZone === undefined ? {} : { timeZone }) });
  const tester = createHitTester({ layout, scale: createTimeScale(view, WIDTH) });
  const machine = createInputMachine({
    domain: view,
    mainSize: WIDTH,
    crossSize: 300,
    contentCrossSize: 300,
    orientation: "horizontal",
    editing: { enabled: true, hitTest: tester.hitTest, lookup: tester.lookup, ...(timeZone === undefined ? {} : { timeZone }) },
    keyboard: { navigator: createNavigator(layout) },
  });
  machine.key(key("Home"));
  return machine.key(key(name, modifiers)).find((effect: InputEffect): effect is EditEndEffect => effect.type === "editEnd")?.command?.after[0];
}

const later = { altKey: true };
const earlier = { altKey: true };

describe("moving an item known to a month or a year (Y1)", () => {
  it("keeps a quarter three months long", () => {
    const quarter: Item = { id: "q", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 2, 31), laneId: "l1", granularity: "month" };
    expect(press(quarter, "ArrowRight", later)).toEqual({ id: "q", start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 3, 30) });
    expect(press(quarter, "ArrowLeft", earlier)).toEqual({ id: "q", start: Date.UTC(2025, 11, 1), end: Date.UTC(2026, 1, 28) });
  });

  it("does not skip February or a year", () => {
    const jan31: Item = { id: "j", start: Date.UTC(2026, 0, 31), laneId: "l1", granularity: "month" };
    expect(press(jan31, "ArrowRight", later)).toEqual({ id: "j", start: Date.UTC(2026, 1, 28) });
    const leap: Item = { id: "y", start: Date.UTC(2028, 11, 31), laneId: "l1", granularity: "year" };
    expect(press(leap, "ArrowRight", later)).toEqual({ id: "y", start: Date.UTC(2029, 11, 31) });
  });

  it("keeps an end on the unit's last millisecond there (a mixed-precision import)", () => {
    const imported: Item = { id: "t", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1) - 1, laneId: "l1", granularity: "month" };
    expect(press(imported, "ArrowRight", later)).toEqual({ id: "t", start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) - 1 });
  });

  it("drags by whole months, the stored values each on their own calendar", () => {
    const quarter: Item = { id: "q", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 2, 31), laneId: "l1", granularity: "month" };
    const span = layoutItems([quarter], { lanes: [{ id: "l1" }] }).items[0]!.span;
    const hit = { item: quarter, span, laneId: "l1", part: "body" as const };
    expect(movePatch(hit, { deltaMs: 31 * DAY })).toEqual({ id: "q", start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 3, 30) });
    // Less than half a month is no move at all.
    expect(movePatch(hit, { deltaMs: 10 * DAY })).toEqual({ id: "q", start: quarter.start, end: quarter.end });
  });
});

describe("a day item across the spring change of the clocks (Y8)", () => {
  it("keeps its wall-clock time and the next day", () => {
    // Budapest, Saturday 28 March 2026, 23:30 (22:30 UTC); the 29th is 23 hours long.
    const late: Item = { id: "d", start: Date.UTC(2026, 2, 28, 22, 30), laneId: "l1", granularity: "day" };
    // A month's view: ten pixels are under a day, so the step is the item's day.
    const moved = press(late, "ArrowRight", later, "Europe/Budapest", [Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 1)]);
    // 23:30 on the 29th, CEST: 21:30 UTC — not 00:30 on the 30th.
    expect(moved).toEqual({ id: "d", start: Date.UTC(2026, 2, 29, 21, 30) });
  });
});

describe("the keyboard step is at least ten pixels' worth (Y2)", () => {
  const pixels = ((VIEW[1] - VIEW[0]) / WIDTH) * 10;

  it("treats an explicit millisecond precision as none", () => {
    const item: Item = { id: "m", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 5), laneId: "l1", granularity: "millisecond" };
    expect(press(item, "ArrowRight", later)?.start).toBe(Date.UTC(2026, 0, 1) + pixels);
  });

  it("moves an hour item ten pixels, in whole hours", () => {
    const item: Item = { id: "h", start: Date.UTC(2026, 0, 1), laneId: "l1", granularity: "hour" };
    const moved = press(item, "ArrowRight", later)!.start as number;
    expect((moved - Date.UTC(2026, 0, 1)) % HOUR).toBe(0);
    expect(Math.abs(moved - Date.UTC(2026, 0, 1) - pixels)).toBeLessThanOrEqual(HOUR / 2);
  });

  it("moves a day item in a two-year view by the days ten pixels hold", () => {
    const item: Item = { id: "d", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 5), laneId: "l1", granularity: "day" };
    const days = Math.round(pixels / DAY);
    expect(days).toBeGreaterThan(1);
    expect(press(item, "ArrowRight", later)).toEqual({ id: "d", start: Date.UTC(2026, 0, 1 + days), end: Date.UTC(2026, 0, 5 + days) });
  });
});
