/**
 * A keyboard edit of an item known to the day changes what is drawn, in
 * either direction (X16), and a step finer than the snap grid still moves
 * (X18). Ten pixels of a month's view is under a day: the start went back to
 * its midnight, the end's last day stayed the last day, and a move shifted
 * the stored instants by hours that the drawing rounds away — an undo entry
 * for nothing on every press.
 */
import { describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { EditEndEffect, InputEffect, KeyboardInputOptions } from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import type { KeySample } from "../../src/keyboard.js";
import type { Item } from "../../src/types.js";
import { DAY, DOMAIN, MAIN_SIZE, START, surfaceFor } from "../edit-fixture.js";

const HOUR = 3_600_000;

function key(name: string, modifiers: Partial<KeySample> = {}): KeySample {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0, ...modifiers };
}

function rig(items: readonly Item[], editing: { snapMs?: number; timeZone?: string } = {}, keyboard: Partial<KeyboardInputOptions> = {}) {
  const surface = surfaceFor(items);
  const machine = createInputMachine({
    domain: DOMAIN,
    mainSize: MAIN_SIZE,
    crossSize: 300,
    contentCrossSize: 300,
    orientation: "horizontal",
    editing: { enabled: true, ...editing, hitTest: surface.tester.hitTest, lookup: surface.tester.lookup },
    keyboard: { navigator: createNavigator(surface.layout), ...keyboard },
  });
  machine.key(key("Home"));
  expect(machine.focusedId).toBe(items[0]?.id);
  return (name: string, modifiers: Partial<KeySample>) => {
    const end = machine.key(key(name, modifiers)).find((effect: InputEffect): effect is EditEndEffect => effect.type === "editEnd");
    return end?.command?.after[0];
  };
}

describe("keyboard edits of an item known to the day (X16)", () => {
  // 5–7 January, written at 00:00 UTC, by the day.
  const day = (date: number): number => START + (date - 1) * DAY;
  const item: Item = { id: "d", start: day(5), end: day(7), laneId: "l1", granularity: "day" };

  it("moves it a whole day either way", () => {
    expect(rig([item])("ArrowRight", { altKey: true })).toEqual({ id: "d", start: day(6), end: day(8) });
    expect(rig([item])("ArrowLeft", { altKey: true })).toEqual({ id: "d", start: day(4), end: day(6) });
  });

  it("moves either edge a whole day, shrinking as well as growing", () => {
    expect(rig([item])("ArrowLeft", { shiftKey: true })).toEqual({ id: "d", end: day(6) });
    expect(rig([item])("ArrowRight", { shiftKey: true })).toEqual({ id: "d", end: day(8) });
    expect(rig([item])("ArrowRight", { shiftKey: true, altKey: true })).toEqual({ id: "d", start: day(6) });
    expect(rig([item])("ArrowLeft", { shiftKey: true, altKey: true })).toEqual({ id: "d", start: day(4) });
  });

  it("steps by the zone's days across a change of the clocks", () => {
    // Budapest, Saturday 28 – Sunday 29 March 2026: the 29th is 23 hours long.
    const local = (date: number): number => Date.UTC(2026, 2, date) - HOUR;
    const spring: Item = { id: "s", start: local(28), end: local(29), laneId: "l1", granularity: "day" };
    const press = rig([spring], { timeZone: "Europe/Budapest" });
    const moved = press("ArrowRight", { altKey: true });
    // Drawn over the 29th and the 30th: the end, shifted as the start was, is
    // inside the 30th (01:00 there, as a drag puts it).
    expect(moved?.start).toBe(local(29));
    expect(moved?.end).toBeGreaterThanOrEqual(local(30) - HOUR);
    expect(moved?.end).toBeLessThan(local(31) - HOUR);
  });

  it("leaves an item by the millisecond to the pixel step", () => {
    const plain: Item = { id: "p", start: day(5), end: day(7), laneId: "l1" };
    const moved = rig([plain])("ArrowRight", { altKey: true });
    expect(moved?.start).toBe(day(5) + ((30 * DAY) / MAIN_SIZE) * 10);
  });
});

describe("a keyboard step finer than the snap grid (X18)", () => {
  it("moves by the grid instead of rounding back", () => {
    const plain: Item = { id: "p", start: START + 4 * DAY, end: START + 6 * DAY, laneId: "l1" };
    const press = rig([plain], { snapMs: DAY }, { stepMs: 15 * 60_000 });
    expect(press("ArrowRight", { altKey: true })).toEqual({ id: "p", start: START + 5 * DAY, end: START + 7 * DAY });
  });
});
