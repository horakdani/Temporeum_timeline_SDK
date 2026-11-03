/**
 * G-SCHEDULE: the scheduler keeps every dependency, constraint and calendar,
 * is idempotent, agrees with an exhaustive search on small projects, and its
 * critical path is exactly the tasks with no slack.
 *
 * Seven claims, each on generated projects:
 *
 *  - working time is the count of working quarter-hours, across time zones,
 *    daylight-saving changes and days off (`calendar`) — the other claims
 *    measure in it, so it is checked against a count, not against itself;
 *  - every dependency holds, of every type, with leads and lags, across
 *    calendars (`dependencies`);
 *  - every lower constraint holds, every upper one holds or is reported as a
 *    conflict by exactly how much it is missed, nothing else is reported,
 *    and an "as late as possible" task could not go any later
 *    (`constraints`);
 *  - every task starts where work resumes and finishes where it stops in
 *    its own calendar, and keeps its working duration (`calendars`);
 *  - scheduling a schedule moves nothing (`idempotent`);
 *  - on small projects every start is the one an exhaustive search over the
 *    hour grid finds: the least start of every task that keeps all the
 *    rules (`reference`);
 *  - a task's slack is how far it alone can be pushed back without moving
 *    the finish, the critical tasks are exactly the ones with none, and each
 *    one either finishes the project or drives a critical successor
 *    (`critical-path`).
 */

import { describe, expect, it } from "vitest";

import { isoWeekday, toCalendarParts } from "../../src/calendar.js";
import { scheduleCommand, scheduleTasks, workingMs, workTime } from "../../src/schedule/index.js";
import type { ConstraintType, Schedule, WorkCalendar, WorkShift } from "../../src/schedule/index.js";
import { applyPatches } from "../../src/editing.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import {
  BASE,
  constraintMiss,
  DAY,
  dependencyBreak,
  generateProject,
  HOUR,
  HOUR_CALENDARS,
  movedItems,
  optionsOf,
  ownDuration,
  placedOf,
} from "./fixture.js";
import type { Placed, Project, ProjectShape } from "./fixture.js";

const SEED = Number(process.env.SDK_SCHEDULE_SEED ?? 2021);
const CASES = 300;
const ALL_TYPES: readonly ConstraintType[] = [
  "asSoonAsPossible",
  "asLateAsPossible",
  "startNoEarlierThan",
  "startNoLaterThan",
  "finishNoEarlierThan",
  "finishNoLaterThan",
  "mustStartOn",
  "mustFinishOn",
];
const WIDE: ProjectShape = { tasks: 14, density: 0.2, calendars: HOUR_CALENDARS, constraintTypes: ALL_TYPES, constraintChance: 0.35, spreadHours: 60, projectStart: true };

function each(seed: number, cases: number, shape: ProjectShape, check: (project: Project, schedule: Schedule) => void): number {
  const random = makeRandom(seed);
  let checked = 0;
  for (let index = 0; index < cases; index += 1) {
    const project = generateProject(random, { ...shape, tasks: 1 + Math.floor(random() * shape.tasks) });
    const schedule = scheduleTasks(project.items, project.dependencies, optionsOf(project));
    check(project, schedule);
    checked += project.items.length;
  }
  return checked;
}

describe("G-SCHEDULE: working time", () => {
  const QUARTER = 15 * 60_000;
  const ZONES = ["UTC", "Europe/Budapest", "America/New_York", "Asia/Kolkata", "Australia/Lord_Howe"];
  /** Around the clock changes: Europe and America in spring, Lord Howe's half hour, Europe in autumn. */
  const STARTS = [Date.UTC(2025, 2, 27), Date.UTC(2025, 2, 6), Date.UTC(2025, 3, 3), Date.UTC(2025, 9, 23), Date.UTC(2025, 9, 2)];

  /** Quarter-hour shifts with no edge between 01:00 and 04:00, where a clock change can skip or repeat it. */
  function shiftsOf(random: () => number): WorkShift[] {
    const edges = new Set<number>();
    const count = Math.floor(random() * 5);
    for (let index = 0; index < count; index += 1) {
      const quarter = Math.floor(random() * 96);
      if (quarter > 4 && quarter < 16) continue;
      edges.add(quarter * 15);
    }
    if (random() < 0.3) edges.add(0).add(1440);
    const sorted = [...edges].sort((a, b) => a - b);
    const shifts: WorkShift[] = [];
    for (let index = 0; index + 1 < sorted.length; index += 2) shifts.push([sorted[index] as number, sorted[index + 1] as number]);
    return shifts;
  }

  it("[claim:calendar] counts the working quarter-hours, in every zone, across clock changes and days off", () => {
    const random = makeRandom(SEED);
    let compared = 0;
    for (let index = 0; index < 60; index += 1) {
      const zone = ZONES[index % ZONES.length] as string;
      const from = (STARTS[index % STARTS.length] as number) - DAY;
      const week = Array.from({ length: 7 }, () => shiftsOf(random));
      week[(index + 1) % 7] = [[480, 1020]];
      const dateOf = (at: number): string => {
        const parts = toCalendarParts(at, zone);
        return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      };
      const holiday = dateOf(from + 2 * DAY);
      const short = dateOf(from + 4 * DAY);
      const calendar: WorkCalendar = { timeZone: zone, week, exceptions: [{ date: holiday }, { date: short, shifts: [[600, 660]] }] };
      const special = new Map<string, readonly WorkShift[]>([[holiday, []], [short, [[600, 660]]]]);
      // The count: a quarter-hour works when its wall clock is inside a shift of its day.
      const prefix: number[] = [0];
      const slots = (6 * DAY) / QUARTER;
      for (let slot = 0; slot < slots; slot += 1) {
        const at = from + slot * QUARTER;
        const parts = toCalendarParts(at, zone);
        const shifts = special.get(dateOf(at)) ?? week[isoWeekday(at, zone) - 1] ?? [];
        const minute = parts.hour * 60 + parts.minute;
        const works = shifts.some(([a, b]) => minute >= a && minute < b);
        prefix.push((prefix[slot] as number) + (works ? QUARTER : 0));
      }
      const time = workTime(calendar);
      for (let probe = 0; probe < 40; probe += 1) {
        const a = Math.floor(random() * slots);
        const b = Math.floor(random() * slots);
        expect(workingMs(calendar, from + a * QUARTER, from + b * QUARTER), `${zone} ${String(a)}..${String(b)}`).toBe((prefix[b] as number) - (prefix[a] as number));
        // Back to instants: work resumes after, and stops before, exactly there.
        const work = time.work(from + a * QUARTER);
        const resume = time.start(work);
        const stop = time.finish(work);
        expect(time.work(resume)).toBe(work);
        expect(time.work(resume + 1)).toBe(work + 1);
        expect(time.work(stop)).toBe(work);
        expect(time.work(stop - 1)).toBe(work - 1);
        compared += 1;
      }
    }
    expect(compared).toBe(2400);
  });
});

describe("G-SCHEDULE: the rules hold", () => {
  it("[claim:dependencies] keeps every dependency, of every type, with leads and lags, across calendars", () => {
    let arrows = 0;
    const tasks = each(SEED + 1, CASES, WIDE, (project, schedule) => {
      expect(schedule.cycles).toEqual([]);
      const placed = placedOf(project, schedule);
      for (const dependency of project.dependencies) {
        expect(dependencyBreak(dependency, placed), `${dependency.from} ${String(dependency.type)} ${dependency.to}`).toBeLessThanOrEqual(0);
        arrows += 1;
      }
    });
    expect(tasks).toBeGreaterThan(1500);
    expect(arrows).toBeGreaterThan(1500);
  });

  it("[claim:constraints] keeps every lower constraint, reports every missed upper one by how much, nothing else, and puts as-late tasks as late as they go", () => {
    let conflicts = 0;
    let late = 0;
    let kept = 0;
    each(SEED + 2, CASES, WIDE, (project, schedule) => {
      const placed = placedOf(project, schedule);
      const reported = new Map(schedule.conflicts.map((conflict) => [`${conflict.id}`, conflict]));
      expect(reported.size).toBe(schedule.conflicts.length);
      for (const [id, constraint] of project.constraints) {
        const task = placed.get(id) as Placed;
        const miss = constraintMiss(constraint, task);
        if (miss === undefined) {
          if (constraint.type !== "asLateAsPossible") continue;
          // One working millisecond later breaks the finish or an arrow out of it.
          const finish = schedule.finish as number;
          const scheduled = schedule.tasks.get(id);
          const duration = scheduled?.durationMs ?? 0;
          const at = task.time.work(task.start) + 1;
          const shifted: Placed = { ...task, start: duration === 0 ? task.time.finish(at) : task.time.start(at), finish: task.time.finish(at + duration) };
          const moved = new Map(placed).set(id, shifted);
          const pinned = shifted.finish > finish || project.dependencies.some((dependency) => dependency.from === id && dependencyBreak(dependency, moved) > 0);
          expect(pinned, `${id} could go later`).toBe(true);
          late += 1;
          continue;
        }
        expect(miss.lower, `${id} ${constraint.type}`).toBeLessThanOrEqual(0);
        const conflict = reported.get(id);
        if (miss.upper > 0) {
          expect(conflict?.byMs, `${id} ${constraint.type} missed by ${String(miss.upper)}`).toBe(miss.upper);
          expect(conflict?.constraint).toBe(constraint);
          conflicts += 1;
        } else {
          expect(conflict, `${id} ${constraint.type} holds but is reported`).toBeUndefined();
          kept += 1;
        }
      }
      for (const conflict of schedule.conflicts) expect(project.constraints.has(conflict.id)).toBe(true);
    });
    expect(conflicts).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(50);
  });

  it("[claim:calendars] starts each task where work resumes and finishes it where work stops, in its own calendar, keeping its working duration", () => {
    let checked = 0;
    each(SEED + 3, CASES, WIDE, (project, schedule) => {
      for (const item of project.items) {
        const task = schedule.tasks.get(item.id);
        expect(task).toBeDefined();
        if (task === undefined) continue;
        const time = workTime(project.calendars.get(item.id));
        const duration = ownDuration(item, time);
        expect(task.durationMs, item.id).toBe(duration);
        if (task.end === undefined || duration === 0) {
          expect(time.finish(time.work(task.start)), `${item.id} is one moment, where work stops`).toBe(task.start);
        } else {
          expect(time.start(time.work(task.start)), `${item.id} starts where work resumes`).toBe(task.start);
          expect(time.finish(time.work(task.end)), `${item.id} finishes where work stops`).toBe(task.end);
          expect(time.work(task.end) - time.work(task.start)).toBe(duration);
        }
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(1500);
  });

  it("[claim:idempotent] moves nothing when scheduling a schedule", () => {
    let moved = 0;
    each(SEED + 4, CASES, WIDE, (project, schedule) => {
      const command = scheduleCommand(project.items, schedule);
      if (command === undefined) return;
      moved += command.after.length;
      const items = applyPatches(project.items, command.after);
      expect(items).toEqual(movedItems(project.items, schedule));
      const again = scheduleTasks(items, project.dependencies, optionsOf(project));
      expect(scheduleCommand(items, again)).toBeUndefined();
      for (const [id, task] of again.tasks) {
        expect(task.start, id).toBe(schedule.tasks.get(id)?.start);
        expect(task.end, id).toBe(schedule.tasks.get(id)?.end);
        expect(task.slackMs, id).toBe(schedule.tasks.get(id)?.slackMs);
      }
      expect(again.conflicts).toEqual(schedule.conflicts);
    });
    expect(moved).toBeGreaterThan(500);
  });
});

describe("G-SCHEDULE: against a reference", () => {
  /** Calendars whose working time starts on the hour grid at the base: every least start is on it. */
  const GRID_CALENDARS = HOUR_CALENDARS.filter((calendar) => calendar?.timeZone !== "Asia/Kolkata");
  /** Office calendars only, for projects that mix them: a day's work is close in each, so a push in one stays inside the other's grid. */
  const OFFICES = GRID_CALENDARS.filter((calendar) => calendar !== undefined);
  const LOWER: readonly ConstraintType[] = ["startNoEarlierThan", "finishNoEarlierThan", "mustStartOn", "mustFinishOn", "asSoonAsPossible"];
  const BELOW = 16;
  const ABOVE = 40;

  it("[claim:reference] finds the least start of every task an exhaustive search over the hour grid finds", () => {
    const random = makeRandom(SEED + 5);
    let searched = 0;
    let pushed = 0;
    for (let index = 0; index < 60; index += 1) {
      const project = generateProject(random, {
        tasks: 2 + Math.floor(random() * 2),
        density: 0.7,
        // Half the projects in one calendar (the continuous one too), half mixing office calendars.
        calendars: index % 2 === 0 ? GRID_CALENDARS : OFFICES,
        oneCalendar: index % 2 === 0,
        constraintTypes: LOWER,
        constraintChance: 0.4,
        hourGrid: true,
        spreadHours: 6,
        projectStart: true,
      });
      const schedule = scheduleTasks(project.items, project.dependencies, optionsOf(project));
      const tasks = project.items.map((item) => {
        const time = workTime(project.calendars.get(item.id));
        return { item, time, origin: time.work(BASE), duration: ownDuration(item, time), constraint: project.constraints.get(item.id) };
      });
      const index_ = new Map(tasks.map((task, at) => [task.item.id, at]));
      const edgeAt = (at: number, work: number, end: boolean): number => {
        const task = tasks[at] as (typeof tasks)[number];
        if (task.duration === 0) {
          // A moment where it was keeps its own instants (M4).
          const own = task.item.start as number;
          const ownEnd = task.item.kind === "milestone" ? undefined : (task.item.end as number | undefined);
          return work === task.time.work(own) ? (end ? (ownEnd ?? own) : own) : task.time.finish(work);
        }
        return end ? task.time.finish(work + task.duration) : task.time.start(work);
      };
      const positions = tasks.map((task) => Array.from({ length: BELOW + ABOVE + 1 }, (_, step) => task.origin + (step - BELOW) * HOUR));
      // Each arrow's successor-side reading of every predecessor position: the search is then arithmetic.
      const arrows = project.dependencies.map((dependency) => {
        const from = index_.get(dependency.from) as number;
        const to = index_.get(dependency.to) as number;
        const type = dependency.type ?? "FS";
        const target = tasks[to] as (typeof tasks)[number];
        return {
          from,
          to,
          offset: type[1] === "F" ? target.duration : 0,
          reads: (positions[from] as number[]).map((work) => target.time.work(edgeAt(from, work, type[0] === "F")) + (dependency.lagMs ?? 0)),
        };
      });
      const lowers = tasks.map((task) => {
        let lower = project.projectStart === undefined ? -Infinity : task.time.work(project.projectStart);
        const constraint = task.constraint;
        if (constraint?.date !== undefined) {
          const date = task.time.work(constraint.date as number);
          if (constraint.type === "startNoEarlierThan" || constraint.type === "mustStartOn") lower = Math.max(lower, date);
          else lower = Math.max(lower, date - task.duration);
        }
        const free = lower === -Infinity && !project.dependencies.some((dependency) => dependency.to === task.item.id);
        return free ? task.time.work(task.item.start as number) : lower;
      });
      // Every combination of grid positions; keep the least of each task over the ones that break nothing.
      const count = tasks.length;
      const choice = new Array<number>(count).fill(0);
      const least = new Array<number>(count).fill(Infinity);
      let feasible = 0;
      const total = (BELOW + ABOVE + 1) ** count;
      for (let combination = 0; combination < total; combination += 1) {
        let rest = combination;
        for (let at = 0; at < count; at += 1) {
          choice[at] = rest % (BELOW + ABOVE + 1);
          rest = Math.floor(rest / (BELOW + ABOVE + 1));
        }
        let ok = true;
        for (let at = 0; at < count && ok; at += 1) ok = ((positions[at] as number[])[choice[at] as number] as number) >= (lowers[at] as number);
        for (const arrow of arrows) {
          if (!ok) break;
          ok = ((positions[arrow.to] as number[])[choice[arrow.to] as number] as number) + arrow.offset >= (arrow.reads[choice[arrow.from] as number] as number);
        }
        if (!ok) continue;
        feasible += 1;
        for (let at = 0; at < count; at += 1) least[at] = Math.min(least[at] as number, (positions[at] as number[])[choice[at] as number] as number);
      }
      expect(feasible, `case ${String(index)}: the grid holds a schedule`).toBeGreaterThan(0);
      for (const [at, task] of tasks.entries()) {
        const scheduled = schedule.tasks.get(task.item.id);
        const work = task.time.work(scheduled?.start as number);
        expect(work - task.origin, `case ${String(index)} ${task.item.id}: inside the searched grid`).toBeLessThan(ABOVE * HOUR);
        expect(work - task.origin, `case ${String(index)} ${task.item.id}: inside the searched grid`).toBeGreaterThan(-BELOW * HOUR);
        expect(work, `case ${String(index)} ${task.item.id}`).toBe(least[at]);
        if (scheduled?.moved === true) pushed += 1;
        searched += 1;
      }
    }
    expect(searched).toBeGreaterThan(120);
    expect(pushed).toBeGreaterThan(40);
  });

  it("[claim:critical-path] measures slack as how far a task alone can slip without moving the finish, and the critical tasks are exactly those with none, in chains", () => {
    const random = makeRandom(SEED + 6);
    let probed = 0;
    let critical = 0;
    let slack = 0;
    for (let index = 0; index < 80; index += 1) {
      const project = generateProject(random, {
        tasks: 2 + Math.floor(random() * 6),
        density: 0.35,
        calendars: GRID_CALENDARS,
        oneCalendar: true,
        constraintTypes: ["startNoEarlierThan", "finishNoEarlierThan"],
        constraintChance: 0.25,
        hourGrid: true,
        spreadHours: 10,
        projectStart: true,
      });
      const options = optionsOf(project);
      const schedule = scheduleTasks(project.items, project.dependencies, options);
      const placed = placedOf(project, schedule);
      const finish = schedule.finish as number;
      for (const item of project.items) {
        const task = schedule.tasks.get(item.id);
        if (task === undefined) continue;
        const time = workTime(project.calendars.get(item.id));
        // Push this task alone to a later start, and see whether the finish moves.
        let slip = 0;
        while (slip < 100) {
          const pushedTo = time.work(task.start) + (slip + 1) * HOUR;
          const date = task.durationMs === 0 ? time.finish(pushedTo) : time.start(pushedTo);
          const again = scheduleTasks(project.items, project.dependencies, {
            ...options,
            constraintOf: (each: Item) => (each.id === item.id ? { type: "startNoEarlierThan", date } : project.constraints.get(each.id)),
          });
          if ((again.finish as number) > finish) break;
          slip += 1;
        }
        expect(task.slackMs, `case ${String(index)} ${item.id}`).toBe(slip * HOUR);
        expect(task.critical).toBe(task.slackMs === 0);
        expect(schedule.critical.includes(item.id)).toBe(task.critical);
        if (task.critical) {
          // It finishes the project, or drives a critical successor.
          const own = placed.get(item.id) as Placed;
          const ends = own.time.work(own.finish) === own.time.work(finish);
          const drives = project.dependencies.some(
            (dependency) => dependency.from === item.id && schedule.tasks.get(dependency.to)?.critical === true && dependencyBreak(dependency, placed) === 0,
          );
          expect(ends || drives, `case ${String(index)} ${item.id} is critical but neither finishes nor drives`).toBe(true);
          critical += 1;
        } else {
          slack += 1;
        }
        probed += 1;
      }
      expect(schedule.critical.length).toBeGreaterThan(0);
    }
    expect(probed).toBeGreaterThan(200);
    expect(critical).toBeGreaterThan(50);
    expect(slack).toBeGreaterThan(50);
  });
});
