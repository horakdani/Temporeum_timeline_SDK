/**
 * G-ICAL: an iCal file read and written back gives the same events — the
 * same set, and the same occurrences.
 *
 * Five claims:
 *
 *  - three files in the shapes the big calendars write (Google: a weekly
 *    series with an EXDATE, a moved and a cancelled occurrence, an all-day
 *    event in the file's zone; Outlook: a Windows zone name and a vendor
 *    TZID; Apple: floating times, a folded description, an RDATE) read,
 *    write and read again to the same events and occurrences
 *    (`roundtrip-files`);
 *  - generated calendars — every zone of the vectors, all-day and timed,
 *    rules, extra and excluded dates, moved occurrences, and titles with
 *    every character iCal escapes — go out and come back the same
 *    (`roundtrip-generated`);
 *  - every written line is at most 75 octets, ends in CRLF, and is never
 *    cut inside a character (`folding`);
 *  - a zone the platform does not know by name is found by its last
 *    `Area/City`, its `X-LIC-LOCATION`, or its `VTIMEZONE`'s rules, and a
 *    zone found by none is UTC with a warning (`zones`);
 *  - what the files mean: the occurrences of the Google file are the ones a
 *    person reading it would list (`meaning`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { escapeText, foldLine, unescapeText } from "../../src/calendar/ical.js";
import { expandEvents, formatICal, formatRRule, instantOf, parseICal, parseRRule, wallOf } from "../../src/calendar/index.js";
import { wallMs } from "../../src/calendar/rrule.js";
import type { CalendarEvent, RecurrenceRule } from "../../src/calendar/index.js";
import { makeRandom } from "../property/harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const FILES = ["google.ics", "outlook.ics", "apple.ics"] as const;
const read = (name: string): string => readFileSync(join(here, "fixtures", name), "utf8");
const DAY = 86_400_000;
const FROM = Date.UTC(2025, 0, 1);
const TO = Date.UTC(2028, 0, 1);

/**
 * An event as a plain, comparable value: a rule by its text, dates as
 * numbers, no undefined fields. The zone is compared where it means
 * something — a recurring or an all-day event's. A one-off event that starts
 * in the second pass of a repeated hour is written in UTC (a local time there
 * would read back as the first pass), and its instant, the thing that
 * matters, is kept.
 */
function normal(event: CalendarEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const zoneMatters = event.allDay === true || event.rrule !== undefined || (event.rdates?.length ?? 0) > 0;
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined || (key === "timeZone" && !zoneMatters)) continue;
    if (key === "rrule") out[key] = formatRRule(typeof value === "string" ? parseRRule(value) : (value as RecurrenceRule));
    else if (value instanceof Date) out[key] = value.getTime();
    else out[key] = value;
  }
  return out;
}

const occurrencesOf = (events: readonly CalendarEvent[]): string =>
  JSON.stringify(expandEvents(events, FROM, TO).map((item) => [item.id, item.start, item.end, item.label]));

describe("G-ICAL: the shapes the big calendars write", () => {
  it.each(FILES.map((name) => [name] as const))("[claim:roundtrip-files] %s reads, writes and reads back the same", (name) => {
    const first = parseICal(read(name));
    expect(first.warnings).toEqual([]);
    expect(first.events.length).toBeGreaterThan(0);
    const text = formatICal(first.events, { stamp: 0, ...(first.name === undefined ? {} : { name: first.name }) });
    const second = parseICal(text);
    expect(second.warnings).toEqual([]);
    expect(second.name).toBe(first.name);
    expect(second.events.map(normal)).toEqual(first.events.map(normal));
    expect(occurrencesOf(second.events)).toBe(occurrencesOf(first.events));
    // And a second trip changes nothing more: the written form is a fixed point.
    expect(formatICal(second.events, { stamp: 0, ...(second.name === undefined ? {} : { name: second.name }) })).toBe(text);
  });

  it("[claim:meaning] the Google file: weekdays at 9:30 Budapest time, one excluded, one moved, one cancelled", () => {
    const calendar = parseICal(read("google.ics"));
    expect(calendar.name).toBe("Team");
    const standup = calendar.events.find((event) => event.id === "standup-7f3a@google.com" && event.recurrenceId === undefined);
    expect(standup?.description).toBe("Daily sync, 15 minutes.\nBring your notes; thanks!");
    expect(standup?.location).toBe("Meeting room 2, 3rd floor");
    const items = expandEvents(calendar.events, Date.UTC(2026, 9, 19), Date.UTC(2026, 10, 2));
    const standups = items.filter((item) => item.id.startsWith("standup"));
    expect(standups.map((item) => [new Date(item.start as number).toISOString().slice(5, 16), item.label])).toEqual([
      ["10-19T07:30", "Daily standup"],
      ["10-20T07:30", "Daily standup"],
      ["10-21T07:30", "Daily standup"],
      ["10-22T07:30", "Daily standup"],
      // 23 October is an EXDATE; the clocks go back on the 25th.
      ["10-26T08:30", "Daily standup"],
      ["10-27T08:30", "Daily standup"],
      ["10-28T10:00", "Daily standup (moved)"],
      ["10-29T08:30", "Daily standup"],
      // 30 October is cancelled.
    ]);
    const offsite = items.find((item) => item.id === "offsite-2026@google.com");
    expect(offsite?.start).toBe(instantOf(wallMs(2026, 11, 2), "Europe/Budapest"));
    expect(offsite?.end).toBe(instantOf(wallMs(2026, 11, 5), "Europe/Budapest"));
    expect(offsite?.data?.allDay).toBe(true);
  });
});

describe("G-ICAL: zones by other names", () => {
  it("[claim:zones] a Windows zone name is matched by its VTIMEZONE's rules, a vendor TZID by its Area/City", () => {
    const calendar = parseICal(read("outlook.ics"));
    const board = calendar.events.find((event) => event.title === "Board meeting");
    const call = calendar.events.find((event) => event.id === "chicago-call");
    // Any zone that keeps Eastern time's offsets gives the same instants.
    expect(board?.start).toBe(Date.UTC(2026, 2, 5, 19));
    expect(call?.timeZone).toBe("America/Chicago");
    // 1:30 on 1 November 2026 in Chicago is the first 1:30, daylight time; 45 minutes long.
    expect(call?.start).toBe(Date.UTC(2026, 10, 1, 6, 30));
    expect(call?.end).toBe(Date.UTC(2026, 10, 1, 7, 15));
    const items = expandEvents(calendar.events, Date.UTC(2026, 2, 1), Date.UTC(2026, 5, 1)).filter((item) => item.label === "Board meeting");
    // First Thursdays: 5 March in EST, then 2 April and 7 May in EDT, all at 14:00 local.
    expect(items.map((item) => item.start)).toEqual([Date.UTC(2026, 2, 5, 19), Date.UTC(2026, 3, 2, 18), Date.UTC(2026, 4, 7, 18)]);
  });

  it("[claim:zones] a zone found by none of them is UTC, with a warning", () => {
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "DTSTART;TZID=Nowhere Standard Time:20260101T090000", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const calendar = parseICal(text);
    expect(calendar.events[0]?.start).toBe(Date.UTC(2026, 0, 1, 9));
    expect(calendar.warnings).toEqual(['Unknown time zone "Nowhere Standard Time", read as UTC']);
  });

  it("[claim:zones] floating times are read in the zone the host names, else the file's X-WR-TIMEZONE, else UTC", () => {
    const text = ["BEGIN:VCALENDAR", "X-WR-TIMEZONE:Asia/Tokyo", "BEGIN:VEVENT", "UID:f", "DTSTART:20260101T090000", "END:VEVENT", "END:VCALENDAR"].join("\n");
    expect(parseICal(text).events[0]?.start).toBe(Date.UTC(2026, 0, 1, 0));
    expect(parseICal(text, { timeZone: "Europe/Budapest" }).events[0]?.start).toBe(Date.UTC(2026, 0, 1, 8));
    expect(parseICal(text.replace("X-WR-TIMEZONE:Asia/Tokyo\n", "")).events[0]?.start).toBe(Date.UTC(2026, 0, 1, 9));
  });

  it("[claim:zones] what cannot be read is reported, not guessed: a VEVENT without DTSTART, one without UID, a cancelled occurrence with no series", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:No start",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20260101T090000Z",
      "DURATION:P1DT2H",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:gone",
      "RECURRENCE-ID:20260101T090000Z",
      "STATUS:CANCELLED",
      "DTSTART:20260101T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calendar = parseICal(text);
    expect(calendar.events.map((event) => [event.id, event.end])).toEqual([["event-1", Date.UTC(2026, 0, 2, 11)]]);
    expect(calendar.warnings).toEqual(["A VEVENT without DTSTART was passed over", "A VEVENT without UID was named event-1", "A cancelled occurrence of gone has no series"]);
  });
});

describe("what a hostile calendar cannot do (S1)", () => {
  const zone = (rule: string): string =>
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Odd Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700101T000000",
      `RRULE:${rule}`,
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0100",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:x",
      "DTSTART;TZID=Odd Standard Time:20260601T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

  it("ignores a time zone rule that repeats more often than daily, with a warning, and reads the file at once", () => {
    for (const freq of ["SECONDLY", "MINUTELY", "HOURLY"]) {
      const began = performance.now();
      const calendar = parseICal(zone(`FREQ=${freq}`));
      expect(performance.now() - began, freq).toBeLessThan(2000);
      expect(calendar.events[0]?.start).toBe(Date.UTC(2026, 5, 1, 8));
      expect(calendar.warnings).toEqual([`A time zone rule of "Odd Standard Time" that repeats more often than daily is ignored`]);
    }
  }, 20_000);

  it("reads a daily time zone rule — thousands of changes — in well under a second's worth of work per zone", () => {
    const began = performance.now();
    const calendar = parseICal(zone("FREQ=DAILY"));
    expect(performance.now() - began).toBeLessThan(5000);
    expect(calendar.events[0]?.start).toBe(Date.UTC(2026, 5, 1, 8));
    expect(calendar.warnings).toEqual([]);
  }, 20_000);

  it("expands at most a limit of one event's occurrences, 10 000 by default, and says so", () => {
    const every: CalendarEvent = { id: "tick", start: Date.UTC(2026, 0, 1), rrule: "FREQ=SECONDLY" };
    const limited: string[] = [];
    const items = expandEvents([every, { id: "one", start: Date.UTC(2026, 0, 1, 12) }], Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2), { onLimit: (id, limit) => limited.push(`${id} ${String(limit)}`) });
    expect(items).toHaveLength(10_001);
    expect(items.filter((item) => item.id !== "one").at(-1)?.start).toBe(Date.UTC(2026, 0, 1) + 9_999_000);
    expect(limited).toEqual(["tick 10000"]);
    expect(expandEvents([every], Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2), { limit: 100 })).toHaveLength(100);
    // A rule within the limit says nothing.
    const quiet: string[] = [];
    expandEvents([{ id: "daily", start: Date.UTC(2026, 0, 1), rrule: "FREQ=DAILY" }], Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1), { onLimit: (id) => quiet.push(id) });
    expect(quiet).toEqual([]);
  });
});

describe("G-ICAL: generated calendars", () => {
  const ZONES = ["UTC", "Europe/Budapest", "America/New_York", "Australia/Lord_Howe", "Asia/Kolkata", "America/St_Johns"];
  const RULES = ["FREQ=DAILY;COUNT=5", "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20271231T000000Z", "FREQ=MONTHLY;BYDAY=-1FR", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU,SU", "FREQ=MONTHLY;BYMONTHDAY=1,-1;BYSETPOS=1"];
  const TEXTS = ["Plain", "Comma, semicolon; backslash \\ done", "Line one\nline two\nline three", "Ékezetes árvíztűrő tükörfúrógép — és egy nagyon hosszú cím, amelynek a hajtogatás a közepén vág", "日本語の予定と絵文字 🎉🎉🎉 が長く続くタイトル、折り返しを試す", "עברית ומספרים 123"];

  function generate(seed: number): CalendarEvent[] {
    const random = makeRandom(seed);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
    const dateZone = pick(ZONES);
    const events: CalendarEvent[] = [];
    const count = 1 + Math.floor(random() * 6);
    for (let n = 0; n < count; n += 1) {
      const allDay = random() < 0.25;
      const zone = allDay ? dateZone : pick(ZONES);
      const wall = wallMs(2026, 1 + Math.floor(random() * 12), 1 + Math.floor(random() * 28), allDay ? 0 : Math.floor(random() * 24), allDay ? 0 : pick([0, 15, 30, 45]));
      const start = instantOf(wall, zone);
      const end = allDay ? instantOf(wall + (1 + Math.floor(random() * 3)) * DAY, zone) : start + pick([0, 15, 60, 90, 24 * 60 + 30]) * 60_000;
      const event: { -readonly [K in keyof CalendarEvent]: CalendarEvent[K] } = { id: `${Array.from(pick(TEXTS)).slice(0, 12).join("")}-${String(seed)}-${String(n)}@test`, start, end };
      if (allDay) event.allDay = true;
      if (zone !== "UTC") event.timeZone = zone;
      if (random() < 0.8) event.title = pick(TEXTS);
      if (random() < 0.4) event.description = pick(TEXTS);
      if (random() < 0.3) event.location = pick(TEXTS);
      const recurring = random() < 0.6;
      if (recurring) {
        event.rrule = parseRRule(pick(RULES));
        const later = expandEvents([event], start, start + 400 * DAY);
        const exdate = later[1];
        if (exdate !== undefined && random() < 0.5) event.exdates = [exdate.start as number];
        if (random() < 0.3) event.rdates = [allDay ? instantOf(wall + 3 * DAY, zone) : start + 3 * DAY + 3_600_000];
        const moved = later[2];
        if (moved !== undefined && random() < 0.4) {
          events.push(event);
          const at = moved.start as number;
          // An all-day occurrence moves a day; a timed one two hours.
          const movedStart = allDay ? instantOf(wallOf(at, zone) + DAY, zone) : at + 2 * 3_600_000;
          const movedEnd = allDay ? instantOf(wallOf(at, zone) + 2 * DAY, zone) : at + 3 * 3_600_000;
          events.push({ id: event.id, start: movedStart, end: movedEnd, recurrenceId: at, title: "Moved", ...(event.timeZone === undefined ? {} : { timeZone: event.timeZone }), ...(allDay ? { allDay: true } : {}) });
          continue;
        }
      }
      events.push(event);
    }
    return events;
  }

  it("[claim:roundtrip-generated] 300 calendars go out and come back as the same events and occurrences", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const events = generate(seed);
      const back = parseICal(formatICal(events, { stamp: 0 }));
      expect(back.warnings, String(seed)).toEqual([]);
      expect(back.events.map(normal), String(seed)).toEqual(events.map(normal));
      expect(occurrencesOf(back.events), String(seed)).toBe(occurrencesOf(events));
    }
  });

  it("[claim:roundtrip-generated] text escaping is its own inverse", () => {
    for (const text of [...TEXTS, "CR LF\r\nand CR\r"]) expect(unescapeText(escapeText(text))).toBe(text.replace(/\r\n|\r/g, "\n"));
  });
});

describe("G-ICAL: lines", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  it("[claim:folding] every written line is at most 75 octets and ends in CRLF; unfolding gives the line back", () => {
    for (const name of FILES) {
      const text = formatICal(parseICal(read(name)).events, { stamp: 0 });
      expect(text.endsWith("\r\n")).toBe(true);
      expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      for (const line of text.split("\r\n")) {
        expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
        expect(() => decoder.decode(encoder.encode(line))).not.toThrow();
      }
    }
  });

  it("[claim:folding] a long line of multi-byte characters is folded between characters, never inside one", () => {
    const line = `SUMMARY:${"🎉ő日".repeat(40)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.map((part, i) => (i === 0 ? part : part.slice(1))).join("")).toBe(line);
    expect(foldLine("SHORT:x")).toBe("SHORT:x");
  });

  it("[claim:folding] a VTIMEZONE is written for every zone used, with its changes", () => {
    const text = formatICal([{ id: "a", start: Date.UTC(2026, 5, 1, 7), timeZone: "Europe/Budapest", rrule: "FREQ=WEEKLY;COUNT=3" }], { stamp: 0, zoneYears: 1 });
    expect(text).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Budapest");
    expect(text).toContain("BEGIN:DAYLIGHT\r\nDTSTART:20260329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200");
    expect(text).toContain("BEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100");
    expect(text).toContain("DTSTART;TZID=Europe/Budapest:20260601T090000");
    expect(text).toContain("DTSTAMP:19700101T000000Z");
  });
});
