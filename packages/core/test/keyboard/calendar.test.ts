/**
 * G-KEYBOARD, P27: the week and day views have a key for everything a
 * pointer does there.
 *
 * A pointer does one thing in the views: a click chooses an event. The key
 * for it is `Enter` (or `Space`) on the event the keyboard is on, and the
 * keyboard reaches every event (`G-CALENDAR-VIEW [claim:keyboard]`). Here:
 * the keys resolve to the actions, right to left as well, and for every
 * event the click and the keys end on the same event, so both choose the
 * same one. The period buttons are buttons — keys of their own — and have
 * their keys in the drawing too (`PageUp`, `PageDown`, `t`).
 */

import { describe, expect, it } from "vitest";

import { calendarGeometry, calendarHit, calendarKeyStep, layoutDays, resolveCalendarKey } from "../../src/calendar/index.js";
import type { CalendarKeyAction } from "../../src/calendar/index.js";
import type { Item } from "../../src/types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONDAY = Date.UTC(2026, 10, 2);

const items: Item[] = [
  { id: "a", label: "A", start: MONDAY + 9 * HOUR, end: MONDAY + 11 * HOUR },
  { id: "b", label: "B", start: MONDAY + 10 * HOUR, end: MONDAY + 12 * HOUR },
  { id: "c", label: "C", start: MONDAY + 10.5 * HOUR, end: MONDAY + 11 * HOUR },
  { id: "d", label: "D", start: MONDAY + DAY + 8 * HOUR, end: MONDAY + DAY + 9 * HOUR },
  { id: "e", label: "E", start: MONDAY + 3 * DAY + 22 * HOUR, end: MONDAY + 4 * DAY + 2 * HOUR },
  { id: "f", label: "F", start: MONDAY + 2 * DAY, end: MONDAY + 4 * DAY },
];

describe("G-KEYBOARD: the calendar views", () => {
  it("[claim:calendar-keys] every key of the views resolves, left to right and right to left", () => {
    const table: readonly (readonly [string, Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }>, CalendarKeyAction | undefined, CalendarKeyAction | undefined])[] = [
      ["ArrowDown", {}, "next", "next"],
      ["ArrowUp", {}, "previous", "previous"],
      ["ArrowRight", {}, "nextDay", "previousDay"],
      ["ArrowLeft", {}, "previousDay", "nextDay"],
      ["Home", {}, "dayStart", "dayStart"],
      ["End", {}, "dayEnd", "dayEnd"],
      ["Home", { ctrlKey: true }, "first", "first"],
      ["End", { metaKey: true }, "last", "last"],
      ["PageDown", {}, "nextPeriod", "nextPeriod"],
      ["PageUp", {}, "previousPeriod", "previousPeriod"],
      ["t", {}, "today", "today"],
      ["T", {}, "today", "today"],
      ["t", { ctrlKey: true }, undefined, undefined],
      ["Enter", {}, "activate", "activate"],
      [" ", {}, "activate", "activate"],
      ["ArrowDown", { altKey: true }, undefined, undefined],
      ["x", {}, undefined, undefined],
    ];
    for (const [key, modifiers, ltr, rtl] of table) {
      expect(resolveCalendarKey({ key, ...modifiers }), `${key} ltr`).toBe(ltr);
      expect(resolveCalendarKey({ key, ...modifiers }, true), `${key} rtl`).toBe(rtl);
    }
  });

  it.each([false, true])("[claim:calendar-keys] a click and the keys choose the same event, for every event (rtl: %s)", (rtl) => {
    const layout = layoutDays(items, { start: MONDAY, timeZone: "UTC" });
    const geometry = calendarGeometry(layout, { width: 900, height: 700, rtl });
    expect(layout.order.length).toBe(layout.segments.length + layout.allDay.length);
    for (const key of layout.order) {
      const rect = geometry.rects.get(key);
      expect(rect).toBeDefined();
      if (rect === undefined) continue;
      const clicked = calendarHit(geometry, rect.x + rect.width / 2, rect.y + rect.height / 2);
      // The keyboard's path: down from no focus until the event, then Enter.
      let focused = calendarKeyStep(layout, undefined, "next");
      for (let step = 0; focused !== key && step < layout.order.length; step += 1) focused = calendarKeyStep(layout, focused, "next");
      const action = resolveCalendarKey({ key: "Enter" }, rtl);
      expect(action).toBe("activate");
      expect(calendarKeyStep(layout, focused, "activate")).toBe(focused);
      expect(clicked).toBe(key);
      expect(focused).toBe(key);
    }
  });

  it("[claim:calendar-keys] right to left, the arrow that points at the next day goes to it", () => {
    const layout = layoutDays(items, { start: MONDAY, timeZone: "UTC" });
    const geometry = calendarGeometry(layout, { width: 900, height: 700, rtl: true });
    // Monday's first event, then the arrow pointing left: in RTL the next day is to the left.
    const first = calendarKeyStep(layout, undefined, "next");
    const leftward = resolveCalendarKey({ key: "ArrowLeft" }, true);
    expect(leftward).toBe("nextDay");
    const next = calendarKeyStep(layout, first, leftward ?? "next");
    const a = geometry.rects.get(first ?? "");
    const b = geometry.rects.get(next ?? "");
    expect(a !== undefined && b !== undefined && b.x < a.x).toBe(true);
  });
});
