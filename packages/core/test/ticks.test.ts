import { describe, expect, it } from "vitest";

import { fromCalendarParts, startOf, toCalendarParts } from "../src/calendar.js";
import {
  alignToStep,
  chooseTickStep,
  DEFAULT_MAX_TICKS,
  DEFAULT_TICK_SPACING_PX,
  generateTicks,
} from "../src/ticks.js";
import type { Domain } from "../src/types.js";

const BUDAPEST = "Europe/Budapest";

function wall(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
): number {
  return fromCalendarParts(
    { year, month, day, hour, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );
}

describe("chooseTickStep", () => {
  it("picks a step readers recognise at every zoom", () => {
    const perPixel = (spanMs: number, mainSize: number): number => spanMs / mainSize;
    expect(chooseTickStep(perPixel(1000, 800))).toEqual({ granularity: "millisecond", count: 100 });
    expect(chooseTickStep(perPixel(60_000, 800))).toEqual({ granularity: "second", count: 10 });
    expect(chooseTickStep(perPixel(86_400_000, 800))).toEqual({ granularity: "hour", count: 3 });
    expect(chooseTickStep(perPixel(7 * 86_400_000, 700))).toEqual({
      granularity: "day",
      count: 1,
    });
    expect(chooseTickStep(perPixel(365 * 86_400_000, 800))).toEqual({
      granularity: "month",
      count: 3,
    });
  });

  it("gets denser as the caller asks for less room per label", () => {
    const msPerPx = 86_400_000 / 800;
    const roomy = chooseTickStep(msPerPx, 200);
    const tight = chooseTickStep(msPerPx, 20);
    expect(roomy).toEqual({ granularity: "hour", count: 6 });
    expect(tight).toEqual({ granularity: "hour", count: 1 });
    expect(DEFAULT_TICK_SPACING_PX).toBe(80);
  });

  it("stops at the top of the ladder instead of inventing a step", () => {
    expect(chooseTickStep(1e15)).toEqual({ granularity: "millennium", count: 5 });
  });

  it("rejects a zoom level or a spacing it cannot use", () => {
    expect(() => chooseTickStep(0)).toThrow(/positive number/);
    expect(() => chooseTickStep(-1)).toThrow(/positive number/);
    expect(() => chooseTickStep(Number.NaN)).toThrow(/positive number/);
    expect(() => chooseTickStep(1000, 0)).toThrow(/positive number of pixels/);
    expect(() => chooseTickStep(1000, Number.NaN)).toThrow(/positive number of pixels/);
  });
});

describe("alignToStep", () => {
  const iso = (t: number): string => new Date(t).toISOString();

  it("aligns a week to Monday", () => {
    const saturday = wall("UTC", 2025, 3, 15);
    expect(iso(alignToStep(saturday, { granularity: "day", count: 7 }))).toBe(
      "2025-03-10T00:00:00.000Z",
    );
    const monday = wall("UTC", 2025, 3, 10);
    expect(alignToStep(monday, { granularity: "day", count: 7 })).toBe(monday);
  });

  it("aligns months to a multiple from January", () => {
    const may20 = wall("UTC", 2025, 5, 20);
    expect(iso(alignToStep(may20, { granularity: "month", count: 3 }))).toBe(
      "2025-04-01T00:00:00.000Z",
    );
    expect(iso(alignToStep(may20, { granularity: "month", count: 6 }))).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(iso(alignToStep(may20, { granularity: "month", count: 1 }))).toBe(
      "2025-05-01T00:00:00.000Z",
    );
  });

  it("aligns coarse steps to round years, not to the viewport edge", () => {
    const y1890 = wall("UTC", 1890, 6, 15);
    expect(toCalendarParts(alignToStep(y1890, { granularity: "century", count: 2 })).year).toBe(
      1800,
    );
    expect(toCalendarParts(alignToStep(y1890, { granularity: "decade", count: 1 })).year).toBe(
      1890,
    );
    expect(toCalendarParts(alignToStep(y1890, { granularity: "millennium", count: 1 })).year).toBe(
      1000,
    );
  });

  it("aligns the sub-day steps to round wall-clock fields", () => {
    const t = Date.UTC(2025, 2, 15, 14, 37, 42, 123);
    expect(iso(alignToStep(t, { granularity: "hour", count: 6 }))).toBe(
      "2025-03-15T12:00:00.000Z",
    );
    expect(iso(alignToStep(t, { granularity: "minute", count: 15 }))).toBe(
      "2025-03-15T14:30:00.000Z",
    );
    expect(iso(alignToStep(t, { granularity: "second", count: 30 }))).toBe(
      "2025-03-15T14:37:30.000Z",
    );
    expect(iso(alignToStep(t, { granularity: "millisecond", count: 100 }))).toBe(
      "2025-03-15T14:37:42.100Z",
    );
    expect(iso(alignToStep(t, { granularity: "day", count: 1 }))).toBe(
      "2025-03-15T00:00:00.000Z",
    );
  });
});

describe("generateTicks", () => {
  const WEEK: Domain = [wall("UTC", 2025, 3, 10), wall("UTC", 2025, 3, 17)];

  it("returns round, ascending ticks inside the domain", () => {
    const ticks = generateTicks(WEEK, 700);
    expect(ticks).toHaveLength(8);
    for (const tick of ticks) {
      expect(tick.granularity).toBe("day");
      expect(tick.time).toBeGreaterThanOrEqual(WEEK[0]);
      expect(tick.time).toBeLessThanOrEqual(WEEK[1]);
      expect(new Date(tick.time).toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
    const times = ticks.map((tick) => tick.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("marks a tick major when it also starts the next coarser unit", () => {
    const acrossMonths: Domain = [wall("UTC", 2025, 2, 20), wall("UTC", 2025, 3, 10)];
    // Wide enough that the step is a day: at 700 px the same window would be
    // ticked by the week, and no Monday happens to be the first of March.
    const ticks = generateTicks(acrossMonths, 2000);
    const majors = ticks.filter((tick) => tick.major);
    expect(majors).toHaveLength(1);
    expect(new Date(majors[0]?.time ?? 0).toISOString()).toBe("2025-03-01T00:00:00.000Z");
    // Days inside a month are minor, which is what lets a renderer give the
    // first of the month a heavier rule without a second pass.
    expect(ticks.filter((tick) => !tick.major).length).toBeGreaterThan(10);
  });

  it("keeps hour ticks on round wall-clock hours across a daylight-saving jump", () => {
    // Europe/Budapest skips 02:00-03:00 on 2025-03-30. Stepping by a fixed
    // three hours from midnight would put every later tick on 04:00, 07:00,
    // 10:00 for the rest of the day; the axis has to re-align instead.
    const domain: Domain = [wall(BUDAPEST, 2025, 3, 29, 18), wall(BUDAPEST, 2025, 3, 30, 18)];
    expect(domain[1] - domain[0]).toBe(23 * 3_600_000);

    const ticks = generateTicks(domain, 800, { timeZone: BUDAPEST });
    expect(ticks.length).toBeGreaterThan(5);
    for (const tick of ticks) {
      const parts = toCalendarParts(tick.time, BUDAPEST);
      expect(parts.hour % 3).toBe(0);
      expect(parts.minute).toBe(0);
      expect(parts.second).toBe(0);
    }
    const hours = ticks.map((tick) => toCalendarParts(tick.time, BUDAPEST).hour);
    expect(hours).toEqual([18, 21, 0, 3, 6, 9, 12, 15, 18]);
    // Midnight is the major tick of the day, even on the short day.
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.time)).toEqual([
      startOf(wall(BUDAPEST, 2025, 3, 30, 12), "day", BUDAPEST),
    ]);
  });

  it("reaches the millennium end of the range", () => {
    const millennia: Domain = [wall("UTC", 1000, 1, 1), wall("UTC", 3000, 1, 1)];
    const ticks = generateTicks(millennia, 1000);
    const years = ticks.map((tick) => toCalendarParts(tick.time).year);
    expect(years).toEqual([1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000]);
    expect(ticks.every((tick) => tick.granularity === "century")).toBe(true);
    expect(ticks.filter((tick) => tick.major).map((tick) => toCalendarParts(tick.time).year)).toEqual(
      [1000, 2000, 3000],
    );
  });

  it("treats the coarsest granularity as always major", () => {
    const wide: Domain = [wall("UTC", 0, 1, 1), wall("UTC", 10000, 1, 1)];
    const ticks = generateTicks(wide, 500);
    expect(ticks.every((tick) => tick.granularity === "millennium")).toBe(true);
    expect(ticks.every((tick) => tick.major)).toBe(true);
  });

  it("generates the axis in a zone's own wall clock", () => {
    const day: Domain = [wall("Asia/Kolkata", 2025, 3, 15), wall("Asia/Kolkata", 2025, 3, 16)];
    const ticks = generateTicks(day, 800, { timeZone: "Asia/Kolkata" });
    for (const tick of ticks) {
      expect(toCalendarParts(tick.time, "Asia/Kolkata").minute).toBe(0);
      // The same instants are at half past the hour in UTC.
      expect(toCalendarParts(tick.time).minute).toBe(30);
    }
  });

  it("honours the tick ceiling", () => {
    expect(DEFAULT_MAX_TICKS).toBe(2000);
    expect(generateTicks(WEEK, 700, { maxTicks: 3 })).toHaveLength(3);
    expect(generateTicks(WEEK, 700, { maxTicks: 1 })).toHaveLength(1);
  });

  it("rejects a viewport or a ceiling it cannot use", () => {
    expect(() => generateTicks([0, 0], 700)).toThrow(/at least 1 ms/);
    expect(() => generateTicks(WEEK, 0)).toThrow(/positive number of pixels/);
    expect(() => generateTicks(WEEK, 700, { maxTicks: 0 })).toThrow(/maxTicks must be at least 1/);
    expect(() => generateTicks(WEEK, 700, { maxTicks: Number.NaN })).toThrow(
      /maxTicks must be at least 1/,
    );
  });
});

describe("ticks across the hour the clocks go back, in zones whose offsets are not whole hours (R33)", () => {
  it("skips no step: every tick follows the last by the step", async () => {
    const { generateTicks } = await import("../src/ticks.js");
    // The repeated hour read as its later copy, and the realignment skipped
    // to the next round value: a 75- or 90-minute hole in a 15- or 30-minute axis.
    const H = 3_600_000;
    for (const [zone, change] of [
      ["Pacific/Chatham", Date.UTC(2026, 3, 4, 14)],
      ["Australia/Lord_Howe", Date.UTC(2026, 3, 4, 15)],
      ["Europe/Budapest", Date.UTC(2026, 9, 25, 1)],
    ] as const) {
      for (const hours of [3, 6]) {
        const ticks = generateTicks([change - (hours * H) / 2, change + (hours * H) / 2], 1200, { timeZone: zone });
        const gaps = new Set(ticks.slice(1).map((tick, i) => tick.time - (ticks[i] as { time: number }).time));
        expect([...gaps], `${zone}, ${String(hours)} h`).toEqual([hours === 3 ? 15 * 60_000 : 30 * 60_000]);
      }
    }
  });
});

describe("ticks on a day whose midnight is skipped (Y9)", () => {
  // Havana (8 March 2026) and Santiago (6 September 2026) spring forward at
  // midnight: the day starts at 01:00. A step that realigned to the missing
  // 00:00 went past it, and the day had no tick and no major.
  const local = (zone: string, time: number): string =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);

  it("ticks the day's first instant, as a major", () => {
    for (const [zone, from, mainSize] of [
      ["America/Havana", Date.UTC(2026, 2, 7, 12), 1600],
      ["America/Santiago", Date.UTC(2026, 8, 5, 12), 400],
    ] as const) {
      const ticks = generateTicks([from, from + 2 * 864e5], mainSize, { timeZone: zone });
      const first = ticks.find((tick) => local(zone, tick.time).startsWith(zone === "America/Havana" ? "08" : "06"));
      expect(first && local(zone, first.time), zone).toMatch(/, 01:00$/);
      expect(first?.major, zone).toBe(true);
      // Still ascending, on round values after it.
      expect(ticks.every((tick, index) => index === 0 || tick.time > ticks[index - 1]!.time)).toBe(true);
    }
  });
});
