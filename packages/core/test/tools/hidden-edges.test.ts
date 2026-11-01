/**
 * Hidden dates and the overview strip at their edges: a zone without
 * daylight saving, the end of time, an instant before a year's first
 * stretch, the warp read backwards first, open items on the strip.
 */

import { describe, expect, it } from "vitest";

import { layoutItems } from "../../src/layout.js";
import { generateTicks } from "../../src/ticks.js";
import { createHiddenDates, HIDDEN_BUDGET } from "../../src/tools/hidden.js";
import { minimapExtent, minimapGeometry, minimapNodes } from "../../src/tools/minimap.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 2026-01-05 00:00 UTC. */
const MONDAY = Date.UTC(2026, 0, 5);
/** The last instant a Date can hold. */
const END_OF_TIME = 8.64e15;

describe("hidden dates at the edges", () => {
  it("repeats on the wall clock of a zone that never changes its offset", () => {
    // 18:00–09:00 in Tokyo (UTC+9, no daylight saving): 09:00–24:00 UTC.
    const hidden = createHiddenDates([{ start: MONDAY + 9 * HOUR, end: MONDAY + DAY, repeat: "daily" }], { timeZone: "Asia/Tokyo" });
    const july = Date.UTC(2026, 6, 15);
    expect(hidden.isHidden(july + 8.5 * HOUR)).toBe(false);
    expect(hidden.isHidden(july + 9 * HOUR)).toBe(true);
    expect(hidden.isHidden(july + 23.5 * HOUR)).toBe(true);
    expect(hidden.toShown(july + DAY) - hidden.toShown(july)).toBe(9 * HOUR);
  });

  it("works at the end of time, in UTC and in a zone", () => {
    for (const timeZone of ["UTC", "Europe/Budapest"]) {
      const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }], { timeZone });
      const late = END_OF_TIME - 3 * DAY;
      const shown = hidden.toShown(late);
      expect(Number.isFinite(shown)).toBe(true);
      expect(hidden.toShown(END_OF_TIME)).toBeGreaterThanOrEqual(shown);
      expect(hidden.toReal(shown)).toBeLessThanOrEqual(late);
    }
  });

  it("counts a fixed stretch of an earlier year only in that year, and an instant before a year's first stretch", () => {
    const hidden = createHiddenDates([
      { start: Date.UTC(2025, 5, 1), end: Date.UTC(2025, 5, 3) },
      { start: Date.UTC(2026, 5, 1), end: Date.UTC(2026, 5, 2) },
    ]);
    const january = Date.UTC(2026, 0, 10);
    // Before 2026's own stretch, only 2025's two days are behind.
    expect(hidden.toShown(Date.UTC(2026, 6, 1)) - hidden.toShown(january)).toBe(Date.UTC(2026, 6, 1) - january - DAY);
    expect(hidden.toReal(hidden.toShown(january))).toBe(january);
    expect(hidden.isHidden(january)).toBe(false);
    expect(hidden.stretches(Date.UTC(2025, 0, 1), Date.UTC(2027, 0, 1))).toEqual([
      { start: Date.UTC(2025, 5, 1), end: Date.UTC(2025, 5, 3) },
      { start: Date.UTC(2026, 5, 1), end: Date.UTC(2026, 5, 2) },
    ]);
  });

  it("reads backwards first: toReal before any toShown, and forward into years not yet expanded", () => {
    // Nights 20:00–04:00: a day shows 16 hours.
    const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }]);
    const noon = MONDAY + 12 * HOUR;
    const shownNoon = hidden.toShown(noon);
    const fresh = createHiddenDates(hidden.ranges);
    expect(fresh.toReal(shownNoon)).toBe(noon);
    // Three years on, at noon: as many days, each 16 hours shown.
    const later = noon + 1096 * DAY;
    const other = createHiddenDates(hidden.ranges);
    expect(other.toReal(other.toShown(noon) + 1096 * 16 * HOUR)).toBe(later);
  });

  it("past its budget, has no stretches to give", () => {
    const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }]);
    hidden.toShown(MONDAY);
    const far = Date.UTC(2026 + Math.ceil(HIDDEN_BUDGET / 365) + 50, 5, 1);
    hidden.toShown(far);
    expect(hidden.stretches(far, far + 2 * DAY)).toEqual([]);
    // Within the budget, the night's two ends in the day.
    expect(hidden.stretches(MONDAY, MONDAY + DAY)).toEqual([
      { start: MONDAY, end: MONDAY + 4 * HOUR },
      { start: MONDAY + 20 * HOUR, end: MONDAY + DAY },
    ]);
  });

  it("ticks the plain way for a window with no shown time, and in a zone it is told", () => {
    const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }]);
    const night = [MONDAY + 21 * HOUR, MONDAY + 23 * HOUR] as const;
    expect(hidden.ticks(night, 800, {})).toEqual(generateTicks(night, 800, {}));
    // In Budapest, a day's tick is at 23:00 UTC: the night hides it, and the seam names the day.
    const ticks = hidden.ticks([MONDAY, MONDAY + 5 * DAY], 400, { timeZone: "Europe/Budapest" });
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) expect(tick.time).toBeGreaterThanOrEqual(MONDAY);
  });
});

describe("the overview strip's edges", () => {
  it("spans an open item to its start, and draws it to the strip's end", () => {
    const items = [
      { id: "open", start: MONDAY + 2 * DAY, open: true },
      { id: "shut", start: MONDAY, end: MONDAY + DAY },
    ];
    const layout = layoutItems(items);
    const domain = [MONDAY, MONDAY + DAY] as const;
    const extent = minimapExtent(layout, domain);
    const span = 2 * DAY;
    expect(extent).toEqual([MONDAY - span / 50, MONDAY + 2 * DAY + span / 50]);
    const geometry = minimapGeometry(extent, domain, 500);
    const [, path] = minimapNodes(layout, geometry, { orientation: "horizontal", cross: 100, size: 36 });
    const widths = [...String(path?.attrs?.d).matchAll(/h(-?[\d.]+)v/g)].map((match) => Number(match[1]));
    const openFrom = geometry.scale.toMain(MONDAY + 2 * DAY);
    expect(widths).toContainEqual(Math.round((500 - openFrom) * 10) / 10);
  });

  it("leaves out an item off the strip, and draws no path when none is on it", () => {
    const layout = layoutItems([{ id: "far", start: MONDAY + 100 * DAY, end: MONDAY + 101 * DAY }]);
    const domain = [MONDAY, MONDAY + DAY] as const;
    // A strip over the view alone, not the items' extent: the item is past its end.
    const geometry = minimapGeometry(domain, domain, 500);
    const nodes = minimapNodes(layout, geometry, { orientation: "horizontal", cross: 0, size: 36 });
    expect(nodes.map((node) => node.attrs?.class)).toEqual(["tl-minimap", "tl-minimap-window"]);
  });
});
