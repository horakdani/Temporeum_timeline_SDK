/**
 * Hidden dates: stretches of time the axis does not draw.
 *
 * Nights, weekends, a plant's shutdown — a schedule that only happens in
 * working time reads better without the time nothing happens in. The core
 * takes hidden dates as a {@link TimeWarp}: two functions between real time
 * and *shown* time, the time that is left when the hidden stretches are
 * taken out. Its scale, its pans and its zooms are linear in shown time, so
 * the axis has no gaps, an item across a hidden stretch is drawn without it,
 * and a zoom holds the instant under the pointer across one exactly as it
 * does anywhere else. This file builds that warp from ranges.
 *
 * Three decisions carry it:
 *
 * 1. **Repeats are calendar repeats, in the timeline's zone.** A nightly
 *    `18:00–08:00` stays `18:00–08:00` local time across a daylight-saving
 *    change; the stretch that night is an hour longer or shorter, not an
 *    hour off. Weekly is seven calendar days, monthly and yearly are the
 *    calendar's own months and years.
 * 2. **Expanded lazily, a UTC year at a time.** A repeat has no end, so the
 *    stretches are worked out per year when a year is first asked about, and
 *    kept: the hidden time before each year is a running sum, so `toShown`
 *    is a lookup and a binary search. Past {@link HIDDEN_BUDGET} stretches
 *    the expansion stops, and beyond the years it reached nothing is hidden —
 *    a deep zoom out to the centuries, where a night is not a pixel, does not
 *    spend its frame expanding nights.
 * 3. **A hidden stretch collapses onto its start.** `toReal` answers with
 *    the earliest instant that shows at a position, so the seam where a night
 *    was taken out reads as the evening, and a tick there says when the
 *    stretch began.
 */

import { addCalendar, daysInMonth, DEFAULT_TIME_ZONE, startOf, zoneOffsetMs } from "../calendar.js";
import type { TimeWarp } from "../scale.js";
import { alignToStep, chooseTickStep, DEFAULT_MAX_TICKS, generateTicks } from "../ticks.js";
import type { Tick, TickOptions } from "../ticks.js";
import { toTimeMs } from "../time.js";
import type { Domain, Granularity, TimeInput, TimeMs } from "../types.js";

/** How a hidden range repeats. */
export type HiddenRepeat = "daily" | "weekly" | "monthly" | "yearly";

/**
 * A stretch of time the axis does not draw, `[start, end)`.
 *
 * With `repeat`, the range is the first occurrence of a pattern that repeats
 * both ways without end: `{ start: Fri 18:00, end: Mon 08:00, repeat:
 * "weekly" }` hides every weekend. An occurrence has to be shorter than its
 * period — a range that hides all of time hides nothing useful.
 */
export interface HiddenDateRange {
  readonly start: TimeInput;
  readonly end: TimeInput;
  readonly repeat?: HiddenRepeat;
}

/** What `createHiddenDates` tunes. */
export interface HiddenDatesOptions {
  /** The zone repeats are calendar repeats in: the timeline's. UTC by default. */
  readonly timeZone?: string;
}

/** A stretch of hidden time, merged with any it overlaps. */
export interface HiddenStretch {
  readonly start: TimeMs;
  readonly end: TimeMs;
}

/** Hidden dates, ready to hand to the renderer, the input machine and the element. */
export interface HiddenDates extends TimeWarp {
  readonly ranges: readonly HiddenDateRange[];
  readonly timeZone: string;
  /** Whether an instant is hidden. The start of a stretch is; its end is not. */
  readonly isHidden: (time: TimeMs) => boolean;
  /** The hidden stretches that overlap `[from, to)`, merged, ascending, clipped. */
  readonly stretches: (from: TimeMs, to: TimeMs) => readonly HiddenStretch[];
  /** The axis's ticks: `generateTicks` on each shown stretch, at the shown zoom. */
  readonly ticks: (domain: Domain, mainSize: number, options: TickOptions) => readonly Tick[];
}

/**
 * Stretches the expansion works out before it stops. A nightly range is
 * about 365 a year: some 270 years around the first year drawn.
 */
export const HIDDEN_BUDGET = 100_000;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Days a step adds, or months; and the shortest and longest a period can be in real time. */
const PERIOD: Record<HiddenRepeat, readonly [days: number, months: number, shortest: number, longest: number]> = {
  // A daylight-saving change makes a local day an hour shorter or longer.
  daily: [1, 0, DAY - HOUR, DAY + HOUR],
  weekly: [7, 0, 7 * DAY - HOUR, 7 * DAY + HOUR],
  monthly: [0, 1, 28 * DAY - HOUR, 31 * DAY + HOUR],
  yearly: [0, 12, 365 * DAY - HOUR, 366 * DAY + HOUR],
};

/**
 * Wall-clock time read as UTC, `months` calendar months later — the day
 * held to the month's last, as the calendar's own step does.
 */
function shiftMonths(local: number, months: number): number {
  const date = new Date(local);
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month + 1));
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month, day);
  shifted.setUTCHours(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
  return shifted.getTime();
}

/**
 * A zone's offset as constant pieces, a UTC year at a time.
 *
 * Reading an offset is an `Intl` call, and a nightly repeat needs two a
 * night. A year without a change — every year before daylight saving, and
 * every year in most zones — costs three; a year with changes, the months
 * around them and a search to the minute. After that an offset is a lookup.
 */
function zoneModel(timeZone: string): (time: TimeMs) => number {
  if (timeZone === "UTC") return () => 0;
  const pieces = new Map<number, { readonly from: number[]; readonly offset: number[] }>();
  const at = (time: TimeMs): number => zoneOffsetMs(Math.min(Math.max(time, -8.64e15), 8.64e15), timeZone);
  function build(year: number): { readonly from: number[]; readonly offset: number[] } {
    const start = yearStart(year);
    const end = year >= MAX_YEAR ? 8.64e15 : yearStart(year + 1);
    const first = at(start);
    const from = [-Infinity];
    const offset = [first];
    if (at(start + (end - start) / 2) === first && at(end) === first) return { from, offset };
    let previous = start;
    let before = first;
    for (let month = 1; month <= 12; month += 1) {
      // The months of the last year past the end of time are no instants: the end stands in.
      const opening = monthStart(year, month);
      const next = month === 12 || !(opening < end) ? end : opening;
      const value = at(next);
      if (value !== before) {
        // The first minute with the new offset.
        let lo = previous;
        let hi = next;
        while (hi - lo > 60_000) {
          const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
          if (at(mid) === before) lo = mid;
          else hi = mid;
        }
        from.push(hi);
        offset.push(value);
        before = value;
      }
      previous = next;
    }
    return { from, offset };
  }
  // The year last asked about: a night's two readings are in one year.
  let low = Infinity;
  let high = -Infinity;
  let last: { readonly from: number[]; readonly offset: number[] } | undefined;
  return (time) => {
    let model = time >= low && time < high ? last : undefined;
    if (model === undefined) {
      // A wall-clock reading near the end of time can be past it: the last year's offset holds.
      const year = yearOf(Math.min(Math.max(time, -8.64e15), 8.64e15));
      model = pieces.get(year);
      if (model === undefined) {
        model = build(year);
        pieces.set(year, model);
      }
      last = model;
      low = yearStart(year);
      high = year >= MAX_YEAR ? 8.64e15 : yearStart(year + 1);
    }
    let index = model.from.length - 1;
    while (index > 0 && (model.from[index] as number) > time) index -= 1;
    return model.offset[index] as number;
  };
}


/** The unit a tick's `major` is measured against: the ticks' own ladder, one rung up. */
const COARSER: Partial<Record<Granularity, Granularity>> = {
  millisecond: "second",
  second: "minute",
  minute: "hour",
  hour: "day",
  day: "month",
  month: "year",
  year: "decade",
  decade: "century",
  century: "millennium",
};

/** One UTC year's stretches: ascending, merged, clipped to the year. */
interface Year {
  readonly start: TimeMs;
  readonly end: TimeMs;
  /** `[start0, end0, start1, end1, …]`. */
  readonly stretches: Float64Array;
  /** Hidden time in the year before each stretch. */
  readonly before: Float64Array;
  readonly total: number;
}

const MIN_YEAR = -271_820;
const MAX_YEAR = 275_759;

function yearOf(time: TimeMs): number {
  return new Date(time).getUTCFullYear();
}

function monthStart(year: number, month: number): TimeMs {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 1);
  return date.getTime();
}

function yearStart(year: number): TimeMs {
  return monthStart(year, 0);
}

function checked(range: HiddenDateRange): { readonly start: TimeMs; readonly end: TimeMs; readonly repeat?: HiddenRepeat } {
  const start = toTimeMs(range.start);
  const end = toTimeMs(range.end);
  if (!(end > start)) {
    throw new RangeError(`A hidden range must end after it starts: [${String(start)}, ${String(end)}]`);
  }
  if (range.repeat !== undefined) {
    const period = PERIOD[range.repeat];
    if (period === undefined) throw new RangeError(`Unknown repeat: ${String(range.repeat)}`);
    if (end - start >= period[2]) {
      throw new RangeError(`A ${range.repeat} hidden range must be shorter than its period`);
    }
    return { start, end, repeat: range.repeat };
  }
  return { start, end };
}

/**
 * Hidden dates from fixed and repeating ranges.
 *
 * The object is the warp the renderer (`hiddenDates`) and the input machine
 * take, and it keeps what it has expanded: make it once per set of ranges
 * and zone, not once per frame.
 */
export function createHiddenDates(ranges: readonly HiddenDateRange[], options: HiddenDatesOptions = {}): HiddenDates {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const offsetAt = zoneModel(timeZone);
  /** Wall-clock time read as UTC, back to an instant. In a gap, the later offset's reading. */
  const toUtc = (local: number): TimeMs => local - offsetAt(local - offsetAt(local - offsetAt(local)));
  const fixed: { start: TimeMs; end: TimeMs }[] = [];
  const repeating: { start: TimeMs; end: TimeMs; localStart: number; localEnd: number; repeat: HiddenRepeat }[] = [];
  for (const range of ranges) {
    const each = checked(range);
    if (each.repeat === undefined) fixed.push({ start: each.start, end: each.end });
    else repeating.push({ start: each.start, end: each.end, localStart: each.start + offsetAt(each.start), localEnd: each.end + offsetAt(each.end), repeat: each.repeat });
  }
  fixed.sort((a, b) => a.start - b.start);

  // Years first..last are expanded; `cumulative[i]` is the hidden time from
  // the start of the first year ever expanded to the start of year
  // `first + i` — negative before it.
  let first = 0;
  let last = -1;
  const years: Year[] = [];
  const cumulative: number[] = [];
  let spent = 0;
  let exhausted = ranges.length === 0;

  function expand(year: number): Year {
    const start = yearStart(year);
    const end = year >= MAX_YEAR ? 8.64e15 : yearStart(year + 1);
    const found: [number, number][] = [];
    for (const range of fixed) {
      if (range.start >= end) break;
      if (range.end > start) found.push([Math.max(range.start, start), Math.min(range.end, end)]);
    }
    for (const range of repeating) {
      const [days, months, shortest, longest] = PERIOD[range.repeat];
      // Every occurrence that can reach the year: k periods move an instant
      // by between k shortest and k longest ones, whichever way k points.
      const toYear = start - range.end;
      const pastYear = end - range.start;
      const low = Math.floor(toYear / (toYear >= 0 ? longest : shortest)) - 1;
      const high = Math.ceil(pastYear / (pastYear >= 0 ? shortest : longest)) + 1;
      for (let k = low; k <= high; k += 1) {
        // On the wall clock, then back: 18:00 stays 18:00 across a change.
        const from = toUtc(months === 0 ? range.localStart + k * days * DAY : shiftMonths(range.localStart, k * months));
        if (from >= end) break;
        const to = toUtc(months === 0 ? range.localEnd + k * days * DAY : shiftMonths(range.localEnd, k * months));
        if (to > start && to > from) found.push([Math.max(from, start), Math.min(to, end)]);
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    const merged: number[] = [];
    for (const [from, to] of found) {
      const tail = merged.length - 1;
      if (tail > 0 && from <= (merged[tail] as number)) merged[tail] = Math.max(merged[tail] as number, to);
      else merged.push(from, to);
    }
    const stretches = Float64Array.from(merged);
    const before = new Float64Array(stretches.length / 2);
    let total = 0;
    for (let i = 0; i < before.length; i += 1) {
      before[i] = total;
      total += (stretches[2 * i + 1] as number) - (stretches[2 * i] as number);
    }
    spent += before.length;
    return { start, end, stretches, before, total };
  }

  /** Whether `year` is expanded, expanding toward it while the budget lasts. */
  function reach(year: number): boolean {
    if (exhausted) return year >= first && year <= last;
    if (last < first) {
      first = Math.min(Math.max(year, MIN_YEAR), MAX_YEAR);
      last = first;
      years.push(expand(first));
      cumulative.push(0);
    }
    while (year > last && last < MAX_YEAR && spent < HIDDEN_BUDGET) {
      const previous = years[years.length - 1] as Year;
      cumulative.push((cumulative[cumulative.length - 1] as number) + previous.total);
      last += 1;
      years.push(expand(last));
    }
    while (year < first && first > MIN_YEAR && spent < HIDDEN_BUDGET) {
      first -= 1;
      const added = expand(first);
      years.unshift(added);
      // The sums stay measured from the first year expanded: earlier years
      // count back from it, so no instant's shown time ever changes.
      cumulative.unshift((cumulative[0] as number) - added.total);
    }
    if (spent >= HIDDEN_BUDGET) exhausted = true;
    return year >= first && year <= last;
  }

  /** Hidden time from the start of the first year expanded to `time`. */
  function hiddenBefore(time: TimeMs): number {
    if (ranges.length === 0) return 0;
    const year = yearOf(time);
    if (!reach(year)) {
      // Beyond the expansion nothing is hidden: the sums stop where it stopped.
      return year < first ? (cumulative[0] as number) : (cumulative[last - first] as number) + (years[last - first] as Year).total;
    }
    const index = year - first;
    const at = years[index] as Year;
    const s = at.stretches;
    // The last stretch starting at or before `time`.
    let lo = 0;
    let hi = at.before.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((s[2 * mid] as number) <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const base = cumulative[index] as number;
    if (found === -1) return base;
    const from = s[2 * found] as number;
    const to = s[2 * found + 1] as number;
    return base + (at.before[found] as number) + Math.min(time, to) - from;
  }

  const toShown = (time: TimeMs): number => time - hiddenBefore(time);

  /** Shown time at the start of the `index`-th expanded year. */
  const shownAtYear = (index: number): number => (years[index] as Year).start - (cumulative[index] as number);

  /** Shown time at the end of the `index`-th expanded year. */
  const shownAtEnd = (index: number): number => {
    const year = years[index] as Year;
    return shownAtYear(index) + year.end - year.start - year.total;
  };

  const toReal = (shown: number): TimeMs => {
    if (ranges.length === 0) return shown;
    // Near the first year asked about, shown time is close to real time.
    if (last < first) reach(yearOf(Math.min(Math.max(shown, -8.64e15), 8.64e15)));
    while (shown > shownAtEnd(last - first)) if (!reach(last + 1)) break;
    while (shown < shownAtYear(0)) if (!reach(first - 1)) break;
    const count = last - first + 1;
    const endShown = shownAtEnd(count - 1);
    if (shown > endShown) return (years[count - 1] as Year).end + (shown - endShown);
    if (shown < shownAtYear(0)) return (years[0] as Year).start - (shownAtYear(0) - shown);
    // The first year whose end shows at or after `shown`.
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (shownAtEnd(mid) >= shown) hi = mid;
      else lo = mid + 1;
    }
    const year = years[lo] as Year;
    const base = cumulative[lo] as number;
    const s = year.stretches;
    // The last stretch that starts at or before `shown`, in shown time.
    let found = -1;
    let a = 0;
    let b = year.before.length - 1;
    while (a <= b) {
      const mid = (a + b) >> 1;
      if ((s[2 * mid] as number) - base - (year.before[mid] as number) <= shown) {
        found = mid;
        a = mid + 1;
      } else {
        b = mid - 1;
      }
    }
    if (found === -1) return shown + base;
    const at = (s[2 * found] as number) - base - (year.before[found] as number);
    if (at === shown) return s[2 * found] as number;
    return (s[2 * found + 1] as number) + (shown - at);
  };

  function stretches(from: TimeMs, to: TimeMs): readonly HiddenStretch[] {
    const out: HiddenStretch[] = [];
    if (!(to > from) || ranges.length === 0) return out;
    for (let year = yearOf(from); year <= yearOf(to); year += 1) {
      if (!reach(year)) continue;
      const s = (years[year - first] as Year).stretches;
      for (let i = 0; i < s.length; i += 2) {
        const start = Math.max(s[i] as number, from);
        const end = Math.min(s[i + 1] as number, to);
        if (end <= start) continue;
        const tail = out[out.length - 1];
        // A stretch across New Year is two in the years; one here.
        if (tail !== undefined && tail.end === start) out[out.length - 1] = { start: tail.start, end };
        else out.push({ start, end });
      }
    }
    return out;
  }

  // Read off the year's table, not through `toReal`: a stretch collapses
  // onto its start, so a round trip would call the start shown and the end hidden.
  const isHidden = (time: TimeMs): boolean => {
    if (ranges.length === 0 || !reach(yearOf(time))) return false;
    const s = (years[yearOf(time) - first] as Year).stretches;
    let lo = 0;
    let hi = s.length / 2 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((s[2 * mid] as number) > time) hi = mid - 1;
      else if ((s[2 * mid + 1] as number) <= time) lo = mid + 1;
      else return true;
    }
    return false;
  };

  /**
   * The axis's ticks. The step is the one the shown zoom gets; a tick in a
   * visible stretch is where it always is, and the ticks a hidden stretch
   * swallows become one, at the seam: the latest of them, which names the
   * time the seam opens onto — with nights hidden, a day's label sits where
   * its morning begins. One iteration leaps the whole stretch.
   */
  function ticks(domain: Domain, mainSize: number, options: TickOptions): readonly Tick[] {
    const [start, end] = domain;
    const shownSpan = toShown(end) - toShown(start);
    if (!(shownSpan > 0) || !(mainSize > 0)) return generateTicks(domain, mainSize, options);
    const zone = options.timeZone ?? timeZone;
    const max = options.maxTicks ?? DEFAULT_MAX_TICKS;
    const step = chooseTickStep(shownSpan / mainSize, options.targetSpacingPx);
    const coarser = COARSER[step.granularity];
    const out: Tick[] = [];
    let t = alignToStep(start, step, zone);
    while (t <= end && out.length < max) {
      let at = t;
      if (isHidden(at)) {
        // The stretch's end: one millisecond of shown time later, less one.
        const seamEnd = Math.min(toReal(toShown(at) + 1) - 1, end);
        const latest = alignToStep(seamEnd, step, zone);
        if (latest > at) at = latest;
      }
      if (at >= start) {
        const tick = { time: at, granularity: step.granularity, major: coarser === undefined ? true : at === startOf(at, coarser, zone) };
        const previous = out[out.length - 1];
        // Two ticks on one seam: the later one names it.
        if (previous !== undefined && toShown(previous.time) === toShown(at)) out[out.length - 1] = tick;
        else out.push(tick);
      }
      const stepped = addCalendar(at, step.granularity, step.count, zone);
      const realigned = alignToStep(stepped, step, zone);
      const next = realigned > at ? realigned : stepped;
      if (next <= at) break;
      t = next;
    }
    return out;
  }

  return { ranges, timeZone, toShown, toReal, isHidden, stretches, ticks };
}
