/**
 * The hidden-dates check: on generated hidden ranges, in both orientations, hidden
 * time is not on the axis, an item across it is drawn without it, and the
 * zoom anchor holds across it.
 *
 * The reference is the slow way: shown time between two instants is their
 * distance less the hidden time in between, read off a plain list of the
 * occurrences — not off the warp's year table.
 */

import { describe, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { createInputMachine } from "../../src/input.js";
import { itemRect, layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale, panDomainBy, zoomDomainAt } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import { createHiddenDates, HIDDEN_BUDGET } from "../../src/tools/hidden.js";
import type { HiddenDateRange } from "../../src/tools/hidden.js";
import type { Domain, Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 2026-01-05 00:00 UTC. */
const MONDAY = Date.UTC(2026, 0, 5);
const SEED = 0x24_d47e;
const CASES = 60;

/** Generated ranges: a nightly one, sometimes a weekend, sometimes fixed stretches. */
function generateRanges(random: () => number): HiddenDateRange[] {
  const ranges: HiddenDateRange[] = [];
  const evening = 16 + Math.floor(random() * 6);
  const morning = 6 + Math.floor(random() * 4);
  ranges.push({ start: MONDAY + evening * HOUR, end: MONDAY + DAY + morning * HOUR, repeat: "daily" });
  if (random() < 0.6) ranges.push({ start: MONDAY - 3 * DAY + evening * HOUR, end: MONDAY + morning * HOUR, repeat: "weekly" });
  const fixed = Math.floor(random() * 3);
  for (let index = 0; index < fixed; index += 1) {
    const start = MONDAY + Math.floor(random() * 40) * DAY + Math.floor(random() * 24) * HOUR;
    ranges.push({ start, end: start + (1 + Math.floor(random() * 72)) * HOUR });
  }
  return ranges;
}

/** Every hidden occurrence overlapping `[from, to)`, unmerged, in UTC — the zone of these tests. */
function occurrences(ranges: readonly HiddenDateRange[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const range of ranges) {
    const start = Number(range.start);
    const end = Number(range.end);
    if (range.repeat === undefined) {
      out.push([start, end]);
      continue;
    }
    const period = range.repeat === "daily" ? DAY : 7 * DAY;
    for (let k = Math.floor((from - end) / period) - 1; k <= Math.ceil((to - start) / period) + 1; k += 1) out.push([start + k * period, end + k * period]);
  }
  return out;
}

/** Hidden time in `[from, to)`, the slow way: a sweep over the merged occurrences. */
function hiddenIn(ranges: readonly HiddenDateRange[], from: number, to: number): number {
  const list = occurrences(ranges, from, to)
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let reach = from;
  for (const [a, b] of list) {
    if (b <= reach) continue;
    total += b - Math.max(a, reach);
    reach = b;
  }
  return total;
}

function isHiddenSlow(ranges: readonly HiddenDateRange[], time: number): boolean {
  return occurrences(ranges, time - 8 * DAY, time + 8 * DAY).some(([a, b]) => a <= time && time < b);
}

function walk(node: SceneElement, visit: (node: SceneElement) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

describe("hidden dates — the warp", () => {
  it("[claim:axis-skips-hidden] shows time less the hidden time, nowhere decreasing, and comes back to the earliest instant", () => {
    const random = makeRandom(SEED);
    let checked = 0;
    for (let index = 0; index < CASES; index += 1) {
      const ranges = generateRanges(random);
      const hidden = createHiddenDates(ranges);
      const origin = MONDAY - 10 * DAY + Math.floor(random() * 20) * HOUR;
      let previous = hidden.toShown(origin);
      let time = origin;
      for (let step = 1; step < 120; step += 1) {
        // Forward by 37 minutes to five and a half hours: an instant later than the last.
        time += 37 * 60_000 + Math.floor(random() * 5 * HOUR);
        const shown = hidden.toShown(time);
        expect(shown, `case ${String(index)}`).toBeGreaterThanOrEqual(previous);
        // Between two instants, the axis holds their distance less the hidden time.
        expect(shown - hidden.toShown(origin)).toBe(time - origin - hiddenIn(ranges, origin, time));
        expect(hidden.isHidden(time)).toBe(isHiddenSlow(ranges, time));
        const back = hidden.toReal(shown);
        expect(hidden.toShown(back)).toBe(shown);
        expect(back).toBeLessThanOrEqual(time);
        if (!hidden.isHidden(time)) expect(back).toBe(time);
        previous = shown;
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(CASES * 100);
  });

  it("merges what overlaps, clips to the window, and keeps a stretch across New Year whole", () => {
    const newYear = Date.UTC(2027, 0, 1);
    const hidden = createHiddenDates([
      { start: newYear - 6 * HOUR, end: newYear + 6 * HOUR },
      { start: newYear + 4 * HOUR, end: newYear + 9 * HOUR },
    ]);
    expect(hidden.stretches(newYear - DAY, newYear + DAY)).toEqual([{ start: newYear - 6 * HOUR, end: newYear + 9 * HOUR }]);
    expect(hidden.stretches(newYear, newYear + 2 * HOUR)).toEqual([{ start: newYear, end: newYear + 2 * HOUR }]);
    expect(hidden.stretches(newYear, newYear)).toEqual([]);
    expect(hidden.toShown(newYear + 9 * HOUR) - hidden.toShown(newYear - 6 * HOUR)).toBe(0);
  });

  it("repeats on the wall clock of its zone, across a change of daylight saving", () => {
    // 19:00–09:00 Budapest, from a winter night.
    const winter = Date.UTC(2026, 0, 5, 18);
    const hidden = createHiddenDates([{ start: winter, end: winter + 14 * HOUR, repeat: "daily" }], { timeZone: "Europe/Budapest" });
    // 30 March 2026, summer time (UTC+2): 19:00 local is 17:00 UTC.
    const summer = Date.UTC(2026, 2, 30);
    expect(hidden.isHidden(summer + 16.5 * HOUR)).toBe(false);
    expect(hidden.isHidden(summer + 17.5 * HOUR)).toBe(true);
    expect(hidden.isHidden(summer + 6.5 * HOUR)).toBe(true);
    expect(hidden.isHidden(summer + 7.5 * HOUR)).toBe(false);
    // The night of the change is an hour shorter.
    const night = hidden.stretches(Date.UTC(2026, 2, 28, 12), Date.UTC(2026, 2, 29, 12));
    expect(night).toHaveLength(1);
    expect((night[0]?.end ?? 0) - (night[0]?.start ?? 0)).toBe(13 * HOUR);
  });

  it("finds a change of offset in a year that starts, turns and ends on one offset: Casablanca's Ramadan", () => {
    // 19:00–09:00 Casablanca. 2024 is UTC+1 but for 10 March – 14 April, UTC+0.
    const january = Date.UTC(2024, 0, 8, 18);
    const hidden = createHiddenDates([{ start: january, end: january + 14 * HOUR, repeat: "daily" }], { timeZone: "Africa/Casablanca" });
    const ramadan = Date.UTC(2024, 2, 20);
    expect(hidden.isHidden(ramadan + 18.5 * HOUR)).toBe(false);
    expect(hidden.isHidden(ramadan + 19.5 * HOUR)).toBe(true);
    expect(hidden.isHidden(ramadan + 8.5 * HOUR)).toBe(true);
    expect(hidden.isHidden(ramadan + 9.5 * HOUR)).toBe(false);
    // Before it, on UTC+1, the night is an hour earlier.
    const before = Date.UTC(2024, 2, 1);
    expect(hidden.isHidden(before + 18.5 * HOUR)).toBe(true);
    expect(hidden.isHidden(before + 8.5 * HOUR)).toBe(false);
  });

  it("repeats by calendar months and years, held to a month's last day", () => {
    const start = Date.UTC(2026, 0, 31);
    const monthly = createHiddenDates([{ start, end: start + DAY, repeat: "monthly" }]);
    expect(monthly.isHidden(Date.UTC(2026, 1, 28, 12))).toBe(true);
    expect(monthly.isHidden(Date.UTC(2026, 2, 31, 12))).toBe(true);
    expect(monthly.isHidden(Date.UTC(2026, 2, 30, 12))).toBe(false);
    const yearly = createHiddenDates([{ start: Date.UTC(2026, 11, 24), end: Date.UTC(2026, 11, 27), repeat: "yearly" }]);
    expect(yearly.isHidden(Date.UTC(1999, 11, 25))).toBe(true);
    expect(yearly.isHidden(Date.UTC(2031, 11, 26, 23))).toBe(true);
    expect(yearly.isHidden(Date.UTC(2031, 11, 27))).toBe(false);
  });

  it("refuses what cannot be hidden, and hides nothing without ranges", () => {
    expect(() => createHiddenDates([{ start: MONDAY, end: MONDAY }])).toThrow(RangeError);
    expect(() => createHiddenDates([{ start: MONDAY, end: MONDAY + DAY, repeat: "daily" }])).toThrow(/shorter than its period/);
    expect(() => createHiddenDates([{ start: MONDAY, end: MONDAY + HOUR, repeat: "hourly" as "daily" }])).toThrow(/Unknown repeat/);
    const none = createHiddenDates([]);
    expect(none.toShown(MONDAY)).toBe(MONDAY);
    expect(none.toReal(MONDAY)).toBe(MONDAY);
    expect(none.stretches(MONDAY, MONDAY + DAY)).toEqual([]);
  });

  it("stops expanding at its budget, and past it hides nothing — still monotone, still invertible", () => {
    const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }]);
    hidden.toShown(MONDAY);
    const far = Date.UTC(2026 + Math.ceil(HIDDEN_BUDGET / 365) + 50, 5, 1);
    expect(hidden.isHidden(far + 22 * HOUR)).toBe(false);
    const a = hidden.toShown(far);
    const b = hidden.toShown(far + DAY);
    expect(b - a).toBe(DAY);
    expect(hidden.toReal(a)).toBe(far);
    const before = Date.UTC(2026 - Math.ceil(HIDDEN_BUDGET / 365) - 50, 5, 1);
    expect(hidden.toShown(before + DAY) - hidden.toShown(before)).toBe(DAY);
    expect(hidden.toReal(hidden.toShown(before))).toBe(before);
  });
});

describeBothOrientations("hidden dates — the frame", (orientation) => {
  it("[claim:axis-skips-hidden] gives hidden time no room: a stretch's two ends are one pixel, and no tick is drawn inside it but at its seam", () => {
    const random = makeRandom(SEED + 1);
    let seams = 0;
    for (let index = 0; index < CASES / 2; index += 1) {
      const ranges = generateRanges(random);
      const hidden = createHiddenDates(ranges);
      const from = MONDAY + Math.floor(random() * 10) * DAY;
      const domain: Domain = [from, from + (2 + Math.floor(random() * 12)) * DAY];
      const mainSize = 600 + Math.floor(random() * 600);
      const scale = createTimeScale(domain, mainSize, hidden);
      for (const stretch of hidden.stretches(domain[0], domain[1])) {
        expect(scale.toMain(stretch.end)).toBeCloseTo(scale.toMain(stretch.start), 9);
        seams += 1;
      }
      // The axis is the shown span, end to end.
      expect(scale.toMain(domain[1]) - scale.toMain(domain[0])).toBeCloseTo(mainSize, 6);
      const result = renderTimeline({ items: [], domain, width: orientation === "horizontal" ? mainSize : 400, height: orientation === "horizontal" ? 300 : mainSize, orientation, hiddenDates: hidden });
      const positions = result.ticks.map((tick) => scale.toMain(tick.time));
      // One tick a position: a seam's swallowed ticks became one.
      expect(new Set(positions.map((at) => at.toFixed(6))).size).toBe(positions.length);
      for (const tick of result.ticks) {
        if (!hidden.isHidden(tick.time)) continue;
        // A hidden tick sits on its stretch's seam: the stretch's start shows there.
        expect(scale.toMain(tick.time)).toBeCloseTo(scale.toMain(hidden.toReal(hidden.toShown(tick.time))), 9);
      }
      let lines = 0;
      walk(result.scene, (node) => {
        if (String(node.attrs?.class ?? "").startsWith("tl-tick") && node.tag === "line") lines += 1;
      });
      expect(lines).toBe(result.ticks.length);
    }
    expect(seams).toBeGreaterThan(CASES);
  });

  it("[claim:item-across] draws an item across a hidden stretch without it, in the scene as in the layout", () => {
    const random = makeRandom(SEED + 2);
    for (let index = 0; index < CASES / 2; index += 1) {
      const ranges = generateRanges(random);
      const hidden = createHiddenDates(ranges);
      const start = MONDAY + Math.floor(random() * 6) * DAY + (8 + Math.floor(random() * 8)) * HOUR;
      const items: Item[] = [{ id: "across", start, end: start + (1 + Math.floor(random() * 3)) * DAY + Math.floor(random() * 10) * HOUR, label: "Across" }];
      const domain: Domain = [MONDAY, MONDAY + 10 * DAY];
      const mainSize = 1000;
      const scale = createTimeScale(domain, mainSize, hidden);
      const rect = itemRect(layoutItems(items).items[0] as never, scale);
      const shownMs = hidden.toShown(Number(items[0]?.end)) - hidden.toShown(start);
      expect(rect.mainSize).toBeCloseTo(shownMs / scale.msPerPx, 6);
      expect(shownMs).toBe(Number(items[0]?.end) - start - hiddenIn(ranges, start, Number(items[0]?.end)));
      const result = renderTimeline({ items, domain, width: orientation === "horizontal" ? mainSize : 300, height: orientation === "horizontal" ? 300 : mainSize, orientation, hiddenDates: hidden });
      let drawn: SceneElement | undefined;
      walk(result.scene, (node) => {
        if (node.attrs?.["data-tl-id"] === "across" && node.tag === "rect") drawn ??= node;
        if (node.attrs?.["data-tl-id"] === "across" && drawn === undefined) {
          for (const child of node.children ?? []) if (child.tag === "rect") drawn ??= child;
        }
      });
      expect(drawn).toBeDefined();
      const size = Number(orientation === "horizontal" ? drawn?.attrs?.width : drawn?.attrs?.height);
      // An item wholly in hidden time is drawn at the renderer's floor, as any instant is.
      expect(size).toBeCloseTo(Math.max(rect.mainSize, densityMetrics("comfortable", orientation).minItemMainSize), 1);
    }
  });

  it("[claim:zoom-anchor] holds the instant under the focus across a hidden stretch — the scale's zoom, and the machine's wheel", () => {
    const random = makeRandom(SEED + 3);
    let held = 0;
    for (let index = 0; index < CASES; index += 1) {
      const ranges = generateRanges(random);
      const hidden = createHiddenDates(ranges);
      const from = MONDAY + Math.floor(random() * 10) * DAY;
      const domain: Domain = [from, from + (3 + Math.floor(random() * 10)) * DAY];
      const mainSize = 800;
      const focus = 20 + random() * (mainSize - 40);
      const factor = random() < 0.5 ? 1.25 + random() * 3 : 1 / (1.25 + random() * 3);
      const before = createTimeScale(domain, mainSize, hidden).toTime(focus);
      const zoomed = zoomDomainAt(domain, mainSize, focus, factor, { warp: hidden });
      const after = createTimeScale(zoomed, mainSize, hidden).toTime(focus);
      // On a seam two instants share the pixel; off one, the instant is the instant.
      if (hidden.isHidden(before)) expect(hidden.toShown(after)).toBeCloseTo(hidden.toShown(before), 0);
      else expect(Math.abs(after - before)).toBeLessThan(2);
      // The machine's wheel ends in the same function.
      const machine = createInputMachine({ domain, mainSize, orientation, hiddenDates: hidden });
      const point = orientation === "horizontal" ? { x: focus, y: 40 } : { x: 40, y: focus };
      const effects = machine.wheel({ ...point, deltaX: 0, deltaY: -120, ctrlKey: true, shiftKey: false, time: 0 });
      const viewport = effects.find((effect) => effect.type === "viewport");
      expect(viewport).toBeDefined();
      if (viewport?.type === "viewport") {
        const wheelAfter = createTimeScale(viewport.domain, mainSize, hidden).toTime(focus);
        if (!hidden.isHidden(before)) expect(Math.abs(wheelAfter - before)).toBeLessThan(2);
      }
      held += 1;
    }
    expect(held).toBe(CASES);
  });

  it("keeps both instants of a pinch under their fingers, with the nights hidden (R7)", () => {
    const hidden = createHiddenDates([{ start: MONDAY + 18 * HOUR, end: MONDAY + DAY + 8 * HOUR, repeat: "daily" }]);
    const domain: Domain = [MONDAY + 8 * HOUR, MONDAY + 14 * DAY + 18 * HOUR];
    const mainSize = 1000;
    const machine = createInputMachine({ domain, mainSize, orientation, hiddenDates: hidden });
    const before = createTimeScale(domain, mainSize, hidden);
    const a = before.toTime(200);
    const b = before.toTime(600);
    const touch = (id: number, phase: "down" | "move", main: number, time: number) =>
      machine.handle({ pointerId: id, phase, ...(orientation === "horizontal" ? { x: main, y: 40 } : { x: 40, y: main }), time, pointerType: "touch" });
    touch(1, "down", 200, 0);
    touch(2, "down", 600, 10);
    for (const [step, x] of [700, 800, 900].entries()) touch(2, "move", x, 20 + 10 * step);
    const after = createTimeScale(machine.domain, mainSize, hidden);
    // A real-time ratio put the second instant 32 px off its finger (R7).
    expect(Math.abs(after.toMain(a) - 200)).toBeLessThan(0.5);
    expect(Math.abs(after.toMain(b) - 900)).toBeLessThan(0.5);
  });

  it("pans by shown time: a pan of the whole view moves it by its shown span, past the hidden time", () => {
    const hidden = createHiddenDates([{ start: MONDAY + 18 * HOUR, end: MONDAY + DAY + 8 * HOUR, repeat: "daily" }]);
    const domain: Domain = [MONDAY + 8 * HOUR, MONDAY + 18 * HOUR];
    const panned = panDomainBy(domain, 1000, 1000, hidden);
    // A working day later — the night is not a pan's distance. The window
    // starts on the seam, where the night collapsed onto its evening, which
    // shows as the next morning.
    expect(panned[0]).toBe(MONDAY + 18 * HOUR);
    expect(hidden.toShown(panned[0])).toBe(hidden.toShown(MONDAY + DAY + 8 * HOUR));
    expect(panned[1]).toBe(MONDAY + DAY + 18 * HOUR);
  });

  it("draws an empty frame for a window wholly inside hidden time", () => {
    const hidden = createHiddenDates([{ start: MONDAY, end: MONDAY + 10 * DAY }]);
    const result = renderTimeline({ items: [], domain: [MONDAY + DAY, MONDAY + 2 * DAY], width: 600, height: 300, orientation, hiddenDates: hidden });
    expect(result.ticks).toEqual([]);
    expect(result.visibleCount).toBe(0);
  });
});
