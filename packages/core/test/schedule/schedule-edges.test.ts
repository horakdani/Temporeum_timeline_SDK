/**
 * The scheduler's less travelled paths: calendars that are wrong or empty,
 * inputs it leaves out, and the options that change what slack means.
 */

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

  it("leaves a moment nothing places where it is, even at the start of a working day (M4)", () => {
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
