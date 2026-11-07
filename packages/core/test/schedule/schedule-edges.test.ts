/**
 * The scheduler's less travelled paths: calendars that are wrong or empty,
 * inputs it leaves out, and the options that change what slack means.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  addWorkingMs,
  CONTINUOUS,
  OFFICE_WEEK,
  scheduleCommand,
  scheduleTasks,
  workingMs,
  workTime,
} from "../../src/schedule/index.js";
import type { WorkCalendar } from "../../src/schedule/index.js";
import { BASE, HOUR } from "./fixture.js";

const DAY = 24 * HOUR;
/** Monday 08:00 UTC. */
const MONDAY = BASE + 8 * HOUR;

describe("calendars at their edges", () => {
  it("refuses a calendar it cannot read", () => {
    expect(() => workTime({ exceptions: [{ date: "25-3-1" }] })).toThrow(RangeError);
    expect(() => workTime({ week: [[[600, 500]]] })).toThrow(RangeError);
    expect(() => workTime({ week: [[[-1, 60]]] })).toThrow(RangeError);
    expect(() => workTime({ week: [[[0, 1441]]] })).toThrow(RangeError);
    expect(() => workTime({ week: [], exceptions: [{ date: "2025-01-01" }] })).toThrow("needs some working time");
    expect(() => workTime({ exceptions: [{ date: "2025-01-02", until: "2025-01-01" }] })).toThrow(RangeError);
    expect(() => workTime({ exceptions: [{ date: "1800-01-01", until: "2100-01-01" }] })).toThrow(RangeError);
  });

  it("gives up, rather than searching for ever, when the work runs out", () => {
    const once: WorkCalendar = { week: [], exceptions: [{ date: "2025-03-24", shifts: [[480, 540]] }] };
    const time = workTime(once);
    const before = time.work(BASE);
    expect(time.work(BASE + 30 * DAY) - before).toBe(HOUR);
    expect(() => time.start(before + 2 * HOUR)).toThrow("two centuries");
    expect(() => workTime({ ...once }).finish(-1e15)).toThrow("two centuries");
  });

  it("is the office week by default, compiled once per calendar, and continuous with none", () => {
    const calendar: WorkCalendar = {};
    expect(workTime(calendar)).toBe(workTime(calendar));
    expect(workTime()).toBe(CONTINUOUS);
    expect(OFFICE_WEEK).toHaveLength(7);
    expect(workingMs(calendar, BASE, BASE + 7 * DAY)).toBe(40 * HOUR);
    expect(workingMs(undefined, BASE, BASE + HOUR)).toBe(HOUR);
    expect(workingMs(calendar, BASE + 7 * DAY, BASE)).toBe(-40 * HOUR);
    expect(addWorkingMs(undefined, BASE, HOUR)).toBe(BASE + HOUR);
    // Friday 16:00 and two hours: Monday 09:00.
    expect(addWorkingMs(calendar, BASE + 4 * DAY + 16 * HOUR, 2 * HOUR)).toBe(BASE + 7 * DAY + 9 * HOUR);
    expect(CONTINUOUS.start(5)).toBe(5);
    expect(CONTINUOUS.finish(5)).toBe(5);
  });

  it("merges shifts that overlap or run on past midnight, and reads a range of days off", () => {
    const calendar: WorkCalendar = {
      week: [[[480, 720], [600, 800]], [[0, 1440]], [[0, 1440]], [], [], [], []],
      exceptions: [{ date: "2025-03-26", until: "2025-03-27", shifts: [[60, 120]] }],
    };
    // Monday 08:00–13:20, then Tuesday all day: one run of work from Tuesday 00:00.
    expect(workingMs(calendar, BASE, BASE + DAY)).toBe(320 * 60_000);
    expect(workingMs(calendar, BASE + DAY, BASE + 2 * DAY)).toBe(DAY);
    expect(workingMs(calendar, BASE + 2 * DAY, BASE + 4 * DAY)).toBe(2 * HOUR);
    const time = workTime(calendar);
    expect(time.start(time.work(BASE + DAY))).toBe(BASE + DAY);
  });
});

describe("the scheduler at its edges", () => {
  it("leaves out background items and arrows to what is not a task, and reads dates", () => {
    const schedule = scheduleTasks(
      [
        { id: "a", start: new Date(MONDAY), end: new Date(MONDAY + 2 * HOUR) },
        { id: "b", start: MONDAY, end: MONDAY + HOUR },
        { id: "band", start: BASE, end: BASE + DAY, kind: "background" },
      ],
      [{ from: "a", to: "b" }, { from: "a", to: "band" }, { id: "gone", from: "x", to: "b" }],
      { projectStart: new Date(MONDAY), projectFinish: new Date(MONDAY + 10 * HOUR) },
    );
    expect([...schedule.tasks.keys()]).toEqual(["a", "b"]);
    expect(schedule.ignored).toEqual(["a->band", "gone"]);
    expect(schedule.tasks.get("b")?.start).toBe(MONDAY + 2 * HOUR);
    // Slack against the given finish, not the last one.
    expect(schedule.tasks.get("b")?.slackMs).toBe(7 * HOUR);
    expect(schedule.critical).toEqual([]);
    expect(schedule.finish).toBe(MONDAY + 10 * HOUR);
  });

  it("goes negative, and critical, when the given finish is too early; keeps a milestone's own end", () => {
    const items = [
      { id: "a", start: MONDAY, end: MONDAY + 4 * HOUR },
      { id: "m", start: MONDAY, end: MONDAY + HOUR, kind: "milestone" as const },
      { id: "z", start: MONDAY + HOUR },
    ];
    const schedule = scheduleTasks(items, [{ from: "a", to: "m" }, { from: "m", to: "z", type: "SS" }], { projectFinish: MONDAY + 2 * HOUR });
    expect(schedule.tasks.get("a")?.slackMs).toBe(-2 * HOUR);
    expect(schedule.critical).toEqual(["a", "m", "z"]);
    expect(schedule.tasks.get("m")?.end).toBeUndefined();
    expect(schedule.tasks.get("m")?.start).toBe(MONDAY + 4 * HOUR);
    const command = scheduleCommand(items, schedule);
    expect(command?.after).toEqual([
      { id: "m", start: MONDAY + 4 * HOUR },
      { id: "z", start: MONDAY + 4 * HOUR },
    ]);
  });

  it("leaves a moment nothing places where it is, even at the start of a working day", () => {
    const saturday = BASE - 2 * DAY;
    const items = [
      // At the start of the office day: the same work as Friday 17:00, and its own time.
      { id: "m", start: MONDAY, kind: "milestone" as const },
      // At lunch: the same work as 12:00.
      { id: "lunch", start: MONDAY + 4.5 * HOUR, kind: "milestone" as const },
      // A range inside the weekend has no work in it, and keeps both its ends.
      { id: "w", start: saturday + 10 * HOUR, end: saturday + 12 * HOUR },
      { id: "p", start: MONDAY - 3 * DAY, end: MONDAY - 3 * DAY + 9 * HOUR },
      { id: "after", start: MONDAY + DAY, kind: "milestone" as const },
    ];
    const office = { calendar: {} };
    const schedule = scheduleTasks(items, [{ from: "p", to: "after" }], office);
    expect(schedule.tasks.get("m")).toMatchObject({ start: MONDAY, moved: false });
    expect(schedule.tasks.get("lunch")).toMatchObject({ start: MONDAY + 4.5 * HOUR, moved: false });
    expect(schedule.tasks.get("w")).toMatchObject({ start: saturday + 10 * HOUR, end: saturday + 12 * HOUR, moved: false });
    // Placed by its arrow, a moment is where the work before it stopped: Friday 17:00.
    expect(schedule.tasks.get("after")).toMatchObject({ start: MONDAY - 3 * DAY + 9 * HOUR, moved: true });
    expect(scheduleCommand(items, schedule)?.after).toEqual([{ id: "after", start: MONDAY - 3 * DAY + 9 * HOUR }]);
    expect(scheduleCommand(items.slice(0, 3), scheduleTasks(items.slice(0, 3), [], office))).toBeUndefined();
  });

  it("puts an as-late task against the given finish, and refuses a dated constraint with no date", () => {
    const items = [{ id: "a", start: MONDAY, end: MONDAY + HOUR }];
    const late = scheduleTasks(items, [], { projectFinish: MONDAY + 5 * HOUR, constraintOf: () => ({ type: "asLateAsPossible" }) });
    expect(late.tasks.get("a")?.start).toBe(MONDAY + 4 * HOUR);
    expect(() => scheduleTasks(items, [], { constraintOf: () => ({ type: "mustFinishOn" }) })).toThrow("needs a date");
    expect(scheduleTasks([], []).finish).toBeUndefined();
    expect(scheduleCommand(items, scheduleTasks(items, []))).toBeUndefined();
  });

  it("starts the moment before a break when an arrow out of its start has to be in by then", () => {
    // The successor works around the clock; the predecessor only in office hours.
    const office: WorkCalendar = {};
    const items = [
      { id: "p", start: MONDAY, end: MONDAY + HOUR },
      { id: "s", start: MONDAY + 12 * HOUR, end: MONDAY + 13 * HOUR },
    ];
    const schedule = scheduleTasks(items, [{ from: "p", to: "s", type: "SS", lagMs: 0 }], {
      calendarOf: (item) => (item.id === "p" ? office : undefined),
      constraintOf: (item) => (item.id === "p" ? { type: "asLateAsPossible" } : { type: "mustStartOn", date: MONDAY + 12 * HOUR }),
      projectFinish: MONDAY + 30 * HOUR,
    });
    // 20:00 is after the office's day: the latest start before it is a moment before 17:00.
    const p = schedule.tasks.get("p");
    expect(p?.start).toBe(MONDAY + 9 * HOUR - 1);
    expect(schedule.tasks.get("s")?.start).toBe(MONDAY + 12 * HOUR);
  });
});

describe("tasks with a granularity (R12)", () => {
  it("follow a predecessor from where it is drawn to end, and keep their own way of writing an end", () => {
    // A runs over 1–3 March inclusive — drawn to the end of the 3rd. Read raw,
    // its end was the 3rd's midnight, and its successor was drawn over it.
    const day = Date.UTC(2026, 2, 1);
    const items = [
      { id: "a", start: day, end: day + 2 * DAY, granularity: "day" as const },
      { id: "b", start: day + DAY, end: day + DAY, granularity: "day" as const },
    ];
    const schedule = scheduleTasks(items, [{ id: "ab", from: "a", to: "b", type: "FS" }]);
    expect(schedule.tasks.get("a")?.moved).toBe(false);
    const b = schedule.tasks.get("b");
    // B starts on the 4th and, one day long, ends on the 4th, the way the host wrote it.
    expect([b?.start, b?.end, b?.moved]).toEqual([day + 3 * DAY, day + 3 * DAY, true]);
    const command = scheduleCommand(items, schedule);
    expect(command?.after).toEqual([{ id: "b", start: day + 3 * DAY, end: day + 3 * DAY }]);
    // In the timeline's zone: the 1st of March starts at 23:00 UTC in Budapest.
    const there = scheduleTasks(items, [{ id: "ab", from: "a", to: "b", type: "FS" }], { timeZone: "Europe/Budapest" });
    expect(there.tasks.get("b")?.start).toBe(day + 3 * DAY - HOUR);
  });

  it("start on the day work starts, not at its hour, with a working calendar (V5)", () => {
    // Thursday 5 – Friday 6 November, and a one-day task on Monday the 2nd after it.
    const nov = (date: number): number => Date.UTC(2026, 10, date);
    const items = [
      { id: "a", start: nov(5), end: nov(6), granularity: "day" as const },
      { id: "b", start: nov(2), end: nov(2), granularity: "day" as const },
      { id: "c", start: nov(3), end: nov(4), granularity: "day" as const },
    ];
    const schedule = scheduleTasks(items, [{ id: "ab", from: "a", to: "b", type: "FS" }], { calendar: { week: OFFICE_WEEK } });
    // Nothing places A or C: they stay as written, unmoved.
    expect(schedule.tasks.get("a")).toMatchObject({ start: nov(5), end: nov(6), moved: false });
    expect(schedule.tasks.get("c")).toMatchObject({ start: nov(3), end: nov(4), moved: false });
    // B goes to the next working day after A, Monday the 9th, and ends on it — not before its start.
    expect(schedule.tasks.get("b")).toMatchObject({ start: nov(9), end: nov(9), moved: true });
    expect(scheduleCommand(items, schedule)?.after).toEqual([{ id: "b", start: nov(9), end: nov(9) }]);
  });

  it("leave a task nothing moves as written, when its instants are not the zone's midnights (X11)", () => {
    // A form writes the day at the hour it was filled in; `new Date("2026-03-06")`
    // is UTC midnight, 01:00 in Budapest. The drawn end of a task under a
    // working calendar is the end of a shift, never the span's midnight, so
    // the end was rewritten to the start of its day — before the start.
    const at9 = Date.UTC(2026, 2, 6, 9);
    const utcMidnight = Date.UTC(2026, 2, 6);
    const cases = [
      { items: [{ id: "a", start: at9, end: at9, granularity: "day" as const }], options: { calendar: {} } },
      { items: [{ id: "a", start: utcMidnight, end: utcMidnight, granularity: "day" as const }], options: { timeZone: "Europe/Budapest", calendar: { timeZone: "Europe/Budapest" } } },
      // Monday 2 – Wednesday 4 March, at 09:00, in an office week.
      { items: [{ id: "a", start: Date.UTC(2026, 2, 2, 9), end: Date.UTC(2026, 2, 4, 9), granularity: "day" as const }], options: { calendar: { week: OFFICE_WEEK } } },
    ];
    for (const { items, options } of cases) {
      const schedule = scheduleTasks(items, [], options);
      const item = items[0] as (typeof items)[number];
      expect(schedule.tasks.get("a")).toMatchObject({ start: item.start, end: item.end, moved: false });
      expect(scheduleCommand(items, schedule)).toBeUndefined();
    }
  });

  it("never write an end before the start of a moved task by the day (X11)", () => {
    // B, written at 09:00 on the 2nd, follows A to Monday the 9th.
    const nov = (date: number, hour = 0): number => Date.UTC(2026, 10, date, hour);
    const items = [
      { id: "a", start: nov(5, 9), end: nov(6, 9), granularity: "day" as const },
      { id: "b", start: nov(2, 9), end: nov(2, 9), granularity: "day" as const },
    ];
    const schedule = scheduleTasks(items, [{ id: "ab", from: "a", to: "b", type: "FS" }], { calendar: { week: OFFICE_WEEK } });
    expect(schedule.tasks.get("a")).toMatchObject({ start: nov(5, 9), end: nov(6, 9), moved: false });
    const b = schedule.tasks.get("b");
    expect(b).toMatchObject({ start: nov(9), end: nov(9), moved: true });
    for (const task of schedule.tasks.values()) expect(task.end ?? task.start).toBeGreaterThanOrEqual(task.start);
  });
});

describe("the options' documentation (X21)", () => {
  it("writes its example times as a TimeInput, not as a string the scheduler throws on", () => {
    const source = readFileSync(new URL("../../src/schedule/index.ts", import.meta.url), "utf8");
    const docs = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((match) => match[0]);
    expect(docs.filter((doc) => /\b(?:start|end): "/.test(doc))).toEqual([]);
    expect(() => scheduleTasks([{ id: "a", start: Date.UTC(2026, 2, 2), end: new Date("2026-03-03"), granularity: "day" }], [])).not.toThrow();
  });
});

describe("tasks by the month, the year and the day without a working calendar (Y3)", () => {
  // Their length was measured in elapsed milliseconds and laid down again:
  // a month moved into February was February and March, a year moved onto a
  // shorter year two years, a day task moved onto a spring-forward week a day
  // longer — and scheduleCommand wrote that end into the items.
  const utc = (y: number, m: number, d = 1): number => Date.UTC(y, m - 1, d);

  it("keeps a month a month and a year a year where they land", () => {
    const items = [
      { id: "A", start: utc(2027, 1), end: utc(2027, 1), granularity: "month" as const },
      { id: "B", start: utc(2026, 7), end: utc(2026, 7), granularity: "month" as const },
      { id: "C", start: utc(2026, 1, 10), end: utc(2026, 1, 12), granularity: "day" as const },
      { id: "Y1", start: utc(2024, 1), end: utc(2024, 1), granularity: "year" as const },
      { id: "Y2", start: utc(2020, 1), end: utc(2020, 1), granularity: "year" as const },
    ];
    const deps = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "Y1", to: "Y2" },
    ];
    const schedule = scheduleTasks(items, deps);
    expect(schedule.tasks.get("B")).toMatchObject({ start: utc(2027, 2), end: utc(2027, 2) });
    // The successor starts when February ends, not 31 days after it began.
    expect(schedule.tasks.get("C")).toMatchObject({ start: utc(2027, 3, 1), end: utc(2027, 3, 3) });
    expect(schedule.tasks.get("Y2")).toMatchObject({ start: utc(2025, 1), end: utc(2025, 1) });
    expect(scheduleCommand(items, schedule)?.after).toContainEqual({ id: "B", start: utc(2027, 2), end: utc(2027, 2) });
  });

  it("keeps a three-day task three days in the zone across the spring change", () => {
    // Budapest: 29 March 2026 has 23 hours. B (3–5 April) is pulled after A (25–26 March).
    const zone = "Europe/Budapest";
    const local = (d: number): number => Date.UTC(2026, 2, d) - HOUR;
    const items = [
      { id: "A", start: local(25), end: local(26), granularity: "day" as const },
      { id: "B", start: local(34), end: local(36), granularity: "day" as const },
    ];
    const schedule = scheduleTasks(items, [{ from: "A", to: "B" }], { timeZone: zone });
    // 27–29 March: its last day is the 29th, not the 30th.
    expect(schedule.tasks.get("B")).toMatchObject({ start: local(27), end: Date.UTC(2026, 2, 29) - HOUR });
  });

  it("measures by the working calendar when there is one, as before", () => {
    const items = [{ id: "M", start: utc(2026, 1), end: utc(2026, 1), granularity: "month" as const }];
    expect(scheduleTasks(items, [], { calendar: { week: OFFICE_WEEK } }).tasks.get("M")?.moved).toBe(false);
  });
});

describe("slack, finish links and finish constraints by whole units too (Z2)", () => {
  // Y3 put a month task's end on whole months, but every step back from an
  // end still took off the milliseconds it was written with: a chain with no
  // slack had negative slack and a last task off the critical path, an FF
  // successor finished a month before its predecessor, and a finish
  // constraint was broken with no conflict.
  const utc = (y: number, m: number, d = 1): number => Date.UTC(y, m - 1, d);

  it("keeps a chain of month tasks on the critical path with no slack", () => {
    const items = [
      { id: "A", start: utc(2026, 1), end: utc(2026, 1), granularity: "month" as const },
      { id: "B", start: utc(2026, 1), end: utc(2026, 1), granularity: "month" as const },
      { id: "C", start: utc(2026, 1), end: utc(2026, 2), granularity: "month" as const },
    ];
    const schedule = scheduleTasks(items, [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(schedule.critical).toEqual(["A", "B", "C"]);
    expect([...schedule.tasks.values()].map((task) => task.slackMs)).toEqual([0, 0, 0]);
    expect(schedule.tasks.get("C")).toMatchObject({ start: utc(2026, 3), end: utc(2026, 4) });
  });

  it("finishes an FF successor with its predecessor, and by a finish-no-earlier date", () => {
    const month = { id: "B", start: utc(2026, 7), end: utc(2026, 7), granularity: "month" as const };
    const ff = scheduleTasks([{ id: "A", start: utc(2026, 2, 10), end: utc(2026, 3) }, month], [{ from: "A", to: "B", type: "FF" }]);
    // February: it ends on 1 March, as A does — not January.
    expect(ff.tasks.get("B")).toMatchObject({ start: utc(2026, 2), end: utc(2026, 2), slackMs: 0 });
    const constrained = scheduleTasks([month], [], { constraintOf: () => ({ type: "finishNoEarlierThan", date: utc(2026, 3) }) });
    expect(constrained.tasks.get("B")).toMatchObject({ start: utc(2026, 2), slackMs: 0 });
    expect(constrained.conflicts).toEqual([]);
  });

  it("counts days in the zone across the spring change, for slack and for an FF link", () => {
    const zone = "Europe/Budapest";
    // Local midnights: UTC+1 before 29 March 2026, UTC+2 from then.
    const local = (d: number): number => Date.UTC(2026, 2, d) - (d < 30 ? HOUR : 2 * HOUR);
    const chain = scheduleTasks(
      [
        { id: "A", start: local(16), end: local(18), granularity: "day" as const },
        { id: "B", start: local(28), end: local(30), granularity: "day" as const },
      ],
      [{ from: "A", to: "B" }],
      { timeZone: zone },
    );
    expect(chain.critical).toEqual(["A", "B"]);
    const ff = scheduleTasks(
      [
        { id: "A", start: local(20), end: local(32) },
        { id: "B", start: local(10), end: local(12), granularity: "day" as const },
      ],
      [{ from: "A", to: "B", type: "FF" }],
      { timeZone: zone },
    );
    // 29–31 March, ending at midnight on 1 April as A does — not a day early.
    expect(ff.tasks.get("B")).toMatchObject({ start: local(29), end: local(31) });
  });
});
