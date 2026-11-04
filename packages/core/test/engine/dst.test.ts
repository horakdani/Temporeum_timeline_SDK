/** Daylight-saving gaps and folds, west and east of Greenwich. */
import { describe, expect, it } from "vitest";

import { fromCalendarParts, startOf, toCalendarParts } from "../../src/calendar.js";
import { resolveSpan } from "../../src/layout.js";
import { generateTicks } from "../../src/ticks.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const wall = (year: number, month: number, day: number, hour = 0, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
  millisecond: 0,
});

describe("a wall-clock time inside a spring-forward gap", () => {
  it("lands as far past the gap as it was into it, west and east", () => {
    // New York, 2024-03-10: 02:00 EST jumps to 03:00 EDT at 07:00Z.
    expect(fromCalendarParts(wall(2024, 3, 10, 2, 30), "America/New_York")).toBe(Date.UTC(2024, 2, 10, 7, 30));
    // Budapest, 2024-03-31: 02:00 CET jumps to 03:00 CEST at 01:00Z.
    expect(fromCalendarParts(wall(2024, 3, 31, 2, 30), "Europe/Budapest")).toBe(Date.UTC(2024, 2, 31, 1, 30));
    // The wall clock it reads back is 03:30 in both.
    for (const [zone, t] of [
      ["America/New_York", Date.UTC(2024, 2, 10, 7, 30)],
      ["Europe/Budapest", Date.UTC(2024, 2, 31, 1, 30)],
    ] as const) {
      expect(toCalendarParts(t, zone)).toMatchObject({ hour: 3, minute: 30 });
    }
  });

  it("keeps a midnight gap on its own day", () => {
    // Havana springs forward at midnight (2024-03-10 00:00 CST → 01:00 CDT,
    // 05:00Z), Santiago likewise (2024-09-08 00:00 → 01:00, 04:00Z).
    for (const [zone, day, gapEnd] of [
      ["America/Havana", wall(2024, 3, 10), Date.UTC(2024, 2, 10, 5)],
      ["America/Santiago", wall(2024, 9, 8), Date.UTC(2024, 8, 8, 4)],
    ] as const) {
      const midnight = fromCalendarParts(day, zone);
      expect(midnight).toBe(gapEnd);
      expect(toCalendarParts(midnight, zone)).toMatchObject({ day: day.day, hour: 1 });
      // The start of the day of an instant that day is on that day.
      expect(toCalendarParts(startOf(gapEnd + 10 * HOUR, "day", zone), zone).day).toBe(day.day);
    }
  });

  it("labels each day of a daily axis once", () => {
    for (const [zone, from] of [
      ["America/Havana", Date.UTC(2024, 2, 7)],
      ["America/Santiago", Date.UTC(2024, 8, 5)],
    ] as const) {
      const ticks = generateTicks([from, from + 7 * DAY], 700, { timeZone: zone });
      expect(ticks.every((tick) => tick.granularity === "day")).toBe(true);
      const days = ticks.map((tick) => toCalendarParts(tick.time, zone).day);
      expect(new Set(days).size).toBe(days.length);
      for (let i = 1; i < days.length; i += 1) {
        expect(ticks[i]!.time - ticks[i - 1]!.time).toBeGreaterThanOrEqual(23 * HOUR);
      }
    }
  });

  it("gives a day-granular item a span that contains its own instant", () => {
    // 23:30 local on Havana's gap day, late enough to fall past a span
    // that started at 23:00 the day before.
    const start = Date.UTC(2024, 2, 11, 3, 30);
    const span = resolveSpan({ id: "x", start, granularity: "day" }, "America/Havana");
    expect(span.start).toBeLessThanOrEqual(start);
    expect(span.end).toBeGreaterThan(start);
  });
});

describe("fixed-length ticks across a fall-back", () => {
  const zone = "America/New_York";
  // 2024-11-03: 02:00 EDT falls back to 01:00 EST at 06:00Z.
  const from = Date.UTC(2024, 10, 3, 4); // 00:00 EDT
  const hoursOf = (ticks: readonly { time: number }[]) => ticks.map((tick) => toCalendarParts(tick.time, zone).hour);

  it("keeps two-hour ticks on the two-hour grid", () => {
    const ticks = generateTicks([from, from + 9 * HOUR], 600, { timeZone: zone, targetSpacingPx: 120 });
    expect(ticks.every((tick) => tick.granularity === "hour")).toBe(true);
    expect(hoursOf(ticks)).toEqual([0, 2, 4, 6, 8]);
  });

  it("still shows the repeated hour twice on an hourly axis", () => {
    const ticks = generateTicks([from, from + 4 * HOUR], 600, { timeZone: zone });
    expect(hoursOf(ticks)).toEqual([0, 1, 1, 2, 3]);
  });
});
