/**
 * Ticks in a calendar of the host's: Hebrew, Islamic, Persian, Chinese,
 * Japanese, Buddhist, Indian, Ethiopic — any calendar `Intl` knows.
 *
 * A day is a day in every calendar, so day, hour and finer ticks are the
 * core's own; only which day is "major" — the first of a month — is the
 * calendar's. Months and years are not: a Hebrew month begins with the new
 * moon, a Persian year at the equinox, and an axis that put a month tick on
 * the Gregorian first would be wrong on every tick. Those ticks are where
 * the calendar's own fields say a unit begins: the day whose day-of-month
 * is 1, and the month in which the year changes.
 *
 * The fields come from `Intl.DateTimeFormat` with the calendar, read at the
 * zone's midnights. Nothing is tabulated, so the package ships no calendar
 * data, and every calendar the platform has works the same way. A day's
 * fields are asked once and kept: an axis asks for the same few hundred days
 * frame after frame.
 *
 * Multi-year steps align to the calendar's own year numbers — a Hebrew
 * decade starts in 5790, a Buddhist one in 2570. The Japanese calendar's
 * years restart with each era, so its decades and longer steps are the
 * Gregorian ones; a single year, a month and a day are the era's.
 */

import { addCalendar, startOf, YEARS_PER_UNIT } from "../calendar.js";
import type { TimeWarp } from "../scale.js";
import { chooseTickStep, DEFAULT_MAX_TICKS, DEFAULT_TICK_SPACING_PX, generateTicks } from "../ticks.js";
import type { Tick, TickOptions } from "../ticks.js";
import type { Domain, Granularity, TimeMs } from "../types.js";

/** A day's place in a calendar. */
export interface CalendarFields {
  /** The era, where the calendar has them: "AH", "AM", "Reiwa". Empty otherwise. */
  readonly era: string;
  /** The year as the calendar numbers it; for the Chinese calendars, the related Gregorian year. */
  readonly year: number;
  /** The month as `Intl` names it with `month: "numeric"` — a number in most calendars, a name in some. */
  readonly month: string;
  readonly day: number;
}

/** Calendars whose months and years are the Gregorian ones: the core's ticks are theirs. */
const GREGORIAN = new Set(["gregory", "iso8601"]);

/** Calendars whose year numbers are not one count: their long steps are Gregorian. */
const ERA_YEARS = new Set(["japanese"]);

const DAY_MS = 86_400_000;

interface Reader {
  readonly format: Intl.DateTimeFormat;
  readonly days: Map<number, CalendarFields>;
}

const readers = new Map<string, Reader>();

/** A bound on each calendar's kept days: a long pan does not grow it without end. */
const KEPT_DAYS = 20_000;

function readerOf(calendar: string, timeZone: string): Reader {
  const key = `${calendar}\u0000${timeZone}`;
  let reader = readers.get(key);
  if (reader === undefined) {
    reader = {
      // Latin digits whatever the calendar's own: these are read, not shown.
      format: new Intl.DateTimeFormat("en-US-u-nu-latn", { calendar, timeZone, era: "short", year: "numeric", month: "numeric", day: "numeric" }),
      days: new Map(),
    };
    readers.set(key, reader);
  }
  return reader;
}

/** The calendar's fields of the day an instant is in, in a zone. */
export function calendarFields(time: TimeMs, calendar: string, timeZone = "UTC"): CalendarFields {
  const reader = readerOf(calendar, timeZone);
  const day = startOf(time, "day", timeZone);
  let fields = reader.days.get(day);
  if (fields === undefined) {
    let era = "";
    let year = Number.NaN;
    let related = Number.NaN;
    let month = "";
    let date = Number.NaN;
    for (const part of reader.format.formatToParts(day)) {
      // `relatedYear` is the Chinese calendars' part, newer than the lib's union.
      const type: string = part.type;
      if (type === "era") era = part.value;
      else if (type === "year") year = Number.parseInt(part.value, 10);
      else if (type === "relatedYear") related = Number.parseInt(part.value, 10);
      else if (type === "month") month = part.value;
      else if (type === "day") date = Number.parseInt(part.value, 10);
    }
    fields = { era, year: Number.isNaN(related) ? year : related, month, day: date };
    if (reader.days.size >= KEPT_DAYS) reader.days.clear();
    reader.days.set(day, fields);
  }
  return fields;
}

/** The units of one calendar in one zone. */
interface Units {
  fields(time: TimeMs): CalendarFields;
  monthStartAtOrBefore(time: TimeMs): TimeMs;
  nextMonthStart(start: TimeMs): TimeMs;
  isYearStart(monthStart: TimeMs): boolean;
  yearStartAtOrBefore(time: TimeMs): TimeMs;
  nextYearStart(start: TimeMs): TimeMs;
}

function unitsOf(calendar: string, timeZone: string): Units {
  const fields = (time: TimeMs): CalendarFields => calendarFields(time, calendar, timeZone);
  const days = (time: TimeMs, count: number): TimeMs => addCalendar(startOf(time, "day", timeZone), "day", count, timeZone);
  const yearKey = (f: CalendarFields): string => `${f.era}\u0000${String(f.year)}`;
  // Every calendar numbers a month's days from one, one by one: its first
  // day is as many days back as the day's number, less one.
  const monthStartAtOrBefore = (time: TimeMs): TimeMs => {
    const day = startOf(time, "day", timeZone);
    return days(day, 1 - fields(day).day);
  };
  const nextMonthStart = (start: TimeMs): TimeMs => {
    // No month is shorter than 29 days but the Ethiopic and Coptic thirteenth,
    // of five or six: 28 days on is in this month's last days, or in the
    // month after a short one — whose first day is then the answer.
    let day = days(start, 28);
    const back = monthStartAtOrBefore(day);
    if (back > start) return back;
    for (let step = 0; step < 10 && fields(day).day !== 1; step += 1) day = days(day, 1);
    return day;
  };
  const isYearStart = (monthStart: TimeMs): boolean => yearKey(fields(monthStart)) !== yearKey(fields(days(monthStart, -1)));
  const yearStartAtOrBefore = (time: TimeMs): TimeMs => {
    let month = monthStartAtOrBefore(time);
    for (let step = 0; step < 14 && !isYearStart(month); step += 1) month = monthStartAtOrBefore(days(month, -1));
    return month;
  };
  const nextYearStart = (start: TimeMs): TimeMs => {
    let month = nextMonthStart(start);
    for (let step = 0; step < 14 && !isYearStart(month); step += 1) month = nextMonthStart(month);
    return month;
  };
  return { fields, monthStartAtOrBefore, nextMonthStart, isYearStart, yearStartAtOrBefore, nextYearStart };
}

/** A calendar's units of time for its ticks, and where hidden time is. */
export interface CalendarTickOptions {
  /**
   * Hidden dates (`createHiddenDates` in `/tools`): the step is chosen at the
   * shown zoom, and the ticks a hidden stretch swallows become one at its
   * seam — the latest of them, as the hidden dates' own ticks do.
   */
  readonly hidden?: TimeWarp;
}

/**
 * The axis's ticks in a calendar: a `ticks` source for `renderTimeline`
 * (`generateTicks`'s contract), so its months and years are the calendar's.
 *
 * ```ts
 * renderTimeline({ ...options, ticks: calendarTicks("hebrew"), formatTick: calendarTickLabel("he", "hebrew") });
 * ```
 *
 * A Gregorian calendar (`gregory`, `iso8601`) gives the core's own ticks.
 */
export function calendarTicks(
  calendar: string,
  options: CalendarTickOptions = {},
): (domain: Domain, mainSize: number, tickOptions?: TickOptions) => readonly Tick[] {
  const hidden = options.hidden;
  return (domain, mainSize, tickOptions = {}) => {
    const timeZone = tickOptions.timeZone ?? "UTC";
    const maxTicks = tickOptions.maxTicks ?? DEFAULT_MAX_TICKS;
    const span = hidden === undefined ? domain[1] - domain[0] : hidden.toShown(domain[1]) - hidden.toShown(domain[0]);
    if (!(mainSize > 0) || !(span > 0)) return [];
    const step = chooseTickStep(span / mainSize, tickOptions.targetSpacingPx ?? DEFAULT_TICK_SPACING_PX);
    // Ticks that land on one seam: the later one names it.
    const seams = (ticks: readonly Tick[]): Tick[] => {
      if (hidden === undefined) return [...ticks];
      const out: Tick[] = [];
      for (const tick of ticks) {
        const previous = out[out.length - 1];
        if (previous !== undefined && hidden.toShown(previous.time) === hidden.toShown(tick.time)) out[out.length - 1] = tick;
        else out.push(tick);
      }
      return out;
    };
    // The core's ticks over the real domain, at the zoom of the shown one.
    const plain = (): Tick[] => [
      ...generateTicks(domain, ((domain[1] - domain[0]) * mainSize) / span, {
        timeZone,
        targetSpacingPx: tickOptions.targetSpacingPx ?? DEFAULT_TICK_SPACING_PX,
        maxTicks,
      }),
    ];
    if (GREGORIAN.has(calendar)) return hidden?.ticks === undefined ? plain() : [...hidden.ticks(domain, mainSize, tickOptions)];
    return seams(calendarSteps(domain, step.granularity, step.count, unitsOf(calendar, timeZone), calendar, maxTicks, plain));
  };
}

function calendarSteps(
  domain: Domain,
  granularity: Granularity,
  count: number,
  units: Units,
  calendar: string,
  maxTicks: number,
  plain: () => Tick[],
): Tick[] {
  const [start, end] = domain;
  const years = (YEARS_PER_UNIT[granularity] ?? 0) * count;
  if (granularity !== "month" && years === 0) {
    // A day or finer: the core's ticks, with the calendar's month starts major.
    return plain().map((tick) => (tick.granularity === "day" ? { ...tick, major: units.fields(tick.time).day === 1 } : tick));
  }
  const ticks: Tick[] = [];
  if (granularity === "month") {
    // Months counted from each year's first, so a quarter is the calendar's
    // own three months whether its year has twelve or thirteen.
    let month = units.yearStartAtOrBefore(start);
    let index = 0;
    while (month <= end && ticks.length < maxTicks) {
      const yearStart = index === 0 || units.isYearStart(month);
      if (yearStart) index = 0;
      if (month >= start && index % count === 0) ticks.push({ time: month, granularity, major: yearStart });
      month = units.nextMonthStart(month);
      index += 1;
    }
    return ticks;
  }
  if (ERA_YEARS.has(calendar) && years > 1) return plain();
  // Years: each year's first day whose number is a multiple of the step.
  // Far steps jump by the calendar's mean year and settle on the start.
  let year = units.yearStartAtOrBefore(start);
  const first = units.fields(year).year;
  if (years === 1) {
    while (year <= end && ticks.length < maxTicks) {
      if (year >= start) ticks.push({ time: year, granularity, major: units.fields(year).year % 10 === 0 });
      year = units.nextYearStart(year);
    }
    return ticks;
  }
  // The mean year: a lunar one for the Islamic calendars, a solar one for the
  // rest — the lunisolar ones keep to the sun over their cycles.
  const mean = (calendar.startsWith("islamic") ? 354.367 : 365.2425) * DAY_MS;
  let wanted = Math.ceil(first / years) * years;
  let anchor = year;
  let anchorYear = first;
  const major = years * 10;
  for (let guard = 0; guard < maxTicks * 4 && ticks.length < maxTicks; guard += 1) {
    let at = units.yearStartAtOrBefore(anchor + (wanted - anchorYear) * mean + 15 * DAY_MS);
    // Settle: jump by mean years while far, then a year at a time.
    for (let fix = 0; fix < 8; fix += 1) {
      const off = wanted - units.fields(at).year;
      if (Math.abs(off) <= 1) break;
      at = units.yearStartAtOrBefore(at + off * mean + 15 * DAY_MS);
    }
    if (units.fields(at).year < wanted) at = units.nextYearStart(at);
    if (units.fields(at).year > wanted) at = units.yearStartAtOrBefore(at - DAY_MS);
    if (at > end) break;
    if (at >= start && units.fields(at).year === wanted) ticks.push({ time: at, granularity, major: wanted % major === 0 });
    anchor = at;
    anchorYear = units.fields(at).year;
    wanted += years;
  }
  return ticks;
}

const labels = new Map<string, Intl.DateTimeFormat>();

function labelFormat(locale: string, calendar: string | undefined, timeZone: string, kind: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}\u0000${calendar ?? ""}\u0000${timeZone}\u0000${kind}`;
  let format = labels.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone, ...(calendar === undefined ? {} : { calendar }) });
    labels.set(key, format);
  }
  return format;
}

/**
 * Tick labels in a locale, from `Intl`: a `formatTick` for `renderTimeline`.
 * In the calendar given, or the locale's own. A major tick names its larger
 * unit too — a month's first day its month, a year's first month its year.
 *
 * Not the core's default on purpose: `Intl` output differs between engines
 * and their versions, and the default frame must be the same on every
 * machine. A localised axis is this one call.
 */
export function calendarTickLabel(locale: string, calendar?: string): (tick: Tick, timeZone: string) => string {
  return (tick, timeZone) => {
    const as = (kind: string, options: Intl.DateTimeFormatOptions): string => labelFormat(locale, calendar, timeZone, kind, options).format(tick.time);
    if (tick.context === true) {
      // The axis's context label: the coarser unit, in the calendar's words.
      switch (tick.granularity) {
        case "millisecond":
          return as("s", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        case "second":
          return as("cs", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        case "minute":
        case "hour":
          return as("cd", { year: "numeric", month: "short", day: "numeric" });
        case "day":
          return as("cm", { year: "numeric", month: "long" });
        case "month":
          return as("y", { year: "numeric" });
        default:
          return "";
      }
    }
    switch (tick.granularity) {
      case "millisecond":
        return as("ms", { second: "2-digit", fractionalSecondDigits: 3 });
      case "second":
        return as("s", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      case "minute":
      case "hour":
        return tick.major && tick.granularity === "hour" ? as("md", { month: "short", day: "numeric" }) : as("hm", { hour: "2-digit", minute: "2-digit" });
      case "day":
        return tick.major ? as("md", { month: "short", day: "numeric" }) : as("d", { day: "numeric" });
      case "month":
        return tick.major ? as("ym", { year: "numeric", month: "short" }) : as("m", { month: "short" });
      default:
        return as("y", { year: "numeric" });
    }
  };
}
