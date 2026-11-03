/**
 * G-CALENDAR-VIEW: in the week and day views, events that overlap go side by
 * side, none covers another, and every one is reached from the keyboard.
 *
 * On generated weeks — four zones, the weeks the clocks change in among
 * them, short and long events, events across midnight, all-day events,
 * limited hours, a day and a week, left to right and right to left:
 *
 *  - two pieces that overlap as drawn are in different columns, and each
 *    reaches only over columns nothing it overlaps is in (`side-by-side`);
 *  - no two rectangles of the drawing intersect, all-day ones included
 *    (`no-cover`);
 *  - every item that overlaps the view is in it — a timed one on every day
 *    it touches, an all-day one in the band (`complete`);
 *  - from no focus, `next` visits every event exactly once, in reading
 *    order; the day keys go to the nearest event of the next day that has
 *    one; `Home`/`End` stay in the day (`keyboard`);
 *  - the drawing's options are the keyboard's order, the focused one is the
 *    active descendant, and a click on an event's middle hits that event
 *    (`scene`);
 *  - nine o'clock is on one line across a week in which the clocks change
 *    (`wall-clock`).
 */

import { describe, expect, it } from "vitest";

import { calendarGeometry, calendarHit, calendarKeyStep, calendarScene, calendarTimeAt, layoutDays, wallOf, weekStartOf, instantOf, CALENDAR_STRINGS } from "../../src/calendar/index.js";
import { wallMs } from "../../src/calendar/rrule.js";
import type { DaysLayout } from "../../src/calendar/index.js";
import { pseudoStrings, DEFAULT_STRINGS, PSEUDO_OPEN } from "../../src/intl/index.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

const SEED = Number(process.env.SDK_CALENDAR_VIEW_SEED ?? 2027);
const CASES = 400;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ZONES = ["UTC", "Europe/Budapest", "America/New_York", "Australia/Lord_Howe"] as const;

interface Case {
  readonly items: Item[];
  readonly layout: DaysLayout;
  readonly zone: string;
  readonly start: number;
  readonly days: number;
  readonly rtl: boolean;
}

function generate(seed: number, index: number): Case {
  const random = makeRandom(seed + index);
  const zone = ZONES[index % ZONES.length] ?? "UTC";
  // Weeks with a clock change in them come up often: March, April, October, November.
  const month = [3, 10, 11, 4, 6][index % 5] ?? 3;
  const start = weekStartOf(instantOf(wallMs(2026, month, 1 + Math.floor(random() * 27), 12), zone), zone, 1 + (index % 7));
  const days = index % 5 === 0 ? 1 : 7;
  const items: Item[] = [];
  const count = Math.floor(random() * 45);
  for (let n = 0; n < count; n += 1) {
    const at = start - DAY + Math.floor(random() * (days + 2) * 96) * 15 * MINUTE;
    const kind = random();
    if (kind < 0.12) {
      const first = Math.floor(wallOf(at, zone) / DAY) * DAY;
      items.push({ id: `all${String(n)}`, label: `All-day ${String(n)}`, start: instantOf(first, zone), end: instantOf(first + (1 + Math.floor(random() * 4)) * DAY, zone) });
    } else if (kind < 0.2) {
      items.push({ id: `i${String(n)}`, label: `Instant ${String(n)}`, start: at });
    } else {
      const length = Math.floor(random() * 12) * 15 * MINUTE + (random() < 0.08 ? 30 * HOUR : 0);
      items.push({ id: `e${String(n)}`, label: `Event ${String(n)}`, start: at, end: at + length });
    }
  }
  const hours = index % 3 === 0 ? { dayStartHour: 7, dayEndHour: 20 } : {};
  return { items, zone, start, days, rtl: index % 2 === 1, layout: layoutDays(items, { start, days, timeZone: zone, ...hours }) };
}

const cases = Array.from({ length: CASES }, (_, index) => generate(SEED, index));
const geometryOf = (c: Case) => calendarGeometry(c.layout, { width: 980, height: 760, rtl: c.rtl });

describe("G-CALENDAR-VIEW: side by side", () => {
  it("[claim:side-by-side] pieces that overlap as drawn are in different columns, and reach over no column an overlapping one is in", () => {
    let pairs = 0;
    for (const c of cases) {
      for (const a of c.layout.segments) {
        expect(a.column + a.span).toBeLessThanOrEqual(a.columns);
        for (const b of c.layout.segments) {
          if (a === b || a.day !== b.day || !(a.top < b.bottom && b.top < a.bottom)) continue;
          pairs += 1;
          const disjoint = a.column + a.span <= b.column || b.column + b.span <= a.column;
          expect(disjoint, `${a.key} / ${b.key}`).toBe(true);
          expect(a.columns).toBe(b.columns);
        }
      }
    }
    // The generator has to make overlaps for the claim to say anything.
    expect(pairs).toBeGreaterThan(2000);
  });
});

describe("G-CALENDAR-VIEW: nothing covers anything", () => {
  it("[claim:no-cover] no two rectangles of the drawing intersect, left to right and right to left", () => {
    let rects = 0;
    for (const c of cases) {
      const all = [...geometryOf(c).rects];
      rects += all.length;
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          const [ka, a] = all[i] ?? ["", { x: 0, y: 0, width: 0, height: 0 }];
          const [kb, b] = all[j] ?? ["", { x: 0, y: 0, width: 0, height: 0 }];
          const intersect = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          expect(intersect, `${ka} / ${kb}`).toBe(false);
        }
      }
    }
    expect(rects).toBeGreaterThan(4000);
  });

  it("[claim:no-cover] every rectangle is inside its day's column (or the all-day band) and inside the drawing", () => {
    for (const c of cases) {
      const g = geometryOf(c);
      for (const segment of c.layout.segments) {
        const r = g.rects.get(segment.key);
        const column = g.columns[segment.day];
        expect(r).toBeDefined();
        expect(column).toBeDefined();
        if (r === undefined || column === undefined) continue;
        expect(r.x).toBeGreaterThanOrEqual(column.x);
        expect(r.x + r.width).toBeLessThanOrEqual(column.x + column.width + 1e-9);
        expect(r.y).toBeGreaterThanOrEqual(column.y - 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(column.y + column.height + 1e-9);
      }
      for (const segment of c.layout.allDay) {
        const r = g.rects.get(segment.key);
        expect(r).toBeDefined();
        if (r === undefined) continue;
        expect(r.y).toBeGreaterThanOrEqual(g.allDayBand.y);
        expect(r.y + r.height).toBeLessThanOrEqual(g.allDayBand.y + g.allDayBand.height + 1e-9);
      }
    }
  });
});

describe("G-CALENDAR-VIEW: every event is there", () => {
  it("[claim:complete] a timed item is on every day it touches, an all-day one in the band, and nothing else is", () => {
    for (const c of cases) {
      const viewStart = c.layout.days[0]?.start ?? 0;
      const viewEnd = c.layout.days[c.layout.days.length - 1]?.end ?? 0;
      for (const item of c.items) {
        const s = item.start as number;
        const e = item.end === undefined ? s : (item.end as number);
        const allDay = item.id.startsWith("all");
        if (allDay) {
          const shown = c.layout.allDay.some((segment) => segment.item === item);
          expect(shown, item.id).toBe(s < viewEnd && e > viewStart);
          continue;
        }
        const expected = c.layout.days.filter((day) => (e === s ? s >= day.start && s < day.end : s < day.end && e > day.start)).map((day) => day.index);
        const got = c.layout.segments.filter((segment) => segment.item === item).map((segment) => segment.day);
        expect(got, item.id).toEqual(expected);
      }
    }
  });
});

describe("G-CALENDAR-VIEW: the keyboard", () => {
  it("[claim:keyboard] from no focus, next visits every event once, in reading order", () => {
    for (const c of cases) {
      const visited: string[] = [];
      let key = calendarKeyStep(c.layout, undefined, "next");
      while (key !== undefined && !visited.includes(key)) {
        visited.push(key);
        const next = calendarKeyStep(c.layout, key, "next");
        if (next === key) break;
        key = next;
      }
      expect(visited).toEqual(c.layout.order);
      expect(new Set(c.layout.order).size).toBe(c.layout.segments.length + c.layout.allDay.length);
      // Reading order: by day, the all-day events first, then from the top.
      const place = (k: string): [number, number] => {
        const timed = c.layout.segments.find((segment) => segment.key === k);
        if (timed !== undefined) return [timed.day, timed.top];
        return [c.layout.allDay.find((segment) => segment.key === k)?.first ?? -1, -1];
      };
      for (let i = 1; i < visited.length; i += 1) {
        const [da, ta] = place(visited[i - 1] ?? "");
        const [db, tb] = place(visited[i] ?? "");
        expect(da < db || (da === db && ta <= tb)).toBe(true);
      }
      // And back: previous from the last walks the same list backwards.
      if (visited.length > 0) {
        const back: string[] = [];
        let at: string | undefined = visited[visited.length - 1];
        while (at !== undefined && !back.includes(at)) {
          back.push(at);
          const previous = calendarKeyStep(c.layout, at, "previous");
          if (previous === at) break;
          at = previous;
        }
        expect(back).toEqual([...visited].reverse());
      }
    }
  });

  it("[claim:keyboard] the day keys go to the nearest event of the nearest day that has one; Home and End stay in the day", () => {
    let moves = 0;
    for (const c of cases) {
      const dayOf = (k: string | undefined): number => c.layout.segments.find((segment) => segment.key === k)?.day ?? c.layout.allDay.find((segment) => segment.key === k)?.first ?? -1;
      for (const key of c.layout.order) {
        const day = dayOf(key);
        const right = calendarKeyStep(c.layout, key, "nextDay");
        const later = c.layout.order.map(dayOf).filter((d) => d > day);
        if (later.length === 0) expect(right).toBe(key);
        else {
          expect(dayOf(right)).toBe(Math.min(...later));
          moves += 1;
        }
        const left = calendarKeyStep(c.layout, key, "previousDay");
        const earlier = c.layout.order.map(dayOf).filter((d) => d < day);
        expect(dayOf(left)).toBe(earlier.length === 0 ? day : Math.max(...earlier));
        expect(dayOf(calendarKeyStep(c.layout, key, "dayStart"))).toBe(day);
        expect(dayOf(calendarKeyStep(c.layout, key, "dayEnd"))).toBe(day);
        expect(calendarKeyStep(c.layout, key, "first")).toBe(c.layout.order[0]);
        expect(calendarKeyStep(c.layout, key, "last")).toBe(c.layout.order[c.layout.order.length - 1]);
        for (const action of ["nextPeriod", "previousPeriod", "today", "activate"] as const) expect(calendarKeyStep(c.layout, key, action)).toBe(key);
      }
    }
    expect(moves).toBeGreaterThan(1000);
  });

  it("[claim:keyboard] an empty view has nothing to focus", () => {
    const layout = layoutDays([], { start: 0 });
    expect(calendarKeyStep(layout, undefined, "next")).toBeUndefined();
    expect(layout.order).toEqual([]);
  });
});

function walk(node: SceneElement, visit: (node: SceneElement) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

describe("G-CALENDAR-VIEW: the drawing", () => {
  it("[claim:scene] the options are the keyboard's order, named, with the focused one the active descendant", () => {
    for (const c of cases.slice(0, 120)) {
      const focused = c.layout.order[Math.floor(c.layout.order.length / 2)];
      const scene = calendarScene(c.layout, { width: 980, height: 760, rtl: c.rtl, idPrefix: "t", ...(focused === undefined ? {} : { focusedKey: focused }) });
      const options: SceneElement[] = [];
      walk(scene, (node) => {
        if (node.attrs?.role === "option") options.push(node);
      });
      expect(options.map((node) => node.attrs?.["data-tl-id"])).toEqual(c.layout.order);
      for (const node of options) expect(String(node.attrs?.["aria-label"])).toMatch(/^(Event|Instant|All-day) \d+, /);
      expect(scene.attrs?.role).toBe("listbox");
      expect(scene.attrs?.tabindex).toBe(0);
      if (focused !== undefined) expect(options.find((node) => node.attrs?.id === scene.attrs?.["aria-activedescendant"])?.attrs?.["data-tl-id"]).toBe(focused);
    }
  });

  it("[claim:scene] a click on an event's middle hits that event, and a click on an empty slot is a time in that day", () => {
    for (const c of cases) {
      const g = geometryOf(c);
      for (const [key, r] of g.rects) expect(calendarHit(g, r.x + r.width / 2, r.y + r.height / 2)).toBe(key);
      expect(calendarHit(g, -10, -10)).toBeUndefined();
      const column = g.columns[0];
      const day = c.layout.days[0];
      if (column !== undefined && day !== undefined) {
        const t = calendarTimeAt(c.layout, g, column.x + 1, column.y + column.height / 2);
        expect(t).toBeGreaterThanOrEqual(day.start);
        expect(t).toBeLessThan(day.end);
      }
    }
  });

  it("[claim:scene] every word of the drawing is the dictionary's: a pseudo-translation leaves none unmarked", () => {
    const words = pseudoStrings(DEFAULT_STRINGS);
    expect(Object.keys(CALENDAR_STRINGS).every((key) => key in DEFAULT_STRINGS)).toBe(true);
    const c = cases.find((each) => each.layout.allDay.length > 0 && each.days === 7) ?? cases[1];
    if (c === undefined) return;
    const untitled: Item[] = [...c.items, { id: "nameless", start: c.start + 10 * HOUR, end: c.start + 11 * HOUR }];
    const layout = layoutDays(untitled, { start: c.start, timeZone: c.zone });
    const scene = calendarScene(layout, { width: 980, height: 760, strings: words, formatDay: () => "", formatHour: () => "" });
    expect(String(scene.attrs?.["aria-label"]).startsWith(PSEUDO_OPEN)).toBe(true);
    walk(scene, (node) => {
      if (node.attrs?.role === "option") expect(String(node.attrs["aria-label"]).startsWith(PSEUDO_OPEN), String(node.attrs["aria-label"])).toBe(true);
      if (node.tag === "text" && node.attrs?.class === "tl-cal-hour" && node.text !== "") expect(node.text?.startsWith(PSEUDO_OPEN)).toBe(true);
    });
  });
});

describe("G-CALENDAR-VIEW: the wall clock", () => {
  // The 2026 clock changes: Budapest 29 March and 25 October, New York
  // 8 March and 1 November, Lord Howe (half an hour) 5 April and 4 October.
  const CHANGES: readonly (readonly [string, number, number])[] = [
    ["Europe/Budapest", 3, 29],
    ["Europe/Budapest", 10, 25],
    ["America/New_York", 3, 8],
    ["America/New_York", 11, 1],
    ["Australia/Lord_Howe", 4, 5],
    ["Australia/Lord_Howe", 10, 4],
  ];

  it.each(CHANGES.map((change) => [`${change[0]} ${String(change[1])}-${String(change[2])}`, change] as const))("[claim:wall-clock] nine o'clock is on one line across the week of %s", (_, [zone, month, day]) => {
    const start = weekStartOf(instantOf(wallMs(2026, month, day, 12), zone), zone);
    const items: Item[] = Array.from({ length: 7 }, (__, d) => {
      const at = instantOf(Math.floor(wallOf(start, zone) / DAY) * DAY + d * DAY + 9 * HOUR, zone);
      return { id: `nine${String(d)}`, start: at, end: at + HOUR };
    });
    const layout = layoutDays(items, { start, timeZone: zone });
    // The week really has a day that is not 24 hours long.
    expect(layout.days.some((each) => each.end - each.start !== DAY)).toBe(true);
    const g = calendarGeometry(layout, { width: 800, height: 600 });
    expect(new Set(items.map((item) => g.rects.get(item.id)?.y)).size).toBe(1);
  });
});
