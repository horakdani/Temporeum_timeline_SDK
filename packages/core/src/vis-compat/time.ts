/**
 * vis-timeline's times, read the way vis-timeline 8 reads them: its
 * `convert(value, "Date")`, which hands strings to moment.
 *
 * - a number is epoch milliseconds, a `Date` its time, a moment (anything
 *   with a numeric `valueOf` and `_isAMomentObject`, or a `toDate`) its time;
 * - `"/Date(1198908717056)/"` (ASP.NET) and a string of digits only are
 *   epoch milliseconds — `"2014"` too, as in vis-timeline;
 * - ISO 8601, extended or basic, calendar, week or ordinal dates: with `Z`
 *   or an offset it is that instant; without one it is the wall clock of
 *   the zone, as moment reads local time — inside a gap with the offset
 *   before it, in a repeated hour the first one, as `new Date(y, m, d, h)`;
 * - RFC 2822 (`"Tue, 01 Nov 2016 13:23:12 +0630"`);
 * - anything else is the runtime's `Date.parse`, as moment falls back to
 *   it; without an explicit zone in the text, its wall clock is moved into
 *   the zone asked for.
 */

import { zoneOffsetMs } from "../calendar.js";
import type { TimeMs } from "../types.js";

/** What vis-timeline accepts as a time. */
export type VisTime = number | string | Date | { valueOf(): number } | null | undefined;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The zone the runtime reads local time in: what moment and vis-timeline use. */
export function runtimeTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Milliseconds of a wall-clock reading, read as if it were UTC. */
function wall(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getTime();
}

/**
 * The instant a wall clock means in a zone: inside a gap with the offset
 * before it, in a repeated hour the first one — what `new Date(y, m, d, h)`
 * gives. (The same rule as the calendar's; kept here so this entry point
 * does not load the calendar.)
 */
export function zonedInstant(wallMs: number, timeZone: string): TimeMs {
  if (timeZone === "UTC") return wallMs;
  const before = zoneOffsetMs(wallMs - DAY, timeZone);
  const after = zoneOffsetMs(wallMs + DAY, timeZone);
  const early = wallMs - before;
  if (before === after && zoneOffsetMs(early, timeZone) === before) return early;
  const late = wallMs - after;
  const earlyHolds = zoneOffsetMs(early, timeZone) === before;
  const lateHolds = zoneOffsetMs(late, timeZone) === after;
  if (earlyHolds && lateHolds) return Math.min(early, late);
  if (lateHolds) return late;
  return early;
}

const ASP_DATE = /^\/?Date\((-?\d+)/i;
const DIGITS = /^\d+$/;
const EXTENDED = /^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;
const BASIC = /^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d|))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;

/** moment's ISO date shapes, in its order; the flag is whether a time may follow. */
type DateShape = readonly [pattern: RegExp, kind: "ymd" | "week" | "ordinal" | "ym" | "y", timeAllowed: boolean];
const DATE_SHAPES: readonly DateShape[] = [
  [/^([+-]\d{6})-(\d\d)-(\d\d)$/, "ymd", true],
  [/^(\d{4})-(\d\d)-(\d\d)$/, "ymd", true],
  [/^(\d{4})-W(\d\d)-(\d)$/, "week", true],
  [/^(\d{4})-W(\d\d)$/, "week", false],
  [/^(\d{4})-(\d{3})$/, "ordinal", true],
  [/^(\d{4})-(\d\d)$/, "ym", false],
  [/^([+-]\d{6})(\d\d)(\d\d)$/, "ymd", true],
  [/^(\d{4})(\d\d)(\d\d)$/, "ymd", true],
  [/^(\d{4})W(\d\d)(\d)$/, "week", true],
  [/^(\d{4})W(\d\d)$/, "week", false],
  [/^(\d{4})(\d{3})$/, "ordinal", true],
  [/^(\d{4})(\d\d)$/, "ym", false],
  [/^(\d{4})$/, "y", false],
];

/** Days in a month, for any year (day 0 of the next month is the last of this one). */
const daysIn = (year: number, month: number): number => new Date(wall(year, month + 1, 0, 0, 0, 0, 0)).getUTCDate();
function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The wall-clock date of an ISO date part, or `null` when moment would call it invalid. */
function isoDate(text: string, withTime: boolean): { year: number; month: number; day: number } | null {
  for (const [pattern, kind, timeAllowed] of DATE_SHAPES) {
    const match = pattern.exec(text);
    if (match === null) continue;
    if (withTime && !timeAllowed) return null;
    const year = Number(match[1]);
    if (kind === "y") return { year, month: 1, day: 1 };
    if (kind === "ym") {
      const month = Number(match[2]);
      return month >= 1 && month <= 12 ? { year, month, day: 1 } : null;
    }
    if (kind === "ymd") {
      const month = Number(match[2]);
      const day = Number(match[3]);
      return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month) ? { year, month, day } : null;
    }
    if (kind === "ordinal") {
      const ordinal = Number(match[2]);
      if (ordinal < 1 || ordinal > (isLeap(year) ? 366 : 365)) return null;
      const date = new Date(wall(year, 1, ordinal, 0, 0, 0, 0));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }
    // An ISO week: week 1 holds the year's first Thursday; days run Monday 1 to Sunday 7.
    const week = Number(match[2]);
    const weekday = match[3] === undefined ? 1 : Number(match[3]);
    if (week < 1 || week > 53 || weekday < 1 || weekday > 7) return null;
    const jan4 = wall(year, 1, 4, 0, 0, 0, 0);
    const jan4Weekday = ((new Date(jan4).getUTCDay() + 6) % 7) + 1;
    const date = new Date(jan4 + ((week - 1) * 7 + (weekday - jan4Weekday)) * DAY);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  return null;
}

/** An ISO time part, or `null` when invalid. 24:00 is the next midnight, as in moment. */
function isoTime(text: string | undefined): { hour: number; minute: number; second: number; ms: number } | null {
  if (text === undefined) return { hour: 0, minute: 0, second: 0, ms: 0 };
  const match = /^(\d\d):?(\d\d)?(?::?(\d\d)(?:[.,](\d+))?)?$/.exec(text);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  // moment's S tokens: the fraction of a second, truncated to milliseconds.
  const ms = match[4] === undefined ? 0 : Math.trunc(Number(`0.${match[4]}`) * 1000);
  if (hour === 24 && minute === 0 && second === 0 && ms === 0) return { hour, minute, second, ms };
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second, ms };
}

function offsetOf(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "Z") return 0;
  const match = /^([+-])(\d\d):?(\d\d)?$/.exec(trimmed);
  if (match === null) return Number.NaN;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
}

/** An ISO 8601 string as moment reads it, or `undefined` when it is not one. */
function fromIso(text: string, timeZone: string): TimeMs | undefined {
  const match = EXTENDED.exec(text) ?? BASIC.exec(text);
  if (match === null) return undefined;
  const datePart = match[1] ?? "";
  const timePart = match[3];
  const date = isoDate(datePart, timePart !== undefined);
  const time = isoTime(timePart);
  if (date === null || time === null) return Number.NaN;
  const local = wall(date.year, date.month, date.day, time.hour, time.minute, time.second, time.ms);
  if (match[4] !== undefined) return local - offsetOf(match[4]);
  return zonedInstant(local, timeZone);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC_ZONES: Readonly<Record<string, number>> = { UT: 0, GMT: 0, EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8 };
const RFC_2822 = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;

/**
 * The text with each `(comment)` a space, as moment's `/\([^)]*\)/g` does —
 * in one pass: that pattern tries every `(` of an unclosed run to the end,
 * and a few kilobytes of them took seconds (V7).
 */
function uncommented(text: string): string {
  let out = "";
  let at = 0;
  for (let open = text.indexOf("("); open >= 0; open = text.indexOf("(", at)) {
    const close = text.indexOf(")", open);
    if (close < 0) break;
    out += `${text.slice(at, open)} `;
    at = close + 1;
  }
  return out + text.slice(at);
}

/** An RFC 2822 date, as moment reads it, or `undefined` when it is not one. */
function fromRfc2822(text: string): TimeMs | undefined {
  const cleaned = uncommented(text)
    .replace(/[\n\t]/g, " ")
    .replace(/(\s\s+)/g, " ")
    .replace(/^\s\s*/, "")
    .replace(/\s\s*$/, "");
  const match = RFC_2822.exec(cleaned);
  if (match === null) return undefined;
  const yearText = match[4] ?? "";
  let year = Number(yearText);
  if (yearText.length === 2) year += year < 50 ? 2000 : 1900;
  else if (yearText.length === 3) year += 1900;
  const month = MONTHS.indexOf(match[3] ?? "") + 1;
  const day = Number(match[2]);
  if (day < 1 || day > daysIn(year, month)) return Number.NaN;
  const local = wall(year, month, day, Number(match[5]), Number(match[6]), Number(match[7] ?? 0), 0);
  if (match[1] !== undefined && WEEKDAYS[new Date(local).getUTCDay()] !== match[1]) return Number.NaN;
  let offset = 0;
  if (match[8] !== undefined) offset = (RFC_ZONES[match[8]] ?? 0) * HOUR;
  else if (match[10] !== undefined) {
    const sign = match[10].startsWith("-") ? -1 : 1;
    offset = sign * (Number(match[10].slice(1, 3)) * 60 + Number(match[10].slice(3, 5))) * 60_000;
  }
  return local - offset;
}

/** Whether a free-form date text names its own zone or offset. */
const NAMES_ZONE = /(?:\bZ\b|\b(?:GMT|UTC|UT)\b|[+-]\d\d:?\d\d\b)/;

/** Options of {@link parseVisTime}. */
export interface VisTimeOptions {
  /** The zone a time without an offset is read in. The runtime's own, as in vis-timeline. */
  readonly timeZone?: string;
}

/**
 * A vis-timeline time as epoch milliseconds: `undefined` and `null` stay
 * themselves, a value vis-timeline cannot read is `NaN`.
 */
export function parseVisTime(value: VisTime, options: VisTimeOptions = {}): TimeMs | undefined | null {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const asp = ASP_DATE.exec(value);
    if (asp !== null) return Number(asp[1]);
    if (DIGITS.test(value)) return Number(value);
    const timeZone = options.timeZone ?? runtimeTimeZone();
    const iso = fromIso(value, timeZone);
    if (iso !== undefined) return iso;
    const rfc = fromRfc2822(value);
    if (rfc !== undefined) return rfc;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed) || NAMES_ZONE.test(value) || timeZone === runtimeTimeZone()) return parsed;
    const local = new Date(parsed);
    return zonedInstant(
      wall(local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds()),
      timeZone,
    );
  }
  if (typeof value === "object") {
    const time = Number(value.valueOf());
    return Number.isFinite(time) ? time : Number.NaN;
  }
  return Number.NaN;
}
