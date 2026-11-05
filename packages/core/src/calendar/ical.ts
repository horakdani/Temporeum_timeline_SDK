/**
 * iCalendar (RFC 5545) in and out: `VEVENT`s to {@link CalendarEvent}s, and
 * back. Text, not a file: the library never reads or writes one — the host
 * hands over a string and takes one back.
 *
 * In: lines are unfolded, parameters may be quoted, text is unescaped.
 * `DTSTART` is a date (all day), a UTC time, a time in a `TZID`, or a
 * floating time, read in the zone the host names. A `TZID` is used as the
 * IANA zone it names; one that is not (a Windows name, a vendor prefix) is
 * looked up by its last `Area/City` part, the `VTIMEZONE`'s
 * `X-LIC-LOCATION`, and then by the `VTIMEZONE`'s own rules: the first
 * platform zone with the same offsets on both sides of every change. Failing
 * all of them it is read as UTC, with a warning — a calendar file is not
 * refused for a zone name.
 *
 * Out: CRLF, lines folded at 75 octets without splitting a character, text
 * escaped, and a `VTIMEZONE` for every zone used, with the zone's real
 * transitions over the years the events reach — read from the platform
 * (`Intl`), the same zone data as everything else here.
 *
 * An occurrence the file cancels (`STATUS:CANCELLED` with a `RECURRENCE-ID`)
 * becomes an `EXDATE` of its series, so a file that went in comes back out
 * with the same occurrences.
 */

import { DEFAULT_TIME_ZONE, zoneOffsetMs } from "../calendar.js";
import { toTimeMs } from "../time.js";
import type { TimeInput, TimeMs } from "../types.js";
import { utcStamp } from "./events.js";
import type { CalendarEvent } from "./events.js";
import { formatRRule, formatWall, instantOf, occurrences, parseDateValue, parseRRule, wallMs, wallOf, workSpent } from "./rrule.js";
import type { RecurrenceRule } from "./rrule.js";

/** A calendar read from iCal text. */
export interface ICalCalendar {
  /** `X-WR-CALNAME`, if the file names itself. */
  readonly name?: string;
  readonly events: readonly CalendarEvent[];
  /** What was read with a guess: an unknown zone, a missing `UID`. */
  readonly warnings: readonly string[];
}

/** How to read. */
export interface ICalParseOptions {
  /**
   * The zone of floating times and dates. The file's `X-WR-TIMEZONE`, or
   * UTC, by default.
   */
  readonly timeZone?: string;
}

/** How to write. */
export interface ICalFormatOptions {
  /** `X-WR-CALNAME`. */
  readonly name?: string;
  /** `PRODID`. */
  readonly prodId?: string;
  /** `DTSTAMP` of every event. Now by default. */
  readonly stamp?: TimeInput;
  /** How many years a `VTIMEZONE` covers past the start of a rule with no end. 10 by default. */
  readonly zoneYears?: number;
  /**
   * The zone dates are read in (`X-WR-TIMEZONE`): an all-day event is a date,
   * and a date has no zone of its own in iCal. The first all-day event's
   * zone by default.
   */
  readonly timeZone?: string;
}

interface Line {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

const DAY = 86_400_000;

/** One content line: `NAME;PARAM=a;PARAM="b:c":value`. */
function lineOf(text: string): Line | undefined {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return undefined;
  const head = text.slice(0, colon);
  const params: Record<string, string> = {};
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (parts[0] ?? "").toUpperCase(), params, value: text.slice(colon + 1) };
}

/** iCal TEXT to a string. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

/** A string to iCal TEXT. */
export function escapeText(value: string): string {
  return value.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r\n|\r|\n/g, "\\n");
}

/** Whether the platform knows an IANA zone by this name. */
function knownZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** A `DURATION` (`P1W`, `PT1H30M`, `-P2D`) as days and milliseconds. */
function durationOf(value: string): { readonly days: number; readonly ms: number } {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (match === null) throw new SyntaxError(`Invalid iCalendar duration ${JSON.stringify(value)}`);
  const [, sign, w, d, h, m, s] = match;
  const k = sign === "-" ? -1 : 1;
  return { days: k * (Number(w ?? 0) * 7 + Number(d ?? 0)), ms: k * ((Number(h ?? 0) * 60 + Number(m ?? 0)) * 60 + Number(s ?? 0)) * 1000 };
}

/** One onset of a `VTIMEZONE`: a `STANDARD` or `DAYLIGHT` part. Wall clocks as UTC milliseconds. */
interface Onset {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly rule?: RecurrenceRule;
  readonly rdates: readonly number[];
}

/** `+0100`, `-0430`, `+005328` in milliseconds. */
function offsetMs(value: string): number {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (match === null) throw new SyntaxError(`Invalid UTC offset ${JSON.stringify(value)}`);
  const [, sign, h, m, s] = match;
  const ms = ((Number(h) * 60 + Number(m)) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

function wallOfValue(value: string): number {
  const w = parseDateValue(value).wall;
  return wallMs(w.year, w.month, w.day, w.hour, w.minute, w.second);
}

/**
 * The zones a match by rules prefers, one for each set of rules many zones
 * share: the zone the most common Windows name of those rules means (CLDR),
 * not the first in the alphabet (`America/Detroit`, `Africa/Ceuta`).
 */
const PREFERRED =
  "America/New_York America/Chicago America/Denver America/Phoenix America/Los_Angeles America/Anchorage America/Halifax America/Mexico_City America/Sao_Paulo America/Bogota Europe/London Europe/Berlin Europe/Athens Europe/Moscow Africa/Lagos Africa/Johannesburg Asia/Dubai Asia/Karachi Asia/Kolkata Asia/Dhaka Asia/Bangkok Asia/Shanghai Asia/Tokyo Australia/Brisbane Australia/Sydney Pacific/Auckland".split(" ");

/** How many days all the zones of one file may look at between them. */
const ZONE_WORK = 1_000_000;

/**
 * The IANA zone that keeps a `VTIMEZONE`'s offsets over a few years: a
 * Windows name (`Eastern Standard Time`) or a vendor's own is read as the
 * zone of the platform whose offset agrees with the file's rules on both
 * sides of every change — a {@link PREFERRED} one first. Any such zone gives
 * the same instants there. `spend` is told how much each expansion looked at.
 */
function matchZone(onsets: readonly Onset[], year: number, spend: (work: number) => void): string | undefined {
  const lo = wallMs(year - 1, 1, 1);
  const hi = wallMs(year + 2, 1, 1);
  const changes: { readonly at: number; readonly to: number }[] = [];
  for (const each of onsets) {
    const rule = each.rule;
    // A rule's changes are wall clocks before the change; an UNTIL in UTC is an
    // instant, so it moves by the offset it is read in.
    const until = rule?.until;
    const shifted = rule !== undefined && typeof until === "number" ? { ...rule, until: until + each.from } : rule;
    const walls = occurrences({ start: each.start, ...(shifted === undefined ? {} : { rule: shifted }), rdates: each.rdates }, { from: lo - DAY * 400, to: hi });
    spend(workSpent());
    for (const wall of walls) changes.push({ at: wall - each.from, to: each.to });
  }
  changes.sort((a, b) => a.at - b.at);
  const first = onsets[0];
  if (first === undefined) return undefined;
  // The last change at or before `t`, by halves: a daily rule makes thousands.
  const offsetAt = (t: number): number => {
    let lo = 0;
    let hi = changes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((changes[mid] as { readonly at: number }).at <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? first.from : (changes[lo - 1] as { readonly to: number }).to;
  };
  const samples: number[] = [];
  for (let y = year - 1; y <= year + 1; y += 1) samples.push(wallMs(y, 1, 15, 12), wallMs(y, 7, 15, 12));
  for (const change of changes) if (change.at >= lo && change.at < hi) samples.push(change.at - 3_600_000, change.at + 3_600_000);
  const names = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...PREFERRED.filter(knownZone), ...names].find((zone) => samples.every((t) => zoneOffsetMs(t, zone) === offsetAt(t)));
}

/**
 * Events from iCal text. Every `VEVENT` of the file, in order; everything
 * else (`VTODO`, `VALARM`, `VJOURNAL`) is passed over.
 */
export function parseICal(text: string, options: ICalParseOptions = {}): ICalCalendar {
  const raw = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const each of raw) {
    if ((each.startsWith(" ") || each.startsWith("\t")) && lines.length > 0) lines[lines.length - 1] += each.slice(1);
    else if (each !== "") lines.push(each);
  }
  const warnings: string[] = [];
  const locations = new Map<string, string>();
  const zoneRules = new Map<string, Onset[]>();
  let name: string | undefined;
  let fileZone: string | undefined;
  // VTIMEZONEs first: an event can name a zone defined further down.
  let zoneId: string | undefined;
  let onset: { from?: number; to?: number; start?: number; rule?: RecurrenceRule; rdates: number[] } | undefined;
  for (const text of lines) {
    const line = lineOf(text);
    if (line === undefined) continue;
    const value = line.value.toUpperCase();
    if (line.name === "BEGIN" && (value === "STANDARD" || value === "DAYLIGHT")) onset = { rdates: [] };
    else if (line.name === "END" && (value === "STANDARD" || value === "DAYLIGHT") && onset !== undefined) {
      if (zoneId !== undefined && onset.from !== undefined && onset.to !== undefined && onset.start !== undefined) {
        const list = zoneRules.get(zoneId) ?? [];
        list.push({ from: onset.from, to: onset.to, start: onset.start, ...(onset.rule === undefined ? {} : { rule: onset.rule }), rdates: onset.rdates });
        zoneRules.set(zoneId, list);
      }
      onset = undefined;
    } else if (onset !== undefined) {
      if (line.name === "TZOFFSETFROM") onset.from = offsetMs(line.value);
      else if (line.name === "TZOFFSETTO") onset.to = offsetMs(line.value);
      else if (line.name === "DTSTART") onset.start = wallOfValue(line.value);
      else if (line.name === "RRULE") {
        const rule = parseRRule(line.value);
        // No zone changes its clock more often than daily: such a rule would be millions of changes.
        if (rule.freq === "HOURLY" || rule.freq === "MINUTELY" || rule.freq === "SECONDLY") warnings.push(`A time zone rule of ${JSON.stringify(zoneId ?? "")} that repeats more often than daily is ignored`);
        else onset.rule = rule;
      }
      // A loop, not a spread: a hostile RDATE has more values than a call has room for arguments.
      else if (line.name === "RDATE") for (const value of line.value.split(",")) onset.rdates.push(wallOfValue(value));
    } else if (line.name === "TZID") zoneId = line.value;
    else if (line.name === "X-LIC-LOCATION" && zoneId !== undefined) locations.set(zoneId, line.value);
    else if (line.name === "X-WR-CALNAME") name = unescapeText(line.value);
    else if (line.name === "X-WR-TIMEZONE") fileZone = line.value;
  }
  const floating = options.timeZone ?? (fileZone !== undefined && knownZone(fileZone) ? fileZone : DEFAULT_TIME_ZONE);
  const zones = new Map<string, string>();
  let spent = 0;
  const spend = (work: number): void => {
    spent += work;
  };
  const zoneOf = (tzid: string, year: number): string => {
    const known = zones.get(tzid);
    if (known !== undefined) return known;
    // An Area/City is at the end, and no zone's name is longer than 64: the
    // pattern reads that much, not a hostile file's whole TZID.
    const candidates = [tzid, /[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.exec(tzid.slice(-64))?.[0], locations.get(tzid)];
    const rules = zoneRules.get(tzid);
    const named = candidates.find((each): each is string => each !== undefined && knownZone(each));
    // One budget for the file: a zone's rules can take ~150 000 days to walk,
    // and a file can hold many zones.
    const searched = named === undefined && rules !== undefined && spent <= ZONE_WORK;
    // Around the event's year first; then this year's: Outlook writes a zone's
    // current rules from 1601 on, which no zone kept in a year they changed.
    const found = named ?? (searched ? (matchZone(rules, year, spend) ?? matchZone(rules, new Date().getUTCFullYear(), spend)) : undefined);
    if (found === undefined) warnings.push(named === undefined && rules !== undefined && !searched ? `The rules of time zone ${JSON.stringify(tzid)} are too long to search, read as UTC` : `Unknown time zone ${JSON.stringify(tzid)}, read as UTC`);
    const zone = found ?? DEFAULT_TIME_ZONE;
    zones.set(tzid, zone);
    return zone;
  };
  /** A date or date-time value: its instant, whether it is a date, and its zone. */
  const timeOf = (value: string, params: Readonly<Record<string, string>>): { readonly t: TimeMs; readonly date: boolean; readonly zone: string | undefined } => {
    const parsed = parseDateValue(value.split("/")[0] ?? value);
    const w = parsed.wall;
    const wall = wallMs(w.year, w.month, w.day, w.hour, w.minute, w.second);
    if (parsed.utc) return { t: wall, date: false, zone: undefined };
    const zone = params.TZID === undefined ? floating : zoneOf(params.TZID, w.year);
    return { t: instantOf(wall, zone), date: parsed.date || params.VALUE === "DATE", zone };
  };

  const events: CalendarEvent[] = [];
  const cancelled: { readonly id: string; readonly at: TimeMs }[] = [];
  let current: Line[] | undefined;
  let depth = 0;
  for (const text of lines) {
    const line = lineOf(text);
    if (line === undefined) continue;
    if (line.name === "BEGIN") {
      if (line.value.toUpperCase() === "VEVENT" && current === undefined) {
        current = [];
        depth = 0;
      } else if (current !== undefined) depth += 1;
      continue;
    }
    if (line.name === "END" && current !== undefined) {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const props = current;
      current = undefined;
      const one = (key: string): Line | undefined => props.find((each) => each.name === key);
      const startLine = one("DTSTART");
      if (startLine === undefined) {
        warnings.push("A VEVENT without DTSTART was passed over");
        continue;
      }
      const start = timeOf(startLine.value, startLine.params);
      const zone = start.zone;
      const uidLine = one("UID");
      const uid = uidLine === undefined ? undefined : unescapeText(uidLine.value);
      const id = uid ?? `event-${String(events.length + 1)}`;
      if (uid === undefined) warnings.push(`A VEVENT without UID was named ${id}`);
      const event: { -readonly [K in keyof CalendarEvent]: CalendarEvent[K] } = { id, start: start.t };
      if (start.date) event.allDay = true;
      if (zone !== undefined && zone !== DEFAULT_TIME_ZONE) event.timeZone = zone;
      const endLine = one("DTEND");
      const durationLine = one("DURATION");
      if (endLine !== undefined) {
        event.end = timeOf(endLine.value, endLine.params).t;
      } else if (durationLine !== undefined) {
        const duration = durationOf(durationLine.value);
        const z = zone ?? DEFAULT_TIME_ZONE;
        event.end = instantOf(wallOf(start.t, z) + duration.days * DAY, z) + duration.ms;
      } else if (start.date) {
        const z = zone ?? DEFAULT_TIME_ZONE;
        event.end = instantOf(wallOf(start.t, z) + DAY, z);
      }
      const summary = one("SUMMARY");
      if (summary !== undefined) event.title = unescapeText(summary.value);
      const description = one("DESCRIPTION");
      if (description !== undefined) event.description = unescapeText(description.value);
      const location = one("LOCATION");
      if (location !== undefined) event.location = unescapeText(location.value);
      const rrule = one("RRULE");
      if (rrule !== undefined) event.rrule = parseRRule(rrule.value);
      const listOf = (key: string): TimeMs[] =>
        props.filter((each) => each.name === key && each.params.VALUE !== "PERIOD").flatMap((each) => each.value.split(",").map((value) => timeOf(value, each.params).t));
      const exdates = listOf("EXDATE");
      if (exdates.length > 0) event.exdates = exdates;
      const rdates = [...listOf("RDATE"), ...props.filter((each) => each.name === "RDATE" && each.params.VALUE === "PERIOD").flatMap((each) => each.value.split(",").map((value) => timeOf(value, each.params).t))];
      if (rdates.length > 0) event.rdates = rdates;
      const recurrence = one("RECURRENCE-ID");
      if (recurrence !== undefined) {
        const at = timeOf(recurrence.value, recurrence.params).t;
        if (one("STATUS")?.value.toUpperCase() === "CANCELLED") {
          cancelled.push({ id, at });
          continue;
        }
        event.recurrenceId = at;
      }
      events.push(event);
      continue;
    }
    if (current !== undefined && depth === 0) current.push(line);
  }
  // Each series found once, and a cancelled occurrence added to its list in
  // place — the events are this function's own: a lookup and a copy per
  // occurrence was quadratic in them.
  const series = new Map<string, CalendarEvent>();
  for (const each of events) if (each.recurrenceId === undefined && !series.has(each.id)) series.set(each.id, each);
  for (const { id, at } of cancelled) {
    const each = series.get(id);
    if (each === undefined) warnings.push(`A cancelled occurrence of ${id} has no series`);
    else ((each as unknown as { exdates?: TimeInput[] }).exdates ??= []).push(at);
  }
  return { ...(name === undefined ? {} : { name }), events, warnings };
}

// --- writing ----------------------------------------------------------------------

/**
 * A string's length in UTF-8 octets, as `TextEncoder` counts it (a lone
 * surrogate is the three octets of U+FFFD). Counted here, because the
 * writer must load where `TextEncoder` is not a global.
 */
function octets(text: string): number {
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

/** A content line folded at 75 octets, never inside a character (RFC 5545, 3.1). */
export function foldLine(line: string): string {
  if (octets(line) <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = octets(char);
    const room = out.length === 0 ? 75 : 74;
    if (size + bytes > room) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** A UTC offset as iCal writes it: `+0100`, `-0430`, `+005328`. */
function offsetText(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${sign}${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}${s === 0 ? "" : String(s).padStart(2, "0")}`;
}

/** The zone's transitions in `[from, to)`: the instant, and the offsets before and after. */
function transitions(zone: string, from: TimeMs, to: TimeMs): { readonly at: TimeMs; readonly before: number; readonly after: number }[] {
  const found: { at: TimeMs; before: number; after: number }[] = [];
  const step = 7 * DAY;
  let t = from;
  let offset = zoneOffsetMs(t, zone);
  while (t < to) {
    const next = Math.min(t + step, to);
    const nextOffset = zoneOffsetMs(next, zone);
    if (nextOffset !== offset) {
      let lo = t;
      let hi = next;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2000) * 1000;
        if (mid <= lo) break;
        if (zoneOffsetMs(mid, zone) === offset) lo = mid;
        else hi = mid;
      }
      found.push({ at: hi, before: offset, after: nextOffset });
    }
    t = next;
    offset = nextOffset;
  }
  return found;
}

/** The `VTIMEZONE` of a zone over a span of years, from its real transitions. */
function zoneBlock(zone: string, fromYear: number, toYear: number): string[] {
  const from = instantOf(wallMs(fromYear, 1, 1), zone);
  const to = instantOf(wallMs(toYear + 1, 1, 1), zone);
  const changes = transitions(zone, from, to);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`, `X-LIC-LOCATION:${zone}`];
  const standard = Math.min(zoneOffsetMs(from, zone), ...changes.map((each) => each.after));
  const first = zoneOffsetMs(from, zone);
  // The offset before the first change, from the start of the span.
  lines.push("BEGIN:STANDARD", `DTSTART:${formatWall(wallOf(from, zone))}`, `TZOFFSETFROM:${offsetText(first)}`, `TZOFFSETTO:${offsetText(first)}`, "END:STANDARD");
  for (const change of changes) {
    const kind = change.after > standard ? "DAYLIGHT" : "STANDARD";
    lines.push(`BEGIN:${kind}`, `DTSTART:${formatWall(change.at + change.before)}`, `TZOFFSETFROM:${offsetText(change.before)}`, `TZOFFSETTO:${offsetText(change.after)}`, `END:${kind}`);
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

const yearOf = (t: TimeMs): number => new Date(t).getUTCFullYear();

/** The last year an event's rule reaches, or `undefined` when it repeats forever. */
function lastYear(event: CalendarEvent<unknown>, years: number): number {
  const start = toTimeMs(event.start);
  let last = yearOf(event.end === undefined ? start : toTimeMs(event.end));
  for (const each of [...(event.rdates ?? []), ...(event.exdates ?? [])]) last = Math.max(last, yearOf(toTimeMs(each)));
  if (event.rrule !== undefined) {
    const rule: RecurrenceRule = typeof event.rrule === "string" ? parseRRule(event.rrule) : event.rrule;
    const until = rule.until;
    if (until === undefined) last = Math.max(last, yearOf(start) + years);
    else last = Math.max(last, typeof until === "object" && !(until instanceof Date) ? until.year : yearOf(toTimeMs(until)));
  }
  return last;
}

/** iCal text of the events: one `VCALENDAR`, CRLF line ends, folded. */
export function formatICal(events: readonly CalendarEvent<unknown>[], options: ICalFormatOptions = {}): string {
  const stamp = utcStamp(toTimeMs(options.stamp ?? Date.now()));
  const years = options.zoneYears ?? 10;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${options.prodId ?? "-//Temporeum//Timeline//EN"}`, "CALSCALE:GREGORIAN"];
  if (options.name !== undefined) lines.push(`X-WR-CALNAME:${escapeText(options.name)}`);
  const dateZone = options.timeZone ?? events.find((event) => event.allDay === true && event.timeZone !== undefined)?.timeZone;
  if (dateZone !== undefined && dateZone !== DEFAULT_TIME_ZONE) lines.push(`X-WR-TIMEZONE:${dateZone}`);
  const spans = new Map<string, [number, number]>();
  for (const event of events) {
    const zone = event.timeZone ?? DEFAULT_TIME_ZONE;
    if (zone === DEFAULT_TIME_ZONE) continue;
    const first = yearOf(toTimeMs(event.start));
    const span = spans.get(zone);
    const last = lastYear(event, years);
    spans.set(zone, span === undefined ? [first, last] : [Math.min(span[0], first), Math.max(span[1], last)]);
  }
  for (const [zone, [first, last]] of [...spans].sort(([a], [b]) => (a < b ? -1 : 1))) lines.push(...zoneBlock(zone, first, last));
  for (const event of events) {
    const zone = event.timeZone ?? DEFAULT_TIME_ZONE;
    const allDay = event.allDay === true;
    /**
     * A time property in the event's own form: a date, a UTC time, or a time
     * in its zone. A time in the second pass of a repeated hour reads back as
     * the first, so it is written in UTC — except a recurring event's start,
     * whose zone the rule is read in (iCal cannot say that one).
     */
    const recurring = event.rrule !== undefined || (event.rdates?.length ?? 0) > 0;
    const time = (key: string, t: TimeMs): string => {
      if (allDay) return `${key};VALUE=DATE:${formatWall(wallOf(t, zone), true)}`;
      const wall = wallOf(t, zone);
      if (zone === DEFAULT_TIME_ZONE || ((key !== "DTSTART" || !recurring) && instantOf(wall, zone) !== t)) return `${key}:${utcStamp(t)}`;
      return `${key};TZID=${zone}:${formatWall(wall)}`;
    };
    lines.push("BEGIN:VEVENT", `UID:${escapeText(event.id)}`, `DTSTAMP:${stamp}`);
    if (event.recurrenceId !== undefined) lines.push(time("RECURRENCE-ID", toTimeMs(event.recurrenceId)));
    lines.push(time("DTSTART", toTimeMs(event.start)));
    if (event.end !== undefined) lines.push(time("DTEND", toTimeMs(event.end)));
    if (event.title !== undefined) lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description !== undefined) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location !== undefined) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.rrule !== undefined) lines.push(`RRULE:${formatRRule(typeof event.rrule === "string" ? parseRRule(event.rrule) : event.rrule)}`);
    for (const each of event.rdates ?? []) lines.push(time("RDATE", toTimeMs(each)));
    for (const each of event.exdates ?? []) lines.push(time("EXDATE", toTimeMs(each)));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
