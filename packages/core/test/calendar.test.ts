import { describe, expect, it, vi } from "vitest";

import {
  addCalendar,
  daysInMonth,
  DEFAULT_TIME_ZONE,
  fromCalendarParts,
  isLeapYear,
  isoWeekday,
  startOf,
  toCalendarParts,
  zoneOffsetMs,
} from "../src/calendar.js";
import type { CalendarParts } from "../src/calendar.js";

const BUDAPEST = "Europe/Budapest";
const KOLKATA = "Asia/Kolkata";

/** Wall clock in a zone, as an instant. */
function wall(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return fromCalendarParts(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    timeZone,
  );
}

describe("zoneOffsetMs", () => {
  it("defaults to UTC", () => {
    expect(DEFAULT_TIME_ZONE).toBe("UTC");
    expect(zoneOffsetMs(0)).toBe(0);
  });

  it("answers UTC without Intl, as Intl would", () => {
    // A fast path: ticks ask this hundreds of times a frame. The
    // same zone under another name still goes through Intl, and agrees.
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype as unknown as { format: unknown }, "format", "get");
    const times = [0, -1, 1, Date.UTC(1890, 0, 1), Date.UTC(2025, 2, 30, 1, 0, 0, 1), 8.64e15, -8.64e15];
    for (const time of times) {
      expect(zoneOffsetMs(time, "UTC")).toBe(0);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    for (const time of times) {
      expect(zoneOffsetMs(time, "Etc/UTC")).toBe(0);
    }
    expect(() => zoneOffsetMs(Number.NaN, "UTC")).toThrow(RangeError);
  });

  it("follows daylight saving", () => {
    expect(zoneOffsetMs(Date.UTC(2025, 0, 15), BUDAPEST)).toBe(3_600_000);
    expect(zoneOffsetMs(Date.UTC(2025, 6, 15), BUDAPEST)).toBe(7_200_000);
  });

  it("handles a half-hour zone", () => {
    expect(zoneOffsetMs(0, KOLKATA)).toBe(19_800_000);
  });

  it("keeps the seconds of a historical offset", () => {
    // Europe/Amsterdam ran on +00:17:30 before 1937. Rounding those seconds
    // away would misplace an hour tick by half a minute.
    expect(zoneOffsetMs(Date.UTC(1890, 0, 1), "Europe/Amsterdam")).toBe(1_050_000);
  });

  it("falls back to zero when the engine reports a bare GMT", () => {
    // Some ICU builds format a zero offset as "GMT" with no digits. The
    // fallback is unreachable on this engine, so it is stubbed rather than
    // left as an untested branch in a cross-engine code path.
    class BareGmtFormat {
      format(): string {
        return "1/1/1970, GMT";
      }
    }
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: BareGmtFormat });
    try {
      expect(zoneOffsetMs(0, "Test/BareGmt")).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an unknown zone and a non-time", () => {
    expect(() => zoneOffsetMs(0, "Nowhere/Nothing")).toThrow(RangeError);
    expect(() => zoneOffsetMs(Number.NaN)).toThrow(/Invalid time value/);
  });
});

describe("leap years and month lengths", () => {
  it("knows the century rule", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("measures months", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
    // Out of range, from arithmetic that overflowed: 30 is the safe answer.
    expect(daysInMonth(2025, 13)).toBe(30);
  });
});

describe("parts and instants", () => {
  it("reads wall-clock fields in a zone", () => {
    const parts = toCalendarParts(Date.UTC(2025, 2, 15, 14, 37, 42, 123), KOLKATA);
    expect(parts).toEqual({
      year: 2025,
      month: 3,
      day: 15,
      hour: 20,
      minute: 7,
      second: 42,
      millisecond: 123,
    });
  });

  it("round-trips through a zone", () => {
    const instant = Date.UTC(2025, 6, 4, 9, 30, 15, 500);
    for (const timeZone of [DEFAULT_TIME_ZONE, BUDAPEST, KOLKATA, "America/New_York"]) {
      expect(fromCalendarParts(toCalendarParts(instant, timeZone), timeZone)).toBe(instant);
    }
  });

  it("survives a two-digit year", () => {
    // `Date.UTC(50, ...)` means 1950. The engine has to mean the year 50.
    const instant = wall(DEFAULT_TIME_ZONE, 50, 3, 15);
    expect(toCalendarParts(instant).year).toBe(50);
    expect(new Date(instant).toISOString()).toBe("0050-03-15T00:00:00.000Z");
  });

  it("reaches the millennium end of the range", () => {
    const instant = wall(DEFAULT_TIME_ZONE, 1000, 1, 1);
    expect(toCalendarParts(instant)).toMatchObject({ year: 1000, month: 1, day: 1 });
  });

  it("counts years before the era astronomically", () => {
    const parts: CalendarParts = {
      year: -500,
      month: 7,
      day: 4,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
    expect(toCalendarParts(fromCalendarParts(parts))).toEqual(parts);
  });

  it("resolves a wall-clock time that does not exist to the end of the gap", () => {
    // Europe/Budapest skips 02:00-03:00 on 2025-03-30.
    const missing = wall(BUDAPEST, 2025, 3, 30, 2, 30);
    expect(toCalendarParts(missing, BUDAPEST)).toMatchObject({ hour: 3, minute: 30 });
  });
});

describe("a wall-clock time that happens twice (R32)", () => {
  it("is the first of the two, east and west of Greenwich alike", () => {
    // New York read 01:30 as the earlier (EDT) and Budapest 02:30 as the
    // later (CET): the second pass converged on whichever offset the first
    // guess fell on. Temporal's "compatible", which the comment promised, is
    // the earlier one.
    expect(new Date(wall("America/New_York", 2026, 11, 1, 1, 30)).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(new Date(wall(BUDAPEST, 2026, 10, 25, 2, 30)).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(new Date(wall("Australia/Lord_Howe", 2026, 4, 5, 1, 45)).toISOString()).toBe("2026-04-04T14:45:00.000Z");
    // So a day after 02:30 summer time is the first 02:30, still summer
    // time, 24 hours on — it was the second, 25 hours on.
    const before = wall(BUDAPEST, 2026, 10, 24, 2, 30);
    expect(addCalendar(before, "day", 1, BUDAPEST) - before).toBe(24 * 3_600_000);
  });

  it("still lands past a gap, and round-trips every instant around both changes", () => {
    expect(new Date(wall("America/New_York", 2026, 3, 8, 2, 30)).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(new Date(wall(BUDAPEST, 2026, 3, 29, 2, 30)).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    for (const [zone, change] of [
      ["America/New_York", Date.UTC(2026, 10, 1, 6)],
      [BUDAPEST, Date.UTC(2026, 9, 25, 1)],
      ["Australia/Lord_Howe", Date.UTC(2026, 3, 4, 15)],
      ["Pacific/Chatham", Date.UTC(2026, 3, 4, 14)],
    ] as const) {
      for (let t = change - 3 * 3_600_000; t <= change + 3 * 3_600_000; t += 15 * 60_000) {
        const back = fromCalendarParts(toCalendarParts(t, zone), zone);
        // The second of an hour that happens twice reads back as the first.
        expect(back === t || (back < t && toCalendarParts(back, zone).hour === toCalendarParts(t, zone).hour), `${zone} ${new Date(t).toISOString()}`).toBe(true);
      }
    }
  });
});

describe("the zone's offset, remembered (R34)", () => {
  it("asks Intl once per hour of a zone, and gives the same offsets", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype as unknown as { format: unknown }, "format", "get");
    try {
      const zone = "America/Sao_Paulo";
      const day = Date.UTC(2026, 5, 1);
      const first = Array.from({ length: 1000 }, (_, i) => zoneOffsetMs(day + (i % 10) * 60_000, zone));
      const calls = spy.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      // Ten minutes of one hour, a thousand times: a couple of calls, not a thousand.
      expect(calls).toBeLessThanOrEqual(3);
      expect(new Set(first)).toEqual(new Set([-3 * 3_600_000]));
    } finally {
      spy.mockRestore();
    }
    // An hour a change falls in is not remembered whole: each side keeps its offset.
    expect(zoneOffsetMs(Date.UTC(2026, 3, 4, 14, 59), "Australia/Lord_Howe")).toBe(11 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 3, 4, 15, 0), "Australia/Lord_Howe")).toBe(10.5 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 3, 4, 15, 1), "Australia/Lord_Howe")).toBe(10.5 * 3_600_000);
  });
});

describe("startOf", () => {
  const reference = Date.UTC(2025, 2, 15, 14, 37, 42, 123);
  const iso = (t: number): string => new Date(t).toISOString();

  it("truncates every granularity", () => {
    expect(iso(startOf(reference, "millisecond"))).toBe("2025-03-15T14:37:42.123Z");
    expect(iso(startOf(reference, "second"))).toBe("2025-03-15T14:37:42.000Z");
    expect(iso(startOf(reference, "minute"))).toBe("2025-03-15T14:37:00.000Z");
    expect(iso(startOf(reference, "hour"))).toBe("2025-03-15T14:00:00.000Z");
    expect(iso(startOf(reference, "day"))).toBe("2025-03-15T00:00:00.000Z");
    expect(iso(startOf(reference, "month"))).toBe("2025-03-01T00:00:00.000Z");
    expect(iso(startOf(reference, "year"))).toBe("2025-01-01T00:00:00.000Z");
    expect(iso(startOf(reference, "decade"))).toBe("2020-01-01T00:00:00.000Z");
    expect(iso(startOf(reference, "century"))).toBe("2000-01-01T00:00:00.000Z");
    expect(iso(startOf(reference, "millennium"))).toBe("2000-01-01T00:00:00.000Z");
  });

  it("starts the day on the zone's wall clock, not on a UTC hour", () => {
    // Asia/Kolkata is +05:30: midnight there is 18:30 UTC the day before.
    expect(iso(startOf(reference, "day", KOLKATA))).toBe("2025-03-14T18:30:00.000Z");
  });
});

describe("addCalendar", () => {
  it("treats hours as durations and days as calendar steps", () => {
    const noon = wall(BUDAPEST, 2025, 3, 29, 12);
    const nextDay = addCalendar(noon, "day", 1, BUDAPEST);
    const in24Hours = addCalendar(noon, "hour", 24, BUDAPEST);

    // Budapest springs forward overnight, so the next day's noon is 23 hours
    // away — the wall clock is preserved, the duration is not.
    expect(toCalendarParts(nextDay, BUDAPEST)).toMatchObject({ day: 30, hour: 12 });
    expect(nextDay - noon).toBe(23 * 3_600_000);
    // Twenty-four hours later is 13:00, which is the other half of the same
    // distinction, and the reason both exist.
    expect(toCalendarParts(in24Hours, BUDAPEST)).toMatchObject({ day: 30, hour: 13 });
    expect(in24Hours - noon).toBe(24 * 3_600_000);
  });

  it("adds the finer fixed units", () => {
    const t = Date.UTC(2025, 0, 1);
    expect(addCalendar(t, "millisecond", 250)).toBe(t + 250);
    expect(addCalendar(t, "second", 90)).toBe(t + 90_000);
    expect(addCalendar(t, "minute", -30)).toBe(t - 1_800_000);
  });

  it("clamps a month step to the end of a shorter month", () => {
    const jan31 = wall(DEFAULT_TIME_ZONE, 2025, 1, 31);
    expect(toCalendarParts(addCalendar(jan31, "month", 1))).toMatchObject({ month: 2, day: 28 });
    expect(toCalendarParts(addCalendar(jan31, "month", 13))).toMatchObject({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("steps months backwards across a year boundary", () => {
    const jan15 = wall(DEFAULT_TIME_ZONE, 2025, 1, 15);
    expect(toCalendarParts(addCalendar(jan15, "month", -2))).toMatchObject({
      year: 2024,
      month: 11,
      day: 15,
    });
  });

  it("clamps a leap day when the year has none", () => {
    const leapDay = wall(DEFAULT_TIME_ZONE, 2024, 2, 29);
    expect(toCalendarParts(addCalendar(leapDay, "year", 1))).toMatchObject({
      year: 2025,
      month: 2,
      day: 28,
    });
  });

  it("steps the coarse granularities by whole years", () => {
    const y2000 = wall(DEFAULT_TIME_ZONE, 2000, 1, 1);
    expect(toCalendarParts(addCalendar(y2000, "decade", 2)).year).toBe(2020);
    expect(toCalendarParts(addCalendar(y2000, "century", -1)).year).toBe(1900);
    expect(toCalendarParts(addCalendar(y2000, "millennium", 1)).year).toBe(3000);
  });

  it("rejects a non-time and a non-count", () => {
    expect(() => addCalendar(Number.NaN, "day", 1)).toThrow(/Invalid time value/);
    expect(() => addCalendar(0, "day", Number.POSITIVE_INFINITY)).toThrow(/Invalid step count/);
  });
});

describe("isoWeekday", () => {
  it("counts Monday as one and Sunday as seven", () => {
    expect(isoWeekday(wall(DEFAULT_TIME_ZONE, 2025, 3, 17))).toBe(1);
    expect(isoWeekday(wall(DEFAULT_TIME_ZONE, 2025, 3, 15))).toBe(6);
    expect(isoWeekday(wall(DEFAULT_TIME_ZONE, 2025, 3, 16))).toBe(7);
  });

  it("answers for the zone's own day, not UTC's", () => {
    // 23:30 Sunday in Kolkata is still Sunday there and Sunday in UTC too;
    // 02:00 Monday in Kolkata is Sunday 20:30 UTC, and the zone wins.
    expect(isoWeekday(wall(KOLKATA, 2025, 3, 17, 2), KOLKATA)).toBe(1);
    expect(isoWeekday(wall(KOLKATA, 2025, 3, 17, 2))).toBe(7);
  });
});
