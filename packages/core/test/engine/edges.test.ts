/**
 * The engine at the edges of its own range and of the wall clock.
 *
 * Each case here was a reproduced crash or a wrong answer found in the
 * quality round before 1.0 (the E-items in `sdk/quality/PLAN.md`).
 */
import { describe, expect, it } from "vitest";

import { addCalendar, fromCalendarParts, isoWeekday, startOf, toCalendarParts } from "../../src/calendar.js";
import { createInputMachine } from "../../src/input.js";
import { renderTimeline } from "../../src/render.js";
import { MAX_TIME_MS } from "../../src/scale.js";
import { generateTicks } from "../../src/ticks.js";
import type { Domain } from "../../src/types.js";

const DAY = 86_400_000;
const ZONES = ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"];

describe("the edge of the representable range (E1)", () => {
  const edges: readonly (readonly [string, Domain])[] = [
    ["all of it", [-MAX_TIME_MS, MAX_TIME_MS]],
    ["the last 400 days", [MAX_TIME_MS - 400 * DAY, MAX_TIME_MS]],
    ["the last three hours", [MAX_TIME_MS - 3 * 3_600_000, MAX_TIME_MS]],
    ["the first three days", [-MAX_TIME_MS, -MAX_TIME_MS + 3 * DAY]],
    ["the first 800 days", [-MAX_TIME_MS, -MAX_TIME_MS + 800 * DAY]],
  ];
  for (const [name, domain] of edges) {
    for (const timeZone of ZONES) {
      it(`draws ${name} in ${timeZone}`, () => {
        const ticks = generateTicks(domain, 900, { timeZone });
        expect(ticks.length).toBeGreaterThan(0);
        for (const tick of ticks) {
          expect(tick.time).toBeGreaterThanOrEqual(domain[0]);
          expect(tick.time).toBeLessThanOrEqual(domain[1]);
        }
        const frame = renderTimeline({ items: [], domain, width: 900, height: 300, timeZone });
        expect(frame.scene.tag).toBe("svg");
      });
    }
  }

  it("survives zooming all the way out and panning past the edge", () => {
    const machine = createInputMachine({ domain: [Date.UTC(2025, 0, 1), Date.UTC(2025, 0, 8)], mainSize: 900 });
    for (let i = 0; i < 40; i += 1) {
      machine.zoom(0.25, 450);
      renderTimeline({ items: [], domain: machine.domain, width: 900, height: 300, timeZone: "Asia/Tokyo" });
    }
    expect(machine.domain).toEqual([-MAX_TIME_MS, MAX_TIME_MS]);
    for (let i = 0; i < 4; i += 1) {
      machine.zoom(64, 0);
    }
    for (let i = 0; i < 20; i += 1) {
      machine.pan(-1e12);
      renderTimeline({ items: [], domain: machine.domain, width: 900, height: 300, timeZone: "America/New_York" });
    }
    expect(machine.domain[0]).toBe(-MAX_TIME_MS);
  });

  it("does calendar arithmetic just past the Date range instead of returning NaN", () => {
    // The aligned 5000-year tick before the start of time, and the wall clock
    // of the last instant fourteen hours east of Greenwich.
    expect(startOf(-MAX_TIME_MS, "millennium")).toBe(fromCalendarParts({ year: -272000, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }));
    expect(Number.isFinite(startOf(-MAX_TIME_MS, "millennium"))).toBe(true);
    const wall = toCalendarParts(MAX_TIME_MS, "Pacific/Kiritimati");
    expect(wall.year).toBe(275760);
    expect(Number.isFinite(addCalendar(MAX_TIME_MS, "year", 1))).toBe(true);
    expect(isoWeekday(MAX_TIME_MS)).toBe(6); // 275760-09-13 is a Saturday.
  });

  it("agrees with Date everywhere inside the Date range", () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const samples = [0, -1, 1, -DAY, Date.UTC(2000, 1, 29), Date.UTC(1900, 1, 28, 23, 59, 59, 999), -MAX_TIME_MS, MAX_TIME_MS];
    for (let i = 0; i < 5000; i += 1) {
      samples.push(Math.round((random() * 2 - 1) * MAX_TIME_MS));
    }
    for (const t of samples) {
      const date = new Date(t);
      const parts = toCalendarParts(t);
      expect(parts).toEqual({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        millisecond: date.getUTCMilliseconds(),
      });
      expect(fromCalendarParts(parts)).toBe(t);
      const sundayFirst = date.getUTCDay();
      expect(isoWeekday(t)).toBe(sundayFirst === 0 ? 7 : sundayFirst);
    }
    // Overflowing fields normalise as Date's setters do.
    expect(fromCalendarParts({ year: 2024, month: 14, day: 35, hour: 25, minute: 61, second: 61, millisecond: 1001 })).toBe(
      Date.UTC(2024, 13, 35, 25, 61, 61, 1001),
    );
    expect(fromCalendarParts({ year: 50, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 })).toBe(
      new Date(0).setUTCFullYear(50, 0, 1),
    );
  });
});

describe("an instant past the Date range (E5)", () => {
  it("is rejected where it enters, with a message that names the range", () => {
    for (const start of [9e15, -9e15]) {
      expect(() => renderTimeline({ items: [{ id: "far", start }], domain: [0, DAY], width: 900, height: 300 })).toThrow(
        /Invalid time value: -?9000000000000000\. Expected a valid Date or epoch milliseconds within ±8\.64e15/,
      );
    }
    expect(() => renderTimeline({ items: [{ id: "far", start: 0, end: 9e15 }], domain: [0, DAY], width: 900, height: 300 })).toThrow(
      /within ±8\.64e15/,
    );
  });

  it("still accepts both ends of the range itself", () => {
    expect(() =>
      renderTimeline({ items: [{ id: "edge", start: -MAX_TIME_MS, end: MAX_TIME_MS }], domain: [0, DAY], width: 900, height: 300 }),
    ).not.toThrow();
  });
});
