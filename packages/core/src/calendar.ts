/**
 * Calendar arithmetic that is correct across time zones and daylight saving,
 * with zero runtime dependencies.
 *
 * Two platform primitives carry this file, and the split between them is
 * deliberate:
 *
 * 1. `Intl.DateTimeFormat` with `timeZoneName: "longOffset"` is the only
 *    source of zone information. The platform already ships the IANA database,
 *    so the package needs neither a date library nor a bundled zone table.
 * 2. Every calendar *field* operation goes through `Date`'s UTC accessors,
 *    which are proleptic Gregorian without a cutover and accept any year.
 *
 * The reason for (2) is the millennium end of the range: a calendar
 * implementation that reads fields back out of `Intl` inherits whatever
 * Julian/Gregorian changeover the host's ICU build applies, which would move
 * a year-1000 tick by about ten days depending on the engine. Offsets are
 * immune to that, so this file reads offsets from `Intl` and nothing else.
 *
 * Wall clock and instant are related by `wall = instant + offset`.
 */

import type { Granularity, TimeMs } from "./types.js";

/**
 * Wall-clock fields of an instant in a given time zone.
 *
 * `year` is astronomical: 1 BC is `0`, 2 BC is `-1`. `month` is 1-12.
 */
export interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/** The zone used when a caller does not name one. Deterministic by design. */
export const DEFAULT_TIME_ZONE = "UTC";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Granularities with a fixed length in milliseconds.
 *
 * These are *durations*: adding an hour always advances 3 600 000 ms, even
 * across a daylight-saving transition. Day and coarser are calendar
 * operations instead, which is where the wall clock is preserved.
 */
const FIXED_UNIT_MS: Partial<Record<Granularity, number>> = {
  millisecond: 1,
  second: MS_PER_SECOND,
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
};

/**
 * Granularities that are a whole number of years.
 *
 * Exported for the tick ladder, which has to align a two-century step to a
 * multiple of 200 years and needs the same table to do it.
 */
export const YEARS_PER_UNIT: Partial<Record<Granularity, number>> = {
  year: 1,
  decade: 10,
  century: 100,
  millennium: 1000,
};

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let format = offsetFormatters.get(timeZone);
  // Throws RangeError for an unknown zone — the right failure, surfaced at
  // the first call rather than silently falling back to UTC.
  if (format === undefined) offsetFormatters.set(timeZone, (format = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })));
  return format;
}

function assertFiniteTime(t: TimeMs): void {
  if (!Number.isFinite(t)) {
    throw new RangeError(`Invalid time value: ${String(t)}`);
  }
}

/** Offsets by zone and UTC hour: a layout in a zone asks for the same hours thousands of times. */
const offsets = new Map<string, number>();

/**
 * The zone's UTC offset in milliseconds at the given instant.
 *
 * Positive east of Greenwich. Sub-minute historical offsets are preserved:
 * Europe/Amsterdam in 1890 is `GMT+00:17:30`, and dropping those seconds
 * would misplace an hour tick by half a minute.
 */
export function zoneOffsetMs(t: TimeMs, timeZone: string = DEFAULT_TIME_ZONE): number {
  assertFiniteTime(t);
  // The default zone, and the one most timelines run in: no Intl call. A
  // frame's ticks ask this a few hundred times, and in UTC the answer is 0.
  if (timeZone === "UTC") {
    return 0;
  }
  // An hour remembered when it begins and ends on one offset; the hour a
  // change falls in is asked each time.
  const hour = floorToMultiple(t, MS_PER_HOUR);
  const key = timeZone + hour;
  let offset = offsets.get(key);
  if (offset === undefined) {
    offset = intlOffsetMs(hour, timeZone);
    if (offset !== intlOffsetMs(hour + MS_PER_HOUR - 1, timeZone)) return intlOffsetMs(t, timeZone);
    if (offsets.size > 4e3) offsets.clear();
    offsets.set(key, offset);
  }
  return offset;
}

function intlOffsetMs(t: TimeMs, timeZone: string): number {
  // `Intl` takes the `Date` range only. Past its edges a zone keeps its
  // local mean time, which does not change, so the edge's offset holds.
  // "…, GMT+01:00": the zone's name ends the text. "GMT" alone means exactly
  // +00:00; otherwise "GMT±HH:MM" or "GMT±HH:MM:SS".
  const [, sign, hours = 0, minutes = 0, seconds = 0] = / GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(offsetFormatterFor(timeZone).format(Math.min(Math.max(t, -8.64e15), 8.64e15))) ?? [];
  const magnitude = ((+hours * 60 + +minutes) * 60 + +seconds) * MS_PER_SECOND;
  return sign === "-" ? -magnitude : magnitude;
}

/** Whether a proleptic Gregorian year has a 29 February. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Length of a month, 1-12, in days. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return DAYS_PER_MONTH[month - 1] ?? 30;
}

/**
 * Four hundred Gregorian years: 146 097 days, a whole number of weeks.
 *
 * `Date` stops at ±8.64e15 ms, but the engine's arithmetic has to step just
 * past that edge — the aligned tick before the first one in range, the wall
 * clock of the last instant east of Greenwich. Inside `Date` those came back
 * as `NaN` and took the frame down. The calendar repeats every 400 years,
 * weekdays included, so `Date` does the field work on a copy shifted by whole
 * cycles into the years 0-399, and the cycles are added back.
 */
const CYCLE_MS = 146_097 * 86_400_000;

/** Epoch milliseconds for calendar fields read as UTC. Fields may overflow. */
function instantFromUtcParts(parts: CalendarParts): TimeMs {
  // `Date.UTC` maps years 0-99 onto 1900-1999; `setUTCFullYear` does not, and
  // the engine has to survive year 50 as well as year 2050.
  const cycles = Math.floor(parts.year / 400);
  const date = new Date(0);
  date.setUTCFullYear(parts.year - cycles * 400, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return date.getTime() + cycles * CYCLE_MS;
}

/** A `Date` for the instant's wall fields, and the 400-year cycles taken off it. */
function shiftedDate(t: TimeMs): readonly [Date, number] {
  // Truncated first, as `new Date(t)` truncates, so a fractional instant
  // before the epoch reads the same millisecond it always did.
  const ms = Math.trunc(t);
  const cycles = Math.floor(ms / CYCLE_MS);
  return [new Date(ms - cycles * CYCLE_MS), cycles];
}

/** Calendar fields of an instant read as UTC, for any finite instant. */
function utcPartsOf(t: TimeMs): CalendarParts {
  const [date, cycles] = shiftedDate(t);
  return {
    year: date.getUTCFullYear() + cycles * 400,
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

/** Wall-clock fields of an instant in a zone. */
export function toCalendarParts(
  t: TimeMs,
  timeZone: string = DEFAULT_TIME_ZONE,
): CalendarParts {
  return utcPartsOf(t + zoneOffsetMs(t, timeZone));
}

/**
 * The instant a wall-clock reading denotes in a zone.
 *
 * Two passes over the offset: the first guess can land on the far side of a
 * daylight-saving transition, and re-reading the offset at the corrected
 * instant converges for every zone in the database. A wall-clock time that
 * does not exist (inside a spring-forward gap) is read with the offset from
 * before the gap, so it lands as far past the gap as it was into it: 02:30 on
 * the night New York springs forward is 03:30 EDT, and so is it in Budapest
 * (Temporal's "compatible"). A time that happens twice (the hour the clocks
 * go back) is the first of the two, east and west alike.
 */
export function fromCalendarParts(
  parts: CalendarParts,
  timeZone: string = DEFAULT_TIME_ZONE,
): TimeMs {
  const asUtc = instantFromUtcParts(parts);
  // The offsets a day before and a day after: no zone changes twice in two days.
  const early = asUtc - zoneOffsetMs(asUtc - MS_PER_DAY, timeZone);
  const late = asUtc - zoneOffsetMs(asUtc + MS_PER_DAY, timeZone);
  const reads = (t: TimeMs): boolean => t + zoneOffsetMs(t, timeZone) === asUtc;
  // Both read back: the earlier. Neither: a gap, crossed with the offset from before it.
  return reads(early) && reads(late) ? Math.min(early, late) : reads(late) ? late : early;
}

export function floorToMultiple(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

/** Calendar fields truncated to the start of the given unit. */
function truncateParts(parts: CalendarParts, granularity: Granularity): CalendarParts {
  const years = YEARS_PER_UNIT[granularity];
  if (years !== undefined) {
    return {
      year: years === 1 ? parts.year : floorToMultiple(parts.year, years),
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
  }
  switch (granularity) {
    case "month":
      return { ...parts, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 };
    case "day":
      return { ...parts, hour: 0, minute: 0, second: 0, millisecond: 0 };
    case "hour":
      return { ...parts, minute: 0, second: 0, millisecond: 0 };
    case "minute":
      return { ...parts, second: 0, millisecond: 0 };
    case "second":
      return { ...parts, millisecond: 0 };
    default:
      return parts;
  }
}

/**
 * The start of the unit containing `t`, in the given zone.
 *
 * Zone-aware on purpose: the start of a day in Asia/Kolkata is not on an hour
 * boundary in UTC, and a tick generator that assumed it would be puts every
 * label half an hour off.
 */
export function startOf(
  t: TimeMs,
  granularity: Granularity,
  timeZone: string = DEFAULT_TIME_ZONE,
): TimeMs {
  return fromCalendarParts(truncateParts(toCalendarParts(t, timeZone), granularity), timeZone);
}

function shiftMonths(parts: CalendarParts, delta: number): CalendarParts {
  const monthIndex = parts.month - 1 + delta;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

/**
 * Advance an instant by whole calendar units.
 *
 * Millisecond through hour are fixed durations. Day and coarser preserve the
 * wall clock: one day after 12:00 on the Sunday Europe/Budapest springs
 * forward is 12:00 the next day, 23 hours later. A month added to 31 January
 * lands on the last day of February rather than overflowing into March.
 */
export function addCalendar(
  t: TimeMs,
  granularity: Granularity,
  count: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): TimeMs {
  assertFiniteTime(t);
  if (!Number.isFinite(count)) {
    throw new RangeError(`Invalid step count: ${String(count)}`);
  }
  const fixed = FIXED_UNIT_MS[granularity];
  if (fixed !== undefined) {
    return t + fixed * count;
  }
  const parts = toCalendarParts(t, timeZone);
  const years = YEARS_PER_UNIT[granularity];
  if (years !== undefined) {
    return fromCalendarParts(shiftMonths(parts, years * count * 12), timeZone);
  }
  if (granularity === "month") {
    return fromCalendarParts(shiftMonths(parts, count), timeZone);
  }
  return fromCalendarParts({ ...parts, day: parts.day + count }, timeZone);
}

/** Day of the week of an instant in a zone, 1 = Monday to 7 = Sunday (ISO). */
export function isoWeekday(t: TimeMs, timeZone: string = DEFAULT_TIME_ZONE): number {
  const sundayFirst = shiftedDate(t + zoneOffsetMs(t, timeZone))[0].getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}
