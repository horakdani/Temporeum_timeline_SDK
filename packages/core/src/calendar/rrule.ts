/**
 * RFC 5545 recurrence rules, in the library's own code.
 *
 * A rule is read the way the RFC writes it — `FREQ=MONTHLY;BYDAY=1FR` — and
 * expanded into instants. Three decisions carry the file:
 *
 * 1. **The wall clock.** Every frequency steps through the wall-clock fields
 *    of the start in its zone, the way a calendar is read: a meeting at 9:00
 *    is at 9:00 after the clocks change, and `BYHOUR=9` means nine on the
 *    local clock. A local time that does not exist (inside a spring-forward
 *    gap) is taken with the offset before the gap, and one that happens
 *    twice (a fall-back hour) is the first of the two — RFC 5545, 3.3.5.
 *    Two readings that land on one instant are one occurrence (3.8.5.3).
 * 2. **One filter for every BYxxx part.** The RFC's table of which part
 *    "expands" and which "limits" is the same as filtering every day of the
 *    period: `BYMONTH` over the days of a year expands, over the one day of a
 *    `DAILY` period it limits. A period is a year, month, week, day, hour,
 *    minute or second; its candidate days pass every given part, its times
 *    come from `BYHOUR`, `BYMINUTE` and `BYSECOND`, and `BYSETPOS` picks
 *    among them.
 * 3. **The start always counts.** `DTSTART` is the first occurrence and the
 *    first one `COUNT` counts, even when the rule would not produce it (3.8.5.3).
 *
 * Nothing here knows the DOM or the calendar view; the zone arithmetic is the
 * core's (`zoneOffsetMs`), so the platform's IANA database is the only zone
 * data, as everywhere else.
 */

import { DEFAULT_TIME_ZONE, zoneOffsetMs } from "../calendar.js";
import { toTimeMs } from "../time.js";
import type { TimeInput, TimeMs } from "../types.js";

/** How often a rule repeats. */
export type Frequency = "YEARLY" | "MONTHLY" | "WEEKLY" | "DAILY" | "HOURLY" | "MINUTELY" | "SECONDLY";

/** A day of the week, as the RFC writes it. */
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** A `BYDAY` entry: a weekday, and which of them in the month or year (`1FR`, `-1SU`). */
export interface WeekdayNum {
  readonly day: Weekday;
  /** 1 is the first, -1 the last. Without it, every such weekday. */
  readonly n?: number;
}

/** A wall-clock reading in the recurrence's zone. `month` is 1-12. */
export interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
}

/** A recurrence rule: the RFC's `RRULE` value, field by field. */
export interface RecurrenceRule {
  readonly freq: Frequency;
  /** Every how many periods. 1 by default. */
  readonly interval?: number;
  /** How many occurrences, the start included. Not with `until`. */
  readonly count?: number;
  /**
   * The last moment an occurrence may start, inclusive: an instant (a UTC
   * `UNTIL`), or a wall-clock reading in the recurrence's zone (a date, or a
   * floating `UNTIL`). A date without a time is the whole day.
   */
  readonly until?: TimeInput | WallTime;
  readonly bySecond?: readonly number[];
  readonly byMinute?: readonly number[];
  readonly byHour?: readonly number[];
  readonly byDay?: readonly WeekdayNum[];
  readonly byMonthDay?: readonly number[];
  readonly byYearDay?: readonly number[];
  readonly byWeekNo?: readonly number[];
  readonly byMonth?: readonly number[];
  readonly bySetPos?: readonly number[];
  /** The day a week starts on, for `WEEKLY` and `BYWEEKNO`. Monday by default. */
  readonly wkst?: Weekday;
}

/** A recurring start: the RFC's `DTSTART`, `RRULE`, `RDATE` and `EXDATE`. */
export interface Recurrence {
  readonly start: TimeInput;
  /** The zone the rule is read in. UTC by default — a floating time is read here too. */
  readonly timeZone?: string;
  readonly rule?: RecurrenceRule | string;
  /** Extra starts. */
  readonly rdates?: readonly TimeInput[];
  /** Starts taken out, after `COUNT` has counted them. */
  readonly exdates?: readonly TimeInput[];
}

/** Which occurrences: `from` inclusive, `to` exclusive, at most `limit`. */
export interface OccurrenceRange {
  readonly from?: TimeInput;
  readonly to?: TimeInput;
  readonly limit?: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Monday first, the RFC's spelling. */
export const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const FREQUENCIES: readonly Frequency[] = ["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
/** Wall clocks past this year are not searched: a rule that never matches ends here. */
const LAST_YEAR = 9999;

// --- wall-clock arithmetic ------------------------------------------------------

/** Milliseconds of a wall-clock reading, read as if it were UTC. */
export function wallMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** The weekday of a day number (days since 1970-01-01), Monday = 0. */
const weekdayOf = (day: number): number => (((day + 3) % 7) + 7) % 7;

/** The wall clock of an instant in a zone. */
export function wallOf(t: TimeMs, timeZone: string): number {
  return t + zoneOffsetMs(t, timeZone);
}

/**
 * The instant a wall-clock reading means in a zone, the RFC's way: inside a
 * gap with the offset before it, in a repeated hour the first one.
 */
export function instantOf(wall: number, timeZone: string): TimeMs {
  if (timeZone === "UTC") return wall;
  const before = zoneOffsetMs(wall - DAY, timeZone);
  const after = zoneOffsetMs(wall + DAY, timeZone);
  const early = wall - before;
  if (before === after && zoneOffsetMs(early, timeZone) === before) return early;
  const late = wall - after;
  const earlyHolds = zoneOffsetMs(early, timeZone) === before;
  const lateHolds = zoneOffsetMs(late, timeZone) === after;
  if (earlyHolds && lateHolds) return Math.min(early, late);
  if (lateHolds) return late;
  return early;
}

// --- parsing --------------------------------------------------------------------

function integers(value: string, min: number, max: number, signed: boolean, key: string): number[] {
  return value.split(",").map((part) => {
    const n = Number(part);
    if (!/^[+-]?\d+$/.test(part) || n > max || n < (signed ? -max : min) || (signed && n === 0)) {
      throw new SyntaxError(`RRULE: ${key} has an invalid value ${JSON.stringify(part)}`);
    }
    return n;
  });
}

/** An iCal date or date-time: `19970902`, `19970902T090000`, `19970902T090000Z`. */
export function parseDateValue(value: string): { readonly wall: WallTime; readonly utc: boolean; readonly date: boolean } {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value.trim());
  if (match === null) throw new SyntaxError(`Invalid iCalendar date ${JSON.stringify(value)}`);
  const [, y, mo, d, h, mi, s, z] = match;
  const date = h === undefined;
  return {
    wall: { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h ?? 0), minute: Number(mi ?? 0), second: Number(s ?? 0) },
    utc: z === "Z",
    date,
  };
}

/**
 * A rule from its RFC text: `FREQ=WEEKLY;BYDAY=TU,TH`, with or without the
 * `RRULE:` name. Parts the RFC does not define are ignored, as it asks of an
 * `x-name`; a value out of range is an error, not a guess.
 */
export function parseRRule(text: string): RecurrenceRule {
  const body = text.trim().replace(/^RRULE:/i, "");
  const rule: { -readonly [K in keyof RecurrenceRule]: RecurrenceRule[K] } = { freq: "DAILY" };
  let freq: Frequency | undefined;
  for (const part of body.split(";")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1).toUpperCase();
    if (eq <= 0 || value === "") throw new SyntaxError(`RRULE: ${JSON.stringify(part)} is not KEY=VALUE`);
    switch (key) {
      case "FREQ":
        if (!(FREQUENCIES as readonly string[]).includes(value)) throw new SyntaxError(`RRULE: unknown FREQ ${value}`);
        freq = value as Frequency;
        break;
      case "INTERVAL":
        rule.interval = integers(value, 1, Number.MAX_SAFE_INTEGER, false, key)[0] ?? 1;
        break;
      case "COUNT":
        rule.count = integers(value, 1, Number.MAX_SAFE_INTEGER, false, key)[0] ?? 1;
        break;
      case "UNTIL": {
        const parsed = parseDateValue(value);
        const w = parsed.wall;
        rule.until = parsed.utc ? wallMs(w.year, w.month, w.day, w.hour, w.minute, w.second) : parsed.date ? { year: w.year, month: w.month, day: w.day } : w;
        break;
      }
      case "BYSECOND":
        rule.bySecond = integers(value, 0, 60, false, key);
        break;
      case "BYMINUTE":
        rule.byMinute = integers(value, 0, 59, false, key);
        break;
      case "BYHOUR":
        rule.byHour = integers(value, 0, 23, false, key);
        break;
      case "BYDAY":
        rule.byDay = value.split(",").map((each) => {
          const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(each);
          const n = match?.[1] === undefined ? undefined : Number(match[1]);
          if (match === null || n === 0 || (n !== undefined && Math.abs(n) > 53)) throw new SyntaxError(`RRULE: BYDAY has an invalid value ${JSON.stringify(each)}`);
          return n === undefined ? { day: match[2] as Weekday } : { day: match[2] as Weekday, n };
        });
        break;
      case "BYMONTHDAY":
        rule.byMonthDay = integers(value, 1, 31, true, key);
        break;
      case "BYYEARDAY":
        rule.byYearDay = integers(value, 1, 366, true, key);
        break;
      case "BYWEEKNO":
        rule.byWeekNo = integers(value, 1, 53, true, key);
        break;
      case "BYMONTH":
        rule.byMonth = integers(value, 1, 12, false, key);
        break;
      case "BYSETPOS":
        rule.bySetPos = integers(value, 1, 366, true, key);
        break;
      case "WKST":
        if (!(WEEKDAYS as readonly string[]).includes(value)) throw new SyntaxError(`RRULE: unknown WKST ${value}`);
        rule.wkst = value as Weekday;
        break;
      default:
        break;
    }
  }
  if (freq === undefined) throw new SyntaxError("RRULE: FREQ is required");
  if (rule.count !== undefined && rule.until !== undefined) throw new SyntaxError("RRULE: COUNT and UNTIL cannot both be given");
  rule.freq = freq;
  return rule;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** A wall-clock reading as iCal writes it: `19970902T090000`, or `19970902` for a date. */
export function formatWall(wall: number, date = false): string {
  const d = new Date(wall);
  const day = `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return date ? day : `${day}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const isWallTime = (value: unknown): value is WallTime => typeof value === "object" && value !== null && !(value instanceof Date);

/** A rule as RFC text, without the `RRULE:` name, in a fixed order. */
export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  const list = (key: string, values: readonly (number | string)[] | undefined): void => {
    if (values !== undefined && values.length > 0) parts.push(`${key}=${values.join(",")}`);
  };
  if (rule.interval !== undefined && rule.interval !== 1) parts.push(`INTERVAL=${String(rule.interval)}`);
  if (rule.count !== undefined) parts.push(`COUNT=${String(rule.count)}`);
  if (rule.until !== undefined) {
    const until = rule.until;
    parts.push(
      `UNTIL=${
        isWallTime(until)
          ? formatWall(wallMs(until.year, until.month, until.day, until.hour, until.minute, until.second), until.hour === undefined)
          : `${formatWall(toTimeMs(until))}Z`
      }`,
    );
  }
  list("BYMONTH", rule.byMonth);
  list("BYWEEKNO", rule.byWeekNo);
  list("BYYEARDAY", rule.byYearDay);
  list("BYMONTHDAY", rule.byMonthDay);
  list("BYDAY", rule.byDay?.map((each) => `${each.n === undefined ? "" : String(each.n)}${each.day}`));
  list("BYHOUR", rule.byHour);
  list("BYMINUTE", rule.byMinute);
  list("BYSECOND", rule.bySecond);
  list("BYSETPOS", rule.bySetPos);
  if (rule.wkst !== undefined && rule.wkst !== "MO") parts.push(`WKST=${rule.wkst}`);
  return parts.join(";");
}

// --- expansion ------------------------------------------------------------------

interface Plan {
  readonly freq: number;
  readonly interval: number;
  readonly count: number | undefined;
  readonly untilInstant: number | undefined;
  readonly untilWall: number | undefined;
  readonly byMonth: ReadonlySet<number> | undefined;
  readonly byWeekNo: readonly number[] | undefined;
  readonly byYearDay: readonly number[] | undefined;
  readonly byMonthDay: readonly number[] | undefined;
  readonly byDay: readonly { readonly day: number; readonly n: number | undefined }[] | undefined;
  readonly hours: readonly number[] | undefined;
  readonly minutes: readonly number[] | undefined;
  readonly seconds: readonly number[] | undefined;
  readonly bySetPos: readonly number[] | undefined;
  readonly wkst: number;
}

const F_SECONDLY = 0;
const F_MINUTELY = 1;
const F_HOURLY = 2;
const F_DAILY = 3;
const F_WEEKLY = 4;
const F_MONTHLY = 5;
const F_YEARLY = 6;

function planOf(rule: RecurrenceRule, start: number): Plan {
  const freq = FREQUENCIES.indexOf(rule.freq);
  const s = new Date(start);
  const noDayPart = rule.byWeekNo === undefined && rule.byYearDay === undefined && rule.byMonthDay === undefined && rule.byDay === undefined;
  let byMonth = rule.byMonth;
  let byMonthDay = rule.byMonthDay;
  let byDay = rule.byDay?.map((each) => ({ day: WEEKDAYS.indexOf(each.day), n: freq >= F_MONTHLY ? each.n : undefined }));
  if (noDayPart) {
    if (freq === F_YEARLY) {
      byMonth ??= [s.getUTCMonth() + 1];
      byMonthDay = [s.getUTCDate()];
    } else if (freq === F_MONTHLY) {
      byMonthDay = [s.getUTCDate()];
    } else if (freq === F_WEEKLY) {
      byDay = [{ day: weekdayOf(Math.floor(start / DAY)), n: undefined }];
    }
  }
  const sorted = (values: readonly number[] | undefined): readonly number[] | undefined => (values === undefined ? undefined : [...new Set(values)].sort((a, b) => a - b));
  let untilInstant: number | undefined;
  let untilWall: number | undefined;
  if (rule.until !== undefined) {
    const until = rule.until;
    if (isWallTime(until)) {
      untilWall =
        until.hour === undefined ? wallMs(until.year, until.month, until.day) + DAY - SECOND : wallMs(until.year, until.month, until.day, until.hour, until.minute, until.second);
    } else {
      untilInstant = toTimeMs(until);
    }
  }
  return {
    freq,
    interval: rule.interval ?? 1,
    count: rule.count,
    untilInstant,
    untilWall,
    byMonth: byMonth === undefined ? undefined : new Set(byMonth),
    byWeekNo: rule.byWeekNo,
    byYearDay: rule.byYearDay,
    byMonthDay,
    byDay,
    hours: sorted(rule.byHour ?? (freq > F_HOURLY ? [s.getUTCHours()] : undefined)),
    minutes: sorted(rule.byMinute ?? (freq > F_MINUTELY ? [s.getUTCMinutes()] : undefined)),
    seconds: sorted(rule.bySecond ?? (freq > F_SECONDLY ? [s.getUTCSeconds()] : undefined)),
    bySetPos: rule.bySetPos,
    wkst: WEEKDAYS.indexOf(rule.wkst ?? "MO"),
  };
}

/** The first day of week 1 of a year: the first week, starting on `wkst`, with at least four days in it. */
function weekOneStart(year: number, wkst: number): number {
  const jan1 = wallMs(year, 1, 1) / DAY;
  const back = (weekdayOf(jan1) - wkst + 7) % 7;
  return 7 - back >= 4 ? jan1 - back : jan1 - back + 7;
}

/** Whether a day is in one of the weeks of `BYWEEKNO`, counted in the week-year it belongs to. */
function inWeeks(day: number, year: number, weeks: readonly number[], wkst: number): boolean {
  let first = weekOneStart(year, wkst);
  let next = weekOneStart(year + 1, wkst);
  if (day < first) {
    next = first;
    first = weekOneStart(year - 1, wkst);
  } else if (day >= next) {
    first = next;
    next = weekOneStart(year + 2, wkst);
  }
  const no = Math.floor((day - first) / 7) + 1;
  const total = (next - first) / 7;
  return weeks.some((week) => week === no || week === no - total - 1);
}

/** Whether a day passes every day-level part of the plan. */
function dayPasses(plan: Plan, day: number): boolean {
  const date = new Date(day * DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const dom = date.getUTCDate();
  if (plan.byMonth !== undefined && !plan.byMonth.has(month)) return false;
  if (plan.byWeekNo !== undefined && !inWeeks(day, year, plan.byWeekNo, plan.wkst)) return false;
  const yearStart = wallMs(year, 1, 1) / DAY;
  const yearLength = wallMs(year + 1, 1, 1) / DAY - yearStart;
  const yday = day - yearStart + 1;
  if (plan.byYearDay !== undefined && !plan.byYearDay.some((n) => n === yday || n === yday - yearLength - 1)) return false;
  const monthLength = new Date(wallMs(year, month + 1, 0)).getUTCDate();
  if (plan.byMonthDay !== undefined && !plan.byMonthDay.some((n) => n === dom || n === dom - monthLength - 1)) return false;
  if (plan.byDay !== undefined) {
    const weekday = weekdayOf(day);
    // An ordinal counts in the month for MONTHLY, and for YEARLY with BYMONTH;
    // otherwise in the year.
    const inMonth = plan.freq === F_MONTHLY || (plan.freq === F_YEARLY && plan.byMonth !== undefined);
    const index = inMonth ? dom : yday;
    const length = inMonth ? monthLength : yearLength;
    const nth = Math.floor((index - 1) / 7) + 1;
    const nthLast = -(Math.floor((length - index) / 7) + 1);
    if (!plan.byDay.some((each) => each.day === weekday && (each.n === undefined || each.n === nth || each.n === nthLast))) return false;
  }
  return true;
}

/** The candidate wall clocks of one period, sorted, `BYSETPOS` applied. */
function periodCandidates(plan: Plan, firstDay: number, days: number, fixed: readonly number[]): number[] {
  const out: number[] = [];
  const [fh, fm, fs] = fixed;
  for (let day = firstDay; day < firstDay + days; day += 1) {
    if (!dayPasses(plan, day)) continue;
    const hours = fh === undefined ? (plan.hours ?? []) : plan.hours === undefined || plan.hours.includes(fh) ? [fh] : [];
    const minutes = fm === undefined ? (plan.minutes ?? []) : plan.minutes === undefined || plan.minutes.includes(fm) ? [fm] : [];
    const seconds = fs === undefined ? (plan.seconds ?? []) : plan.seconds === undefined || plan.seconds.includes(fs) ? [fs] : [];
    for (const h of hours) for (const m of minutes) for (const s of seconds) if (s < 60) out.push(day * DAY + h * HOUR + m * MINUTE + s * SECOND);
  }
  if (plan.bySetPos === undefined) return out;
  const picked = new Set<number>();
  for (const pos of plan.bySetPos) {
    const at = pos > 0 ? out[pos - 1] : out[out.length + pos];
    if (at !== undefined) picked.add(at);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The periods of a plan, from the one containing the start: each is a run of
 * days and the hour, minute and second it fixes (sub-daily frequencies).
 */
function* periods(plan: Plan, start: number, fromWall: number | undefined): Generator<readonly [number, number, readonly number[], number]> {
  const startDay = Math.floor(start / DAY);
  const s = new Date(start);
  const year0 = s.getUTCFullYear();
  const month0 = year0 * 12 + s.getUTCMonth();
  const step = plan.interval;
  // Without COUNT the periods before the range can be skipped whole: the
  // occurrences of a period never depend on the ones before it.
  const skipTo = (unitsFromStart: number): number => (plan.count === undefined && fromWall !== undefined && unitsFromStart > 0 ? Math.floor(unitsFromStart / step) : 0);
  switch (plan.freq) {
    case F_YEARLY: {
      const fromYear = fromWall === undefined ? year0 : new Date(fromWall).getUTCFullYear() - 1;
      for (let p = skipTo(fromYear - year0); ; p += 1) {
        const year = year0 + p * step;
        if (year > LAST_YEAR) return;
        const first = wallMs(year, 1, 1) / DAY;
        yield [first, wallMs(year + 1, 1, 1) / DAY - first, [], first * DAY];
      }
    }
    case F_MONTHLY: {
      const f = fromWall === undefined ? undefined : new Date(fromWall);
      const fromMonth = f === undefined ? month0 : f.getUTCFullYear() * 12 + f.getUTCMonth() - 1;
      for (let p = skipTo(fromMonth - month0); ; p += 1) {
        const index = month0 + p * step;
        const year = Math.floor(index / 12);
        if (year > LAST_YEAR) return;
        const month = index - year * 12 + 1;
        const first = wallMs(year, month, 1) / DAY;
        yield [first, wallMs(year, month + 1, 1) / DAY - first, [], first * DAY];
      }
    }
    case F_WEEKLY: {
      const week0 = startDay - ((weekdayOf(startDay) - plan.wkst + 7) % 7);
      const fromDay = fromWall === undefined ? week0 : Math.floor(fromWall / DAY) - 7;
      const end = wallMs(LAST_YEAR + 1, 1, 1);
      for (let p = skipTo(Math.floor((fromDay - week0) / 7)); ; p += 1) {
        const first = week0 + p * 7 * step;
        if (first * DAY > end) return;
        yield [first, 7, [], first * DAY];
      }
    }
    default: {
      const unit = [SECOND, MINUTE, HOUR, DAY][plan.freq] ?? DAY;
      const base = Math.floor(start / unit);
      const fromUnit = fromWall === undefined ? base : Math.floor((fromWall - DAY) / unit);
      let p = skipTo(fromUnit - base);
      const end = wallMs(LAST_YEAR + 1, 1, 1);
      for (;;) {
        const at = (base + p * step) * unit;
        if (at >= end) return;
        const day = Math.floor(at / DAY);
        if (plan.freq < F_DAILY && !dayPasses(plan, day)) {
          // Nothing in this day can pass: jump to the first period of the next.
          p = Math.max(p + 1, Math.ceil(((day + 1) * DAY / unit - base) / step));
          continue;
        }
        const d = new Date(at);
        const fixed = plan.freq === F_DAILY ? [] : plan.freq === F_HOURLY ? [d.getUTCHours()] : plan.freq === F_MINUTELY ? [d.getUTCHours(), d.getUTCMinutes()] : [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
        yield [day, 1, fixed, at];
        p += 1;
      }
    }
  }
}

/**
 * The starts of a recurrence, in order: the rule's, the extra dates, less
 * the excluded ones, within the range.
 *
 * A rule with neither `COUNT` nor `UNTIL` repeats forever, so the range
 * needs an end (`to` or `limit`); without one this throws, rather than run
 * until the year 9999.
 */
export function occurrences(recurrence: Recurrence, range: OccurrenceRange = {}): TimeMs[] {
  const zone = recurrence.timeZone ?? DEFAULT_TIME_ZONE;
  const startInstant = toTimeMs(recurrence.start);
  const from = range.from === undefined ? -Infinity : toTimeMs(range.from);
  const to = range.to === undefined ? Infinity : toTimeMs(range.to);
  const limit = range.limit ?? Infinity;
  const rule = typeof recurrence.rule === "string" ? parseRRule(recurrence.rule) : recurrence.rule;
  const excluded = new Set((recurrence.exdates ?? []).map(toTimeMs));
  const found = new Set<number>();
  const take = (t: number): void => {
    if (t >= from && t < to && !excluded.has(t)) found.add(t);
  };
  take(startInstant);
  for (const extra of recurrence.rdates ?? []) take(toTimeMs(extra));

  if (rule !== undefined) {
    if (rule.count === undefined && rule.until === undefined && to === Infinity && limit === Infinity) {
      throw new RangeError("An unbounded recurrence needs a range end (`to`) or a `limit`");
    }
    const start = wallOf(startInstant, zone);
    const plan = planOf(rule, start);
    const toWall = to === Infinity ? Infinity : wallOf(to, zone) + DAY;
    let counted = 1;
    // Two wall clocks can mean one instant (the far side of a gap); the
    // instant is one occurrence, and COUNT counts it once.
    const seen = new Set<number>();
    // Whether the rule's own occurrences are past the range: with a limit,
    // once enough of them are in it.
    let inRange = 0;
    outer: for (const [firstDay, days, fixed, periodStart] of periods(plan, start, from === -Infinity ? undefined : wallOf(from, zone))) {
      if (periodStart > toWall) break;
      for (const wall of periodCandidates(plan, firstDay, days, fixed)) {
        if (wall <= start) continue;
        if (plan.untilWall !== undefined && wall > plan.untilWall) break outer;
        const t = instantOf(wall, zone);
        if (t <= startInstant || seen.has(t)) continue;
        seen.add(t);
        if (plan.untilInstant !== undefined && t > plan.untilInstant) break outer;
        if (plan.count !== undefined && counted >= plan.count) break outer;
        counted += 1;
        if (t >= to) break outer;
        if (t >= from) {
          take(t);
          inRange += 1;
          if (inRange > limit) break outer;
        }
      }
    }
  }
  const sorted = [...found].sort((a, b) => a - b);
  return sorted.length > limit ? sorted.slice(0, limit) : sorted;
}
