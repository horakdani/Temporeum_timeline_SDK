/**
 * The edges of `/calendar` that the claims do not walk through: the options
 * of the drawing, a view with odd hours, the events' own corners, the rarer
 * iCal forms, and the rarer frequencies. Not a gate claim on its own — each
 * case here is a branch the claims' generated data seldom or never takes.
 */

import { describe, expect, it } from "vitest";

import {
  calendarCss,
  calendarDays,
  calendarDomId,
  calendarGeometry,
  calendarScene,
  calendarTimeAt,
  dayStartOf,
  expandEvents,
  formatICal,
  occurrenceId,
  occurrences,
  parseICal,
  recurringSource,
  layoutDays,
  weekStartOf,
} from "../../src/calendar/index.js";
import type { CalendarEvent } from "../../src/calendar/index.js";
import type { SceneElement } from "../../src/scene.js";
import { layoutItems } from "../../src/layout.js";
import { DARK_THEME } from "../../src/theme.js";
import type { Item } from "../../src/types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONDAY = Date.UTC(2026, 10, 2);

function find(node: SceneElement, test: (node: SceneElement) => boolean): SceneElement[] {
  const out: SceneElement[] = test(node) ? [node] : [];
  for (const child of node.children ?? []) out.push(...find(child, test));
  return out;
}

describe("calendar edges: the drawing", () => {
  const items: Item[] = [
    { id: "a", label: "Breakfast with a title far too long for its narrow column", start: MONDAY + 8 * HOUR, end: MONDAY + 9 * HOUR, className: "mine" },
    { id: "b", start: MONDAY + 8 * HOUR, end: MONDAY + 8.25 * HOUR },
    { id: "c", label: "Trip", start: MONDAY, end: MONDAY + 2 * DAY },
    { id: "d", label: "Late", start: MONDAY + 23.9 * HOUR },
    { id: "z", label: "Day", start: MONDAY + DAY, end: MONDAY + DAY },
  ];

  it("draws a day view with its name, the all-day band, now and today, a focus ring, and custom words", () => {
    const layout = layoutDays(items, { start: MONDAY, days: 1, dayStartHour: 6, dayEndHour: 23 });
    const scene = calendarScene(layout, {
      width: 400,
      height: 500,
      now: MONDAY + 12 * HOUR,
      today: MONDAY + HOUR,
      focusedKey: "a",
      selectedIds: ["a"],
      theme: "dark",
      density: "dense",
      strings: { untitled: "No title" },
    });
    expect(scene.attrs?.["aria-label"]).toBe("Nov 2, 2026");
    expect(scene.attrs?.["data-tl-theme"]).toBe("dark");
    expect(find(scene, (n) => n.attrs?.class === "tl-cal-now")).toHaveLength(1);
    expect(find(scene, (n) => n.attrs?.class === "tl-cal-today")).toHaveLength(1);
    expect(find(scene, (n) => n.attrs?.class === "tl-cal-focus")).toHaveLength(1);
    expect(find(scene, (n) => n.attrs?.class === "tl-cal-band")).toHaveLength(1);
    expect(find(scene, (n) => n.text === "All day")).toHaveLength(1);
    expect(find(scene, (n) => String(n.attrs?.class).includes("tl-cal-event--selected") && String(n.attrs?.class).includes("mine"))).toHaveLength(1);
    const names = find(scene, (n) => n.attrs?.role === "option").map((n) => String(n.attrs?.["aria-label"]));
    expect(names.some((name) => name.startsWith("No title, "))).toBe(true);
    expect(names.some((name) => name.startsWith("Trip, all day, "))).toBe(true);
    // The long title is cut with an ellipsis; the short event's title is in the small type.
    expect(find(scene, (n) => n.tag === "text" && String(n.text).endsWith("…")).length).toBeGreaterThan(0);
  });

  it("leaves out the now line outside the hours shown and outside the days, and names events its own way", () => {
    const layout = layoutDays(items, { start: MONDAY, days: 2, dayStartHour: 9, dayEndHour: 17 });
    const early = calendarScene(layout, { width: 600, height: 400, now: MONDAY + 7 * HOUR, describe: (piece) => `custom ${piece.key}`, formatDay: () => "D", formatHour: (h) => `h${String(h)}`, ariaLabel: "Mine", rtl: true, theme: DARK_THEME });
    expect(find(early, (n) => n.attrs?.class === "tl-cal-now")).toHaveLength(0);
    expect(early.attrs?.["aria-label"]).toBe("Mine");
    expect(early.attrs?.["data-tl-theme"]).toBeUndefined();
    expect(find(early, (n) => n.attrs?.role === "option").every((n) => String(n.attrs?.["aria-label"]).startsWith("custom "))).toBe(true);
    expect(find(early, (n) => n.text === "h9")).toHaveLength(1);
    const outside = calendarScene(layout, { width: 600, height: 400, now: MONDAY + 9 * DAY });
    expect(find(outside, (n) => n.attrs?.class === "tl-cal-now")).toHaveLength(0);
    // A drawing too short for hour labels draws the lines only.
    const short = calendarScene(layout, { width: 600, height: 60 });
    expect(find(short, (n) => n.attrs?.class === "tl-cal-hour" && /^\d\d:00$/.test(String(n.text)))).toHaveLength(0);
  });

  it("an empty week is still a named listbox, with no active descendant", () => {
    const scene = calendarScene(layoutDays([], { start: MONDAY }), { width: 700, height: 400, focusedKey: "missing" });
    expect(scene.attrs?.["aria-label"]).toBe("Week of Nov 2, 2026");
    expect(scene.attrs?.["aria-activedescendant"]).toBeUndefined();
  });

  it("writes the stylesheet for every theme setting, and a document id for any key", () => {
    expect(calendarCss("auto")).toContain("prefers-color-scheme:dark");
    expect(calendarCss("light")).not.toContain("prefers-color-scheme");
    expect(calendarCss({ name: "mine", tokens: { ...DARK_THEME.tokens, surface: "#123456" } })).toContain("#123456");
    expect(calendarDomId("p", "a b@c#1")).toBe("p-e-a.20.b.40.c.23.1");
  });
});

describe("calendar edges: the days", () => {
  it("checks the hours, takes an all-day rule of the host's, and maps a point to a time", () => {
    expect(() => layoutDays([], { start: MONDAY, dayStartHour: 10, dayEndHour: 9 })).toThrow(RangeError);
    expect(() => layoutDays([], { start: MONDAY, dayEndHour: 25 })).toThrow(RangeError);
    const items: Item[] = [{ id: "x", start: MONDAY + 9 * HOUR, end: MONDAY + 10 * HOUR, data: { kind: "holiday" } }];
    const layout = layoutDays(items, { start: MONDAY, days: 3, allDay: (item) => (item.data as { kind?: string } | undefined)?.kind === "holiday", minDurationMs: 0 });
    expect(layout.allDay).toHaveLength(1);
    expect(layout.allDayRows).toBe(1);
    const g = calendarGeometry(layout, { width: 300, height: 300 });
    expect(calendarTimeAt(layout, g, 0, 0)).toBeUndefined();
    const column = g.columns[1];
    expect(column).toBeDefined();
    if (column !== undefined) expect(calendarTimeAt(layout, g, column.x + 1, column.y, { snapMs: HOUR })).toBe(MONDAY + DAY);
  });

  it("starts weeks and days in the zone, on the day asked for", () => {
    expect(weekStartOf(MONDAY + 3 * DAY)).toBe(MONDAY);
    expect(weekStartOf(MONDAY + 3 * DAY, "UTC", 7)).toBe(MONDAY - DAY);
    expect(dayStartOf(Date.UTC(2026, 10, 2, 23, 30), "Europe/Budapest")).toBe(Date.UTC(2026, 10, 2, 23));
    const days = calendarDays(Date.UTC(2026, 2, 28, 12), 2, "Europe/Budapest");
    expect(days.map((day) => day.end - day.start)).toEqual([DAY, 23 * HOUR]);
    expect(days.map((day) => day.weekday)).toEqual([6, 7]);
  });

  it("puts an event before the hours shown at the top, and one after them at the bottom, still tall enough to see", () => {
    const items: Item[] = [
      { id: "early", start: MONDAY + 2 * HOUR, end: MONDAY + 3 * HOUR },
      { id: "late", start: MONDAY + 22 * HOUR, end: MONDAY + 23 * HOUR },
    ];
    const layout = layoutDays(items, { start: MONDAY, days: 1, dayStartHour: 8, dayEndHour: 18 });
    const [early, late] = layout.segments;
    expect(early?.top).toBe(0);
    expect(late?.bottom).toBe(1);
    expect((late?.bottom ?? 0) - (late?.top ?? 0)).toBeGreaterThan(0);
  });
});

describe("calendar edges: events", () => {
  it("expands extra dates without a rule, keeps a moved occurrence's place, and gives the timeline a source", async () => {
    const events: CalendarEvent[] = [
      { id: "s", title: "Series", start: MONDAY + 9 * HOUR, end: MONDAY + 10 * HOUR, rdates: [MONDAY + DAY + 9 * HOUR], laneId: "team" },
      { id: "s", title: "Moved", start: MONDAY + DAY + 15 * HOUR, end: MONDAY + DAY + 16 * HOUR, recurrenceId: MONDAY + DAY + 9 * HOUR },
      { id: "one", start: MONDAY + 2 * DAY, allDay: true },
      { id: "dot", start: MONDAY + 3 * DAY },
    ];
    const items = expandEvents(events, MONDAY, MONDAY + 7 * DAY);
    expect(items.map((item) => [item.id, item.label, item.end])).toEqual([
      ["s@20261102T090000Z", "Series", MONDAY + 10 * HOUR],
      ["s@20261103T090000Z", "Moved", MONDAY + DAY + 16 * HOUR],
      // A one-day all-day event ends on its own day, the start of its last (Y4).
      ["one", undefined, MONDAY + 2 * DAY],
      ["dot", undefined, undefined],
    ]);
    expect(items[0]?.laneId).toBe("team");
    expect(items[2]?.granularity).toBe("day");
    expect(occurrenceId({ id: "q", start: 0 }, 0)).toBe("q");
    const source = recurringSource(events);
    expect(typeof source).toBe("function");
    if (typeof source === "function") expect(await source([MONDAY, MONDAY + DAY], new AbortController().signal)).toHaveLength(1);
    // An instant before the range is not in it; one at its start is.
    expect(expandEvents([{ id: "i", start: MONDAY }], MONDAY, MONDAY + 1)).toHaveLength(1);
    expect(expandEvents([{ id: "i", start: MONDAY - 1 }], MONDAY, MONDAY + 1)).toHaveLength(0);
  });

  it("reads the rarer frequencies: SECONDLY, BYSECOND, and an UNTIL that is a date", () => {
    expect(occurrences({ start: MONDAY, rule: "FREQ=SECONDLY;INTERVAL=20;COUNT=4" })).toEqual([MONDAY, MONDAY + 20_000, MONDAY + 40_000, MONDAY + 60_000]);
    expect(occurrences({ start: MONDAY, rule: "FREQ=MINUTELY;BYSECOND=0,30;COUNT=3" })).toEqual([MONDAY, MONDAY + 30_000, MONDAY + 60_000]);
    expect(occurrences({ start: MONDAY + 9 * HOUR, rule: "FREQ=DAILY;UNTIL=20261104" })).toHaveLength(3);
    expect(occurrences({ start: MONDAY, rule: "FREQ=MINUTELY;BYDAY=WE;COUNT=2" })).toEqual([MONDAY, MONDAY + 2 * DAY]);
    expect(occurrences({ start: MONDAY, rule: "FREQ=HOURLY;BYHOUR=3;BYMINUTE=15;COUNT=2" })).toEqual([MONDAY, MONDAY + 3.25 * HOUR]);
  });
});

describe("calendar edges: iCal", () => {
  it("reads a PERIOD RDATE, a negative DURATION, a quoted parameter with a colon, and folded lines with tabs", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "X-WR-TIMEZONE:Not/AZone",
      "BEGIN:VEVENT",
      "UID:p",
      'DTSTART;X-NOTE="a:b;c":20260101T090000Z',
      "DURATION:-PT1H",
      "RDATE;VALUE=PERIOD:20260105T090000Z/20260105T100000Z,20260106T090000Z/PT1H",
      "SUMMARY:Fol",
      "\tded",
      "BEGIN:VALARM",
      "TRIGGER:-PT5M",
      "END:VALARM",
      "END:VEVENT",
      "BEGIN:VTODO",
      "UID:todo",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\n");
    const calendar = parseICal(text);
    expect(calendar.events).toHaveLength(1);
    const event = calendar.events[0];
    expect(event?.title).toBe("Folded");
    expect(event?.end).toBe(Date.UTC(2026, 0, 1, 8));
    expect(event?.rdates).toEqual([Date.UTC(2026, 0, 5, 9), Date.UTC(2026, 0, 6, 9)]);
    // A value that cannot be read passes over its own VEVENT, said, not the whole file (Y11).
    const bad = [parseICal("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:2026\nEND:VEVENT\nEND:VCALENDAR"), parseICal("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260101T000000Z\nDURATION:1H\nEND:VEVENT\nEND:VCALENDAR")];
    expect(bad.map((each) => [each.events.length, each.warnings])).toEqual([
      [0, ['A VEVENT that cannot be read was passed over: Invalid iCalendar date "2026"']],
      [0, ['A VEVENT that cannot be read was passed over: Invalid iCalendar duration "1H"']],
    ]);
  });

  it("matches a vendor zone with only a fixed offset, and writes offsets with seconds", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:India Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:16010101T000000",
      "TZOFFSETFROM:+0530",
      "TZOFFSETTO:+0530",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:k",
      "DTSTART;TZID=India Standard Time:20260301T100000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calendar = parseICal(text);
    expect(calendar.warnings).toEqual([]);
    expect(calendar.events[0]?.start).toBe(Date.UTC(2026, 2, 1, 4, 30));
    // Monrovia until 1972 was 44 minutes 30 seconds behind.
    const old = formatICal([{ id: "o", start: Date.UTC(1970, 5, 1, 12), timeZone: "Africa/Monrovia" }], { stamp: 0, name: "Old; time", prodId: "-//x//y//EN" });
    expect(old).toContain("TZOFFSETFROM:-004430");
    expect(old).toContain("X-WR-CALNAME:Old\\; time");
    expect(old).toContain("PRODID:-//x//y//EN");
  });

  it("writes an all-day event in the zone the host names, and a rule with an end", () => {
    const text = formatICal(
      [
        { id: "d", start: Date.UTC(2026, 0, 1), allDay: true, rrule: { freq: "YEARLY", until: { year: 2030, month: 1, day: 1 } }, exdates: [Date.UTC(2027, 0, 1)] },
        { id: "w", start: Date.UTC(2026, 0, 1, 9), timeZone: "Asia/Tokyo", rrule: "FREQ=WEEKLY;UNTIL=20280101T000000Z" },
      ],
      { stamp: 0, timeZone: "Asia/Tokyo" },
    );
    expect(text).toContain("X-WR-TIMEZONE:Asia/Tokyo");
    expect(text).toContain("DTSTART;VALUE=DATE:20260101");
    expect(text).toContain("EXDATE;VALUE=DATE:20270101");
    expect(text).toContain("RRULE:FREQ=YEARLY;UNTIL=20300101");
    expect(text).toContain("TZID:Asia/Tokyo");
  });
});

describe("an all-day event on a timeline and in the calendar view (Y4)", () => {
  // The item had the exclusive midnight after its last day as its end *and*
  // granularity "day", which the timeline reads as the last day itself: a
  // one-day holiday was drawn over two days.
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:two\r\nDTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261107\r\nSUMMARY:Fair\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const items = expandEvents(parseICal(ics).events, MONDAY, MONDAY + 7 * DAY);

  it("covers its own days on a timeline", () => {
    const spans = layoutItems(items, {}).items.map((placed) => [placed.item.id, placed.span.start, placed.span.end]);
    expect(spans).toEqual([
      ["one", MONDAY + DAY, MONDAY + 2 * DAY],
      ["two", MONDAY + 3 * DAY, MONDAY + 5 * DAY],
    ]);
  });

  it("covers the same days in the calendar view, and says them", () => {
    const layout = layoutDays(items, { start: MONDAY, days: 7 });
    expect(layout.allDay.map((segment) => [segment.key, segment.first, segment.last])).toEqual([
      ["one", 1, 1],
      ["two", 3, 4],
    ]);
    const names = JSON.stringify(calendarScene(layout, { width: 700, height: 500 }));
    expect(names).toMatch(/"Fair, all day, Nov 5\s–\s6, 2026"/);
    // A day item the host writes is all-day too, through its last day.
    const own = layoutDays([{ id: "o", start: MONDAY, end: MONDAY + DAY, granularity: "day" }], { start: MONDAY, days: 7 });
    expect(own.allDay.map((segment) => [segment.key, segment.first, segment.last])).toEqual([["o", 0, 1]]);
  });
});
