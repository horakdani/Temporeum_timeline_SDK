/**
 * Working time: a calendar of shifts, days off and a time zone, read as one
 * number per instant.
 *
 * Everything the scheduler measures — a task's duration, a lag, how far a
 * constraint is missed — is working time, so every date goes through
 * {@link WorkTime.work} first: the working milliseconds from a fixed point to
 * the instant. Only differences of it mean anything. Arithmetic in that space
 * is plain addition, and the two ways back to an instant say which side of a
 * break a moment belongs to: a task *starts* where work resumes (Monday
 * 08:00), and *finishes* where work stopped (Friday 17:00), though the two
 * are the same amount of work.
 *
 * Shifts are wall-clock minutes in the calendar's zone, so a day across a
 * daylight-saving change is as long as the clock says: an 08:00–17:00 shift
 * is nine hours on both sides of it, and a shift across the change itself is
 * an hour shorter or longer. The spans are made a few weeks at a time, as far
 * as a question needs, and kept.
 */

import { zoneOffsetMs } from "../calendar.js";
import type { TimeMs } from "../types.js";

/** One shift, from and to in minutes after the day's wall-clock midnight (0–1440). */
export type WorkShift = readonly [from: number, to: number];

/** Days that differ from the week: a holiday, or other hours. */
export interface WorkException {
  /** The first day, `YYYY-MM-DD`, in the calendar's zone. */
  readonly date: string;
  /** The last day, inclusive. The same day when omitted. */
  readonly until?: string;
  /** The hours worked on those days. None — the default — is a day off. */
  readonly shifts?: readonly WorkShift[];
}

/** When work happens. */
export interface WorkCalendar {
  /** IANA zone the shifts and dates are read in. `UTC` by default. */
  readonly timeZone?: string;
  /**
   * The shifts of each weekday, Monday first. A missing day is a day off.
   * Monday to Friday, 08:00–12:00 and 13:00–17:00, when omitted.
   */
  readonly week?: readonly (readonly WorkShift[])[];
  readonly exceptions?: readonly WorkException[];
}

/** A calendar, compiled. */
export interface WorkTime {
  /** The working milliseconds from a fixed point to `t`. Only differences mean anything. */
  work(t: TimeMs): number;
  /** The latest instant with that much work: where work resumes. */
  start(work: number): TimeMs;
  /** The earliest instant with that much work: where work stopped. */
  finish(work: number): TimeMs;
}

const DAY = 86_400_000;
const MINUTE = 60_000;
/** Days made at a time. */
const CHUNK = 32;
/** How far, in days, a calendar is searched for work before it gives up: two centuries. */
const REACH = 73_050;

const OFFICE_DAY: readonly WorkShift[] = [
  [480, 720],
  [780, 1020],
];

/** Monday to Friday, 08:00–12:00 and 13:00–17:00. */
export const OFFICE_WEEK: readonly (readonly WorkShift[])[] = [OFFICE_DAY, OFFICE_DAY, OFFICE_DAY, OFFICE_DAY, OFFICE_DAY, [], []];

/** All time is working time: no calendar. */
export const CONTINUOUS: WorkTime = { work: (t) => t, start: (work) => work, finish: (work) => work };

function dayNumber(date: string): number {
  const match = /^(-?\d{1,6})-(\d\d)-(\d\d)$/.exec(date);
  if (match === null) {
    throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  }
  const day = new Date(0);
  day.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round(day.getTime() / DAY);
}

function shiftsOf(shifts: readonly WorkShift[]): WorkShift[] {
  for (const [from, to] of shifts) {
    if (!(from >= 0 && to <= 1440 && from < to)) {
      throw new RangeError(`A shift runs from 0 to 1440 minutes, forwards: [${String(from)}, ${String(to)}]`);
    }
  }
  return [...shifts].sort((a, b) => a[0] - b[0]);
}

/** The first index whose value passes, by bisection; `values.length` when none does. */
function firstWhere(length: number, passes: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (passes(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function compile(calendar: WorkCalendar): WorkTime {
  const zone = calendar.timeZone ?? "UTC";
  const week = (calendar.week ?? OFFICE_WEEK).map(shiftsOf);
  const special = new Map<number, WorkShift[]>();
  let any = week.some((day) => day.length > 0);
  for (const exception of calendar.exceptions ?? []) {
    const from = dayNumber(exception.date);
    const to = exception.until === undefined ? from : dayNumber(exception.until);
    if (to < from || to - from > REACH) {
      throw new RangeError(`An exception runs forwards, within two centuries: ${exception.date} to ${String(exception.until)}`);
    }
    const shifts = shiftsOf(exception.shifts ?? []);
    any ||= shifts.length > 0;
    for (let day = from; day <= to; day += 1) special.set(day, shifts);
  }
  if (!any) {
    throw new RangeError("A work calendar needs some working time");
  }
  const instant = zone === "UTC" ? (wall: number) => wall : (wall: number) => wall - zoneOffsetMs(wall - zoneOffsetMs(wall, zone), zone);

  /** The working spans of days [from, to), merged, as flat start/end pairs. */
  function spans(from: number, to: number): number[] {
    const out: number[] = [];
    for (let day = from; day < to; day += 1) {
      for (const [a, b] of special.get(day) ?? week[(((day + 3) % 7) + 7) % 7] ?? []) {
        const start = instant(day * DAY + a * MINUTE);
        const end = instant(day * DAY + b * MINUTE);
        if (end <= start) continue;
        const last = out.length - 1;
        if (last > 0 && start <= (out[last] as number)) out[last] = Math.max(out[last] as number, end);
        else out.push(start, end);
      }
    }
    return out;
  }

  let starts: number[] = [];
  let ends: number[] = [];
  /** The work at each span's start. */
  let cum: number[] = [];
  let low = 0;
  let high = 0;
  /** The work at the start of day `low`, and of day `high`, and those two instants. */
  let base = 0;
  let top = 0;
  let lowAt = 0;
  let highAt = 0;
  let ready = false;

  function later(): void {
    const made = spans(high, high + CHUNK);
    for (let index = 0; index < made.length; index += 2) {
      starts.push(made[index] as number);
      ends.push(made[index + 1] as number);
      cum.push(top);
      top += (made[index + 1] as number) - (made[index] as number);
    }
    high += CHUNK;
    highAt = instant(high * DAY);
    if (high - low > 2 * REACH) throw new RangeError("No working time within two centuries");
  }

  function earlier(): void {
    const made = spans(low - CHUNK, low);
    const s: number[] = [];
    const e: number[] = [];
    const c: number[] = [];
    let total = 0;
    for (let index = 0; index < made.length; index += 2) total += (made[index + 1] as number) - (made[index] as number);
    let at = base - total;
    for (let index = 0; index < made.length; index += 2) {
      s.push(made[index] as number);
      e.push(made[index + 1] as number);
      c.push(at);
      at += (made[index + 1] as number) - (made[index] as number);
    }
    starts = s.concat(starts);
    ends = e.concat(ends);
    cum = c.concat(cum);
    base -= total;
    low -= CHUNK;
    lowAt = instant(low * DAY);
    if (high - low > 2 * REACH) throw new RangeError("No working time within two centuries");
  }

  function begin(t: TimeMs): void {
    if (ready) return;
    ready = true;
    low = Math.floor((t + zoneOffsetMs(t, zone)) / DAY);
    high = low;
    // The fixed point is that day's start, and the count starts at its
    // instant: working time then reads near the clock, so asking for an
    // instant first finds it in the weeks around, not centuries away.
    base = top = lowAt = highAt = instant(low * DAY);
  }

  return {
    work(t) {
      begin(t);
      while (lowAt > t) earlier();
      while (highAt <= t) later();
      const index = firstWhere(starts.length, (i) => (starts[i] as number) > t) - 1;
      if (index < 0) return base;
      return (cum[index] as number) + Math.min(t, ends[index] as number) - (starts[index] as number);
    },
    start(work) {
      begin(work);
      while (work < base) earlier();
      while (work >= top) later();
      const index = firstWhere(cum.length, (i) => (cum[i] as number) > work) - 1;
      return (starts[index] as number) + work - (cum[index] as number);
    },
    finish(work) {
      begin(work);
      while (work <= base) earlier();
      while (work > top) later();
      const index = firstWhere(cum.length, (i) => (cum[i] as number) + (ends[i] as number) - (starts[i] as number) >= work);
      return (starts[index] as number) + work - (cum[index] as number);
    },
  };
}

const compiled = new WeakMap<WorkCalendar, WorkTime>();

/** A calendar, compiled once and kept for as long as the calendar object lives. No calendar is {@link CONTINUOUS}. */
export function workTime(calendar?: WorkCalendar): WorkTime {
  if (calendar === undefined) return CONTINUOUS;
  let made = compiled.get(calendar);
  if (made === undefined) {
    made = compile(calendar);
    compiled.set(calendar, made);
  }
  return made;
}

/** The working time between two instants: negative when `to` is first. */
export function workingMs(calendar: WorkCalendar | undefined, from: TimeMs, to: TimeMs): number {
  const time = workTime(calendar);
  return time.work(to) - time.work(from);
}

/** The instant `ms` of working time after `t` — where that work is done. */
export function addWorkingMs(calendar: WorkCalendar | undefined, t: TimeMs, ms: number): TimeMs {
  const time = workTime(calendar);
  return time.finish(time.work(t) + ms);
}
