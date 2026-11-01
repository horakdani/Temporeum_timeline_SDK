/**
 * Generated projects for the scheduler's suites, and the checks that read a
 * schedule back without asking the scheduler how it got there.
 *
 * Every check here is in working time, as the scheduler's promises are: a
 * dependency holds when the successor's edge is at least the lag after the
 * predecessor's in the SUCCESSOR's working time, a constraint when the
 * task's edge is on the right side of its date in the task's own. The
 * working time itself is checked separately, against a count of
 * quarter-hours (`[claim:calendar]`), so these checks can lean on it.
 */

import type { Dependency, DependencyType } from "../../src/gantt/index.js";
import { workTime } from "../../src/schedule/index.js";
import type { ConstraintType, Schedule, ScheduleOptions, TaskConstraint, WorkCalendar, WorkShift, WorkTime } from "../../src/schedule/index.js";
import type { Item, TimeMs } from "../../src/types.js";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Monday 2025-03-24, 00:00 UTC: the week before Europe's clocks go forward. */
export const BASE = Date.UTC(2025, 2, 24);
export const TYPES: readonly DependencyType[] = ["FS", "SS", "FF", "SF"];

const OFFICE: WorkShift[] = [
  [480, 720],
  [780, 1020],
];

/** Calendars whose shifts are whole hours and avoid 01:00–04:00, so every edge is on the hour grid and never in a skipped or repeated hour. */
export const HOUR_CALENDARS: readonly (WorkCalendar | undefined)[] = [
  undefined,
  {},
  { timeZone: "Europe/Budapest", exceptions: [{ date: "2025-03-26" }, { date: "2025-03-31", until: "2025-04-01" }] },
  { timeZone: "America/New_York", week: [OFFICE, OFFICE, OFFICE, OFFICE, [[360, 600]], [[600, 840]], []] },
  { timeZone: "Asia/Kolkata", week: [[[300, 1260]], [[300, 1260]], [], [[0, 60], [1200, 1440]], [[0, 60], [1200, 1440]], [], []] },
];

export interface Project {
  readonly items: Item[];
  readonly dependencies: Dependency[];
  readonly calendars: Map<string, WorkCalendar | undefined>;
  readonly constraints: Map<string, TaskConstraint>;
  readonly projectStart?: TimeMs;
  readonly projectFinish?: TimeMs;
}

export interface ProjectShape {
  readonly tasks: number;
  /** Chance of a dependency between a pair. */
  readonly density: number;
  readonly calendars: readonly (WorkCalendar | undefined)[];
  /** One calendar for the whole project. */
  readonly oneCalendar?: boolean;
  readonly constraintTypes: readonly ConstraintType[];
  readonly constraintChance: number;
  /** Lags, durations and dates on whole hours. */
  readonly hourGrid?: boolean;
  /** Anchors and dates within this many hours of the base. */
  readonly spreadHours: number;
  readonly projectStart?: boolean;
}

const pick = <T>(random: () => number, values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;

/** A project: tasks in item order, dependencies only from earlier to later items, so it has no cycle. */
export function generateProject(random: () => number, shape: ProjectShape): Project {
  const items: Item[] = [];
  const calendars = new Map<string, WorkCalendar | undefined>();
  const constraints = new Map<string, TaskConstraint>();
  const shared = pick(random, shape.calendars);
  const grid = (hours: number): number => (shape.hourGrid === true ? Math.round(hours) * HOUR : Math.round(hours * HOUR));
  for (let index = 0; index < shape.tasks; index += 1) {
    const id = `t${String(index)}`;
    const calendar = shape.oneCalendar === true ? shared : pick(random, shape.calendars);
    calendars.set(id, calendar);
    const time = workTime(calendar);
    // A start on working time, a few working hours of work.
    const anchor = time.start(time.work(BASE) + grid(random() * shape.spreadHours));
    const roll = random();
    const item: { id: string; start: number; end?: number; kind?: "milestone" } = { id, start: anchor };
    if (roll < 0.12) item.kind = "milestone";
    else if (roll > 0.2) item.end = time.finish(time.work(anchor) + grid(1 + random() * 3));
    items.push(item);
    if (random() < shape.constraintChance && shape.constraintTypes.length > 0) {
      const type = pick(random, shape.constraintTypes);
      const date = time.start(time.work(BASE) + grid(random() * (shape.spreadHours + 12)));
      constraints.set(id, type === "asSoonAsPossible" || type === "asLateAsPossible" ? { type } : { type, date });
    }
  }
  const dependencies: Dependency[] = [];
  for (let to = 1; to < items.length; to += 1) {
    for (let from = 0; from < to; from += 1) {
      if (random() >= shape.density) continue;
      dependencies.push({
        from: (items[from] as Item).id,
        to: (items[to] as Item).id,
        type: pick(random, TYPES),
        lagMs: grid(random() * 5 - 2),
      });
    }
  }
  const project: { -readonly [K in keyof Project]: Project[K] } = { items, dependencies, calendars, constraints };
  if (shape.projectStart === true && random() < 0.5) project.projectStart = BASE + grid(random() * 4);
  return project;
}

export function optionsOf(project: Project): ScheduleOptions {
  return {
    calendarOf: (item) => project.calendars.get(item.id),
    constraintOf: (item) => project.constraints.get(item.id),
    ...(project.projectStart === undefined ? {} : { projectStart: project.projectStart }),
    ...(project.projectFinish === undefined ? {} : { projectFinish: project.projectFinish }),
  };
}

/** A task as it ends up: its calendar, and where its edges are. */
export interface Placed {
  readonly id: string;
  readonly time: WorkTime;
  readonly start: TimeMs;
  /** Where its work is done: its end, or its start when it has none. */
  readonly finish: TimeMs;
}

export function placedOf(project: Project, schedule: Schedule): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  for (const item of project.items) {
    const task = schedule.tasks.get(item.id);
    if (task === undefined) continue;
    placed.set(item.id, { id: item.id, time: workTime(project.calendars.get(item.id)), start: task.start, finish: task.end ?? task.start });
  }
  return placed;
}

/** By how much a dependency is broken, in the successor's working time: 0 or less when it holds. */
export function dependencyBreak(dependency: Dependency, placed: ReadonlyMap<string, Placed>): number {
  const from = placed.get(dependency.from) as Placed;
  const to = placed.get(dependency.to) as Placed;
  const type = dependency.type ?? "FS";
  const fromEdge = type[0] === "S" ? from.start : from.finish;
  const toEdge = type[1] === "S" ? to.start : to.finish;
  return to.time.work(fromEdge) + (dependency.lagMs ?? 0) - to.time.work(toEdge);
}

/** By how much a constraint is missed, in the task's working time: 0 or less when it holds. `undefined` for the "as … as possible" two. */
export function constraintMiss(constraint: TaskConstraint, task: Placed): { readonly lower: number; readonly upper: number } | undefined {
  if (constraint.date === undefined) return undefined;
  const date = task.time.work(constraint.date as number);
  const start = task.time.work(task.start);
  const finish = task.time.work(task.finish);
  switch (constraint.type) {
    case "startNoEarlierThan":
      return { lower: date - start, upper: -Infinity };
    case "startNoLaterThan":
      return { lower: -Infinity, upper: start - date };
    case "finishNoEarlierThan":
      return { lower: date - finish, upper: -Infinity };
    case "finishNoLaterThan":
      return { lower: -Infinity, upper: finish - date };
    case "mustStartOn":
      return { lower: date - start, upper: start - date };
    default:
      return { lower: date - finish, upper: finish - date };
  }
}

/** The working time between an item's own start and end. */
export function ownDuration(item: Item, time: WorkTime): number {
  if (item.end === undefined || item.kind === "milestone") return 0;
  return Math.max(0, time.work(item.end as number) - time.work(item.start as number));
}

/** The items with a schedule applied by hand — not through the command, so the command's suite can compare against it. */
export function movedItems(items: readonly Item[], schedule: Schedule): Item[] {
  return items.map((item) => {
    const task = schedule.tasks.get(item.id);
    if (task === undefined) return item;
    return task.end === undefined ? { ...item, start: task.start } : { ...item, start: task.start, end: task.end };
  });
}

/** Frozen all the way down, so a write anywhere throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
