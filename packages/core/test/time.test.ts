import { describe, expect, it } from "vitest";
import { toTimeMs } from "../src/time.js";

describe("toTimeMs", () => {
  it("passes a finite number through unchanged", () => {
    expect(toTimeMs(0)).toBe(0);
    expect(toTimeMs(1_761_000_000_000)).toBe(1_761_000_000_000);
    expect(toTimeMs(-62_135_596_800_000)).toBe(-62_135_596_800_000);
  });

  it("converts a Date to epoch milliseconds", () => {
    const date = new Date("2026-10-26T12:00:00.000Z");
    expect(toTimeMs(date)).toBe(date.getTime());
  });

  it("rejects an Invalid Date instead of poisoning the pipeline", () => {
    expect(() => toTimeMs(new Date("not a date"))).toThrow(RangeError);
  });

  it("rejects a value of the wrong type with its own RangeError, not a TypeError from inside (V34)", () => {
    for (const value of ["2026-01-01", null, undefined, {}, true]) expect(() => toTimeMs(value as never), String(value)).toThrow(RangeError);
    // A Date of another realm (a frame's) is still a date.
    expect(toTimeMs({ getTime: () => 5 } as never)).toBe(5);
  });

  it("rejects NaN and the infinities", () => {
    expect(() => toTimeMs(Number.NaN)).toThrow(RangeError);
    expect(() => toTimeMs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toTimeMs(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it("names the offending value in the message", () => {
    expect(() => toTimeMs(Number.NaN)).toThrow(/Invalid time value/);
  });
});
