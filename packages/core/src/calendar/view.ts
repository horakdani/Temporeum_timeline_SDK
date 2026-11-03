/**
 * The week and the day: a column per day, the hours down it, and the events
 * that overlap side by side.
 *
 * Pure functions, as the rest of the core: {@link layoutDays} places the
 * items in days and columns, {@link calendarGeometry} turns that into
 * rectangles of a given size, {@link calendarKeyStep} says where a key
 * moves the focus, {@link calendarHit} what a pointer is on. The view draws
 * from the geometry (`calendarScene`), and the element mounts it.
 *
 * Two decisions:
 *
 * - **The wall clock places, not elapsed time.** A day is its 24 hours of
 *   wall clock, top to bottom, on the day the clocks change too — so nine
 *   o'clock is on one line across the week. An event's height is its
 *   wall-clock length. The repeated hour of a fall-back day is drawn once,
 *   and two events in it at different instants are side by side.
 * - **Overlap is measured on what is drawn.** An event is at least
 *   `minDurationMs` tall, so two short events five minutes apart overlap on
 *   the screen though not in time, and are put side by side. That is what
 *   makes the claim "no event covers another" a claim about the drawing.
 *
 * Within a run of events that overlap one another, each goes into the first
 * column free at its top, and then reaches right over every column that
 * nothing it overlaps is in — the way a desk calendar fills its width.
 */

import { DEFAULT_TIME_ZONE } from "../calendar.js";
import { toTimeMs } from "../time.js";
import type { Item, TimeInput, TimeMs } from "../types.js";
import { instantOf, wallMs, wallOf } from "./rrule.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** How the days are laid out. */
export interface DaysOptions<T = unknown> {
  /** Any moment of the first day. */
  readonly start: TimeInput;
  /** How many days: 7 for a week, 1 for a day. */
  readonly days?: number;
  readonly timeZone?: string;
  /** The first hour shown. 0 by default. */
  readonly dayStartHour?: number;
  /** The hour the view ends at. 24 by default. */
  readonly dayEndHour?: number;
  /** The least height an event is drawn with, as time. 15 minutes by default. */
  readonly minDurationMs?: number;
  /**
   * Whether an item goes in the all-day row. By default: one whose start and
   * end are both midnights, or whose data says `allDay` (an expanded
   * calendar event).
   */
  readonly allDay?: (item: Item<T>) => boolean;
}

/** One day of the view. */
export interface CalendarDay {
  readonly index: number;
  /** Midnight, and the next. */
  readonly start: TimeMs;
  readonly end: TimeMs;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** 1 = Monday to 7 = Sunday. */
  readonly weekday: number;
}

/** A timed event's piece in one day. */
export interface DaySegment<T = unknown> {
  /** Unique in the layout: the item's id, and `#<day>` for a piece after its first. */
  readonly key: string;
  readonly item: Item<T>;
  readonly day: number;
  /** The piece's instants, within the day. */
  readonly start: TimeMs;
  readonly end: TimeMs;
  /** From 0 (the first hour shown) to 1 (the last), as drawn: at least `minDurationMs` tall. */
  readonly top: number;
  readonly bottom: number;
  readonly column: number;
  readonly columns: number;
  /** How many columns it reaches over, from its own. */
  readonly span: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/** An all-day event across the days it covers in the view. */
export interface AllDaySegment<T = unknown> {
  readonly key: string;
  readonly item: Item<T>;
  readonly first: number;
  readonly last: number;
  readonly row: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/** The days, laid out. */
export interface DaysLayout<T = unknown> {
  readonly days: readonly CalendarDay[];
  readonly timeZone: string;
  readonly dayStartHour: number;
  readonly dayEndHour: number;
  /** Timed pieces, in reading order: by day, then top, then column. */
  readonly segments: readonly DaySegment<T>[];
  readonly allDay: readonly AllDaySegment<T>[];
  readonly allDayRows: number;
  /**
   * Every key the keyboard visits, in reading order: each day's all-day
   * events (those that start in it, or the first day for one from before),
   * then its timed pieces.
   */
  readonly order: readonly string[];
}

const ymd = (wall: number): { year: number; month: number; day: number } => {
  const d = new Date(wall);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

/** Midnight of the day an instant is in, in a zone. */
export function dayStartOf(t: TimeInput, timeZone: string = DEFAULT_TIME_ZONE): TimeMs {
  const wall = wallOf(toTimeMs(t), timeZone);
  return instantOf(Math.floor(wall / DAY) * DAY, timeZone);
}

/** Midnight of the first day of the week an instant is in. `weekStartsOn` 1 = Monday (default) to 7 = Sunday. */
export function weekStartOf(t: TimeInput, timeZone: string = DEFAULT_TIME_ZONE, weekStartsOn = 1): TimeMs {
  const day = Math.floor(wallOf(toTimeMs(t), timeZone) / DAY);
  const weekday = (((day + 3) % 7) + 7) % 7 + 1;
  return instantOf((day - ((weekday - weekStartsOn + 7) % 7)) * DAY, timeZone);
}

/** The days of a view: `count` days from the one `start` is in. */
export function calendarDays(start: TimeInput, count: number, timeZone: string = DEFAULT_TIME_ZONE): CalendarDay[] {
  const first = Math.floor(wallOf(toTimeMs(start), timeZone) / DAY);
  const days: CalendarDay[] = [];
  for (let i = 0; i < count; i += 1) {
    const wall = (first + i) * DAY;
    days.push({ index: i, start: instantOf(wall, timeZone), end: instantOf(wall + DAY, timeZone), ...ymd(wall), weekday: ((((first + i + 3) % 7) + 7) % 7) + 1 });
  }
  return days;
}

/** Whether a data value says all day (an expanded calendar event). */
function saysAllDay(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { readonly allDay?: unknown }).allDay === true;
}

/** Lays the items out in the days. Items outside the days are left out. */
export function layoutDays<T>(items: readonly Item<T>[], options: DaysOptions<T>): DaysLayout<T> {
  const zone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const days = calendarDays(options.start, Math.max(1, Math.floor(options.days ?? 7)), zone);
  const dayStartHour = options.dayStartHour ?? 0;
  const dayEndHour = options.dayEndHour ?? 24;
  if (!(dayStartHour >= 0 && dayEndHour <= 24 && dayEndHour > dayStartHour)) throw new RangeError("dayStartHour and dayEndHour must be 0 <= start < end <= 24");
  const shown = (dayEndHour - dayStartHour) * 60;
  const minHeight = Math.min(1, (options.minDurationMs ?? 15 * MINUTE) / MINUTE / shown);
  const isAllDay =
    options.allDay ??
    ((item: Item<T>): boolean => {
      if (saysAllDay(item.data)) return true;
      if (item.end === undefined) return false;
      const s = toTimeMs(item.start);
      const e = toTimeMs(item.end);
      return e > s && wallOf(s, zone) % DAY === 0 && wallOf(e, zone) % DAY === 0;
    });
  const viewStart = days[0]?.start ?? 0;
  const viewEnd = days[days.length - 1]?.end ?? 0;
  const dayOf = (t: TimeMs): number => days.findIndex((day) => t >= day.start && t < day.end);
  /** Where an instant is on day `d`, 0 to 1, by the wall clock. */
  const position = (t: TimeMs, d: CalendarDay): number => {
    const minutes = t >= d.end ? 1440 : (wallOf(t, zone) - wallMs(d.year, d.month, d.day)) / MINUTE;
    return Math.min(1, Math.max(0, (minutes - dayStartHour * 60) / shown));
  };

  const allDay: AllDaySegment<T>[] = [];
  const pieces: { key: string; item: Item<T>; day: number; start: TimeMs; end: TimeMs; top: number; bottom: number; before: boolean; after: boolean }[] = [];
  for (const item of items) {
    const s = toTimeMs(item.start);
    const e = item.end === undefined || item.open === true ? s : Math.max(s, toTimeMs(item.end));
    if (isAllDay(item)) {
      const last = e > s ? e - 1 : s;
      if (last < viewStart || s >= viewEnd) continue;
      const first = s < viewStart ? 0 : dayOf(s);
      const lastDay = last >= viewEnd ? days.length - 1 : dayOf(last);
      allDay.push({ key: item.id, item, first, last: lastDay, row: 0, continuesBefore: s < viewStart, continuesAfter: last >= viewEnd });
      continue;
    }
    let firstPiece = true;
    for (const d of days) {
      const instant = e === s;
      if (instant ? !(s >= d.start && s < d.end) : !(s < d.end && e > d.start)) continue;
      const ps = Math.max(s, d.start);
      const pe = Math.min(e, d.end);
      let top = position(ps, d);
      let bottom = Math.max(position(pe, d), top + minHeight);
      if (bottom > 1) {
        bottom = 1;
        top = Math.max(0, 1 - minHeight);
      }
      pieces.push({ key: firstPiece ? item.id : `${item.id}#${String(d.index)}`, item, day: d.index, start: ps, end: pe, top, bottom, before: s < d.start, after: e > d.end });
      firstPiece = false;
    }
  }

  // All-day rows: the first row free over the whole run.
  allDay.sort((a, b) => a.first - b.first || b.last - a.last || (a.key < b.key ? -1 : 1));
  const rowEnds: number[] = [];
  const placedAllDay = allDay.map((segment) => {
    let row = rowEnds.findIndex((end) => end < segment.first);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = segment.last;
    return { ...segment, row };
  });

  // Columns, a day at a time, in runs of mutual overlap.
  const segments: DaySegment<T>[] = [];
  for (const d of days) {
    const day = pieces.filter((piece) => piece.day === d.index).sort((a, b) => a.top - b.top || b.bottom - a.bottom || (a.key < b.key ? -1 : 1));
    let run: typeof day = [];
    let runBottom = -1;
    const flush = (): void => {
      const ends: number[] = [];
      const columnOf = run.map((piece) => {
        let column = ends.findIndex((end) => end <= piece.top);
        if (column < 0) column = ends.length;
        ends[column] = piece.bottom;
        return column;
      });
      const columns = ends.length;
      run.forEach((piece, i) => {
        const column = columnOf[i] ?? 0;
        let span = 1;
        while (column + span < columns && !run.some((other, j) => columnOf[j] === column + span && other.top < piece.bottom && piece.top < other.bottom)) span += 1;
        segments.push({ key: piece.key, item: piece.item, day: d.index, start: piece.start, end: piece.end, top: piece.top, bottom: piece.bottom, column, columns, span, continuesBefore: piece.before, continuesAfter: piece.after });
      });
      run = [];
      runBottom = -1;
    };
    for (const piece of day) {
      if (run.length > 0 && piece.top >= runBottom) flush();
      run.push(piece);
      runBottom = Math.max(runBottom, piece.bottom);
    }
    if (run.length > 0) flush();
  }
  segments.sort((a, b) => a.day - b.day || a.top - b.top || a.column - b.column);

  const order: string[] = [];
  for (const d of days) {
    for (const segment of placedAllDay) if (segment.first === d.index) order.push(segment.key);
    for (const segment of segments) if (segment.day === d.index) order.push(segment.key);
  }
  return { days, timeZone: zone, dayStartHour, dayEndHour, segments, allDay: placedAllDay, allDayRows: rowEnds.length, order };
}

// --- geometry ---------------------------------------------------------------------

/** The sizes of a drawn view, in CSS pixels. */
export interface CalendarMetrics {
  readonly width: number;
  readonly height: number;
  /** The day names across the top. 40 by default. */
  readonly headerSize?: number;
  /** The hours down the side. 52 by default. */
  readonly gutterSize?: number;
  /** One all-day row. 22 by default. */
  readonly allDayRowSize?: number;
  /** Space between events side by side. 2 by default. */
  readonly gap?: number;
  /** Right to left: the first day on the right, the hours on the right. */
  readonly rtl?: boolean;
}

/** A rectangle. */
export interface CalendarRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where everything of a laid-out view is drawn. */
export interface CalendarGeometry {
  readonly width: number;
  readonly height: number;
  /** Each day's column, below the header and the all-day rows. */
  readonly columns: readonly CalendarRect[];
  /** Each day's header cell. */
  readonly headers: readonly CalendarRect[];
  /** The hour gutter, and the all-day band across the days. */
  readonly gutter: CalendarRect;
  readonly allDayBand: CalendarRect;
  /** The grid's body: below the all-day band, the days' hours. */
  readonly body: CalendarRect;
  /** Every event's rectangle, by key. */
  readonly rects: ReadonlyMap<string, CalendarRect>;
}

/** The rectangles of a laid-out view at a size. */
export function calendarGeometry(layout: DaysLayout<unknown>, metrics: CalendarMetrics): CalendarGeometry {
  const header = metrics.headerSize ?? 40;
  const gutter = metrics.gutterSize ?? 52;
  const rowSize = metrics.allDayRowSize ?? 22;
  const gap = metrics.gap ?? 2;
  const rtl = metrics.rtl === true;
  const count = layout.days.length;
  const bandHeight = layout.allDayRows * rowSize + (layout.allDayRows > 0 ? 4 : 0);
  const dayWidth = Math.max(0, (metrics.width - gutter) / count);
  const bodyTop = header + bandHeight;
  const bodyHeight = Math.max(0, metrics.height - bodyTop);
  const xOf = (index: number): number => (rtl ? metrics.width - gutter - (index + 1) * dayWidth : gutter + index * dayWidth);
  const columns = layout.days.map((day) => ({ x: xOf(day.index), y: bodyTop, width: dayWidth, height: bodyHeight }));
  const headers = layout.days.map((day) => ({ x: xOf(day.index), y: 0, width: dayWidth, height: header }));
  const rects = new Map<string, CalendarRect>();
  for (const segment of layout.segments) {
    const column = columns[segment.day];
    if (column === undefined) continue;
    const share = column.width / segment.columns;
    const left = column.x + (rtl ? segment.columns - segment.column - segment.span : segment.column) * share;
    rects.set(segment.key, {
      x: left + gap / 2,
      y: column.y + segment.top * column.height,
      width: Math.max(1, share * segment.span - gap),
      height: Math.max(1, (segment.bottom - segment.top) * column.height - 1),
    });
  }
  for (const segment of layout.allDay) {
    const a = columns[segment.first];
    const b = columns[segment.last];
    if (a === undefined || b === undefined) continue;
    const x = Math.min(a.x, b.x);
    rects.set(segment.key, { x: x + gap / 2, y: header + 2 + segment.row * rowSize, width: Math.max(1, Math.max(a.x, b.x) + dayWidth - x - gap), height: rowSize - 2 });
  }
  return {
    width: metrics.width,
    height: metrics.height,
    columns,
    headers,
    gutter: { x: rtl ? metrics.width - gutter : 0, y: bodyTop, width: gutter, height: bodyHeight },
    allDayBand: { x: rtl ? 0 : gutter, y: header, width: metrics.width - gutter, height: bandHeight },
    body: { x: rtl ? 0 : gutter, y: bodyTop, width: metrics.width - gutter, height: bodyHeight },
    rects,
  };
}

/**
 * The event under a point: the key of the topmost rectangle that holds it,
 * or `undefined`. No two rectangles of a layout overlap, so "topmost" is
 * only ever a tie at an edge.
 */
export function calendarHit(geometry: CalendarGeometry, x: number, y: number): string | undefined {
  let hit: string | undefined;
  for (const [key, rect] of geometry.rects) {
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) hit = key;
  }
  return hit;
}

/** The instant at a point of the body: where a click on an empty slot is, snapped down to `snapMs` (15 minutes by default). */
export function calendarTimeAt(layout: DaysLayout<unknown>, geometry: CalendarGeometry, x: number, y: number, options: { readonly snapMs?: number | undefined } = {}): TimeMs | undefined {
  const snapMs = options.snapMs ?? 15 * MINUTE;
  const index = geometry.columns.findIndex((column) => x >= column.x && x < column.x + column.width && y >= column.y && y < column.y + column.height);
  const day = layout.days[index];
  const column = geometry.columns[index];
  if (day === undefined || column === undefined || column.height <= 0) return undefined;
  const minutes = layout.dayStartHour * 60 + ((y - column.y) / column.height) * (layout.dayEndHour - layout.dayStartHour) * 60;
  const snapped = Math.floor((minutes * MINUTE) / snapMs) * snapMs;
  return instantOf(wallMs(day.year, day.month, day.day) + snapped, layout.timeZone);
}

// --- keyboard ---------------------------------------------------------------------

/** What a key asks of the view. */
export type CalendarKeyAction =
  | "next"
  | "previous"
  | "nextDay"
  | "previousDay"
  | "dayStart"
  | "dayEnd"
  | "first"
  | "last"
  | "nextPeriod"
  | "previousPeriod"
  | "today"
  | "activate";

/** The key fields the view reads. */
export interface CalendarKey {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * The action of a key, or `undefined` for one the view leaves alone. Right
 * to left, the arrows move the way they point: the left arrow to the next day.
 */
export function resolveCalendarKey(key: CalendarKey, options: { readonly direction?: "ltr" | "rtl" | undefined } = {}): CalendarKeyAction | undefined {
  const rtl = options.direction === "rtl";
  const mod = key.ctrlKey === true || key.metaKey === true;
  if (key.altKey === true) return undefined;
  switch (key.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "ArrowRight":
      return rtl ? "previousDay" : "nextDay";
    case "ArrowLeft":
      return rtl ? "nextDay" : "previousDay";
    case "Home":
      return mod ? "first" : "dayStart";
    case "End":
      return mod ? "last" : "dayEnd";
    case "PageDown":
      return "nextPeriod";
    case "PageUp":
      return "previousPeriod";
    case "t":
    case "T":
      return mod ? undefined : "today";
    case "Enter":
    case " ":
      return "activate";
    default:
      return undefined;
  }
}

/** Where a key's place is: its day and how far down it is. All-day events are above the hours. */
function placeOf(layout: DaysLayout<unknown>, key: string): { readonly day: number; readonly top: number; readonly column: number } | undefined {
  const timed = layout.segments.find((segment) => segment.key === key);
  if (timed !== undefined) return { day: timed.day, top: timed.top, column: timed.column };
  const allDay = layout.allDay.find((segment) => segment.key === key);
  return allDay === undefined ? undefined : { day: allDay.first, top: -1 + allDay.row / 100, column: 0 };
}

/**
 * Where the focus goes for a moving action: a key of the layout, or
 * `undefined` when there is nothing to focus. With no focus yet, every
 * moving action starts at the first event. The period, today and activate
 * actions do not move the focus within the view, and return it as it was.
 */
export function calendarKeyStep(layout: DaysLayout<unknown>, focused: string | undefined, action: CalendarKeyAction): string | undefined {
  const order = layout.order;
  if (order.length === 0) return undefined;
  const at = focused === undefined ? -1 : order.indexOf(focused);
  if (at < 0) return action === "nextPeriod" || action === "previousPeriod" || action === "today" || action === "activate" ? focused : order[0];
  const here = placeOf(layout, order[at] ?? "");
  const inDay = (day: number): string[] => order.filter((key) => placeOf(layout, key)?.day === day);
  switch (action) {
    case "next":
      return order[Math.min(order.length - 1, at + 1)];
    case "previous":
      return order[Math.max(0, at - 1)];
    case "first":
      return order[0];
    case "last":
      return order[order.length - 1];
    case "dayStart":
      return here === undefined ? focused : inDay(here.day)[0];
    case "dayEnd": {
      if (here === undefined) return focused;
      const keys = inDay(here.day);
      return keys[keys.length - 1];
    }
    case "nextDay":
    case "previousDay": {
      if (here === undefined) return focused;
      const step = action === "nextDay" ? 1 : -1;
      for (let day = here.day + step; day >= 0 && day < layout.days.length; day += step) {
        let best: string | undefined;
        let bestDistance = Infinity;
        for (const key of inDay(day)) {
          const place = placeOf(layout, key);
          const distance = place === undefined ? Infinity : Math.abs(place.top - here.top) + place.column / 1000;
          if (distance < bestDistance) {
            best = key;
            bestDistance = distance;
          }
        }
        if (best !== undefined) return best;
      }
      return focused;
    }
    default:
      return focused;
  }
}
