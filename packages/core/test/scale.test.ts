import { describe, expect, it } from "vitest";

import {
  clampDomain,
  createTimeScale,
  MAX_TIME_MS,
  MIN_SPAN_MS,
  panDomainBy,
  spanOf,
  zoomDomainAt,
} from "../src/scale.js";
import type { Domain } from "../src/types.js";

const DAY: Domain = [Date.UTC(2025, 2, 15), Date.UTC(2025, 2, 16)];
const MAIN_SIZE = 1000;
const DAY_MS = 86_400_000;

describe("createTimeScale", () => {
  it("maps the domain onto the extent", () => {
    const scale = createTimeScale(DAY, MAIN_SIZE);
    expect(scale.msPerPx).toBe(DAY_MS / MAIN_SIZE);
    expect(scale.toMain(DAY[0])).toBe(0);
    expect(scale.toMain(DAY[1])).toBe(MAIN_SIZE);
    expect(scale.toMain(DAY[0] + DAY_MS / 2)).toBe(MAIN_SIZE / 2);
    expect(scale.domain).toBe(DAY);
    expect(scale.mainSize).toBe(MAIN_SIZE);
  });

  it("inverts exactly at the ends and closely in between", () => {
    const scale = createTimeScale(DAY, MAIN_SIZE);
    expect(scale.toTime(0)).toBe(DAY[0]);
    expect(scale.toTime(MAIN_SIZE)).toBe(DAY[1]);
    expect(scale.toTime(scale.toMain(DAY[0] + 1234))).toBeCloseTo(DAY[0] + 1234, 6);
  });

  it("projects outside the extent for times outside the domain", () => {
    const scale = createTimeScale(DAY, MAIN_SIZE);
    expect(scale.toMain(DAY[0] - DAY_MS)).toBe(-MAIN_SIZE);
    expect(scale.toMain(DAY[1] + DAY_MS)).toBe(2 * MAIN_SIZE);
  });

  it("measures a span", () => {
    expect(spanOf(DAY)).toBe(DAY_MS);
  });

  it("rejects a domain it cannot divide by", () => {
    expect(() => createTimeScale([Number.NaN, 1], MAIN_SIZE)).toThrow(/Invalid domain/);
    expect(() => createTimeScale([0, Number.POSITIVE_INFINITY], MAIN_SIZE)).toThrow(
      /Invalid domain/,
    );
    expect(() => createTimeScale([5, 5], MAIN_SIZE)).toThrow(/at least 1 ms/);
    expect(() => createTimeScale([5, 4], MAIN_SIZE)).toThrow(/at least 1 ms/);
    expect(MIN_SPAN_MS).toBe(1);
  });

  it("rejects an extent it cannot divide by", () => {
    expect(() => createTimeScale(DAY, 0)).toThrow(/positive number of pixels/);
    expect(() => createTimeScale(DAY, -10)).toThrow(/positive number of pixels/);
    expect(() => createTimeScale(DAY, Number.NaN)).toThrow(/positive number of pixels/);
  });
});

describe("zoomDomainAt", () => {
  it("keeps the time under the focus in place", () => {
    for (const focus of [0, 250, MAIN_SIZE / 2, MAIN_SIZE]) {
      const before = createTimeScale(DAY, MAIN_SIZE).toTime(focus);
      for (const factor of [2, 8, 1 / 2, 1 / 8]) {
        const zoomed = zoomDomainAt(DAY, MAIN_SIZE, focus, factor);
        expect(createTimeScale(zoomed, MAIN_SIZE).toTime(focus)).toBeCloseTo(before, 3);
        expect(spanOf(zoomed)).toBeCloseTo(DAY_MS / factor, 3);
      }
    }
  });

  it("is a no-op at factor one", () => {
    const zoomed = zoomDomainAt(DAY, MAIN_SIZE, 123, 1);
    expect(zoomed[0]).toBeCloseTo(DAY[0], 6);
    expect(zoomed[1]).toBeCloseTo(DAY[1], 6);
  });

  it("stops at one millisecond rather than collapsing", () => {
    const zoomed = zoomDomainAt(DAY, MAIN_SIZE, MAIN_SIZE / 2, 1e12);
    expect(spanOf(zoomed)).toBe(MIN_SPAN_MS);
    // Still a usable viewport, which is the point of the floor.
    expect(() => createTimeScale(zoomed, MAIN_SIZE)).not.toThrow();
  });

  it("stays inside the representable range when zoomed all the way out", () => {
    const zoomed = zoomDomainAt(DAY, MAIN_SIZE, MAIN_SIZE / 2, 1e-12);
    expect(zoomed[0]).toBeGreaterThanOrEqual(-MAX_TIME_MS);
    expect(zoomed[1]).toBeLessThanOrEqual(MAX_TIME_MS);
  });

  it("rejects a factor or a focus it cannot use", () => {
    expect(() => zoomDomainAt(DAY, MAIN_SIZE, 0, 0)).toThrow(/positive number/);
    expect(() => zoomDomainAt(DAY, MAIN_SIZE, 0, -2)).toThrow(/positive number/);
    expect(() => zoomDomainAt(DAY, MAIN_SIZE, 0, Number.NaN)).toThrow(/positive number/);
    expect(() => zoomDomainAt(DAY, MAIN_SIZE, Number.NaN, 2)).toThrow(/finite pixel offset/);
  });
});

describe("panDomainBy", () => {
  it("moves the window forward for a positive distance", () => {
    const panned = panDomainBy(DAY, MAIN_SIZE, MAIN_SIZE);
    expect(panned[0]).toBe(DAY[1]);
    expect(spanOf(panned)).toBe(DAY_MS);
  });

  it("moves it backward for a negative one", () => {
    const panned = panDomainBy(DAY, MAIN_SIZE, -MAIN_SIZE / 2);
    expect(panned[0]).toBe(DAY[0] - DAY_MS / 2);
    expect(spanOf(panned)).toBe(DAY_MS);
  });

  it("stops at the ends of the representable range", () => {
    const far = 1e14;
    expect(panDomainBy(DAY, MAIN_SIZE, far)[1]).toBe(MAX_TIME_MS);
    expect(panDomainBy(DAY, MAIN_SIZE, -far)[0]).toBe(-MAX_TIME_MS);
  });

  it("rejects a distance it cannot use", () => {
    expect(() => panDomainBy(DAY, MAIN_SIZE, Number.NaN)).toThrow(/finite pixel offset/);
  });
});

describe("clampDomain", () => {
  it("leaves a domain inside the limits alone", () => {
    expect(clampDomain(DAY)).toEqual([DAY[0], DAY[1]]);
    expect(clampDomain(DAY, { min: DAY[0] - DAY_MS, max: DAY[1] + DAY_MS })).toEqual([
      DAY[0],
      DAY[1],
    ]);
  });

  it("slides a window back inside the bounds without resizing it", () => {
    const clamped = clampDomain(DAY, { min: DAY[0] + DAY_MS / 2 });
    expect(clamped[0]).toBe(DAY[0] + DAY_MS / 2);
    expect(spanOf(clamped)).toBe(DAY_MS);

    const fromAbove = clampDomain(DAY, { max: DAY[0] + DAY_MS / 2 });
    expect(fromAbove[1]).toBe(DAY[0] + DAY_MS / 2);
    expect(spanOf(fromAbove)).toBe(DAY_MS);
  });

  it("accepts Date limits at the boundary", () => {
    const clamped = clampDomain(DAY, { min: new Date(DAY[0] + DAY_MS / 4) });
    expect(clamped[0]).toBe(DAY[0] + DAY_MS / 4);
  });

  it("enforces the narrowest and widest allowed span", () => {
    expect(spanOf(clampDomain(DAY, { minSpanMs: 2 * DAY_MS }))).toBe(2 * DAY_MS);
    expect(spanOf(clampDomain(DAY, { maxSpanMs: DAY_MS / 4 }))).toBe(DAY_MS / 4);
  });

  it("narrows a window that is wider than the allowed range", () => {
    const clamped = clampDomain(DAY, { min: DAY[0], max: DAY[0] + DAY_MS / 2 });
    expect(clamped).toEqual([DAY[0], DAY[0] + DAY_MS / 2]);
  });

  it("prefers the minimum span when the two bounds disagree", () => {
    const clamped = clampDomain(DAY, { minSpanMs: 4 * DAY_MS, maxSpanMs: DAY_MS });
    expect(spanOf(clamped)).toBe(4 * DAY_MS);
  });

  it("rejects limits that leave no room", () => {
    expect(() => clampDomain(DAY, { min: 1000, max: 1000 })).toThrow(/leave no room/);
  });

  it("rejects a domain it cannot clamp", () => {
    expect(() => clampDomain([0, 0])).toThrow(/at least 1 ms/);
  });
});
