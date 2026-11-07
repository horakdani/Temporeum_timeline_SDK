/**
 * `@temporeum/timeline-core/schedule` — the scheduler.
 *
 * Pure and deterministic: items and their dependencies in, a schedule out —
 * where each task goes, how much slack it has, which ones are critical, which
 * constraints cannot hold. Nothing is changed and nothing is saved. The one
 * way a schedule reaches the items is {@link scheduleCommand}: a single
 * reversible command for the host to apply, store and undo.
 *
 * Every date is read in working time (see {@link WorkTime}). A task's
 * duration is the working time between its start and end, a lag is working
 * time in the successor's calendar, and a constraint's date is compared in
 * the task's own.
 *
 * The arrows never break. A task goes as early as its predecessors and its
 * lower constraints let it — and where it has neither, it stays where it is,
 * or at `projectStart` when one is given. An upper constraint the arrows
 * push a task past is reported in `conflicts`, not obeyed by breaking one.
 */

import { addCalendar, DEFAULT_TIME_ZONE, startOf } from "../calendar.js";
import { createCommand } from "../editing.js";
import { resolveSpan } from "../layout.js";
import type { Dependency } from "../gantt/index.js";
import { toTimeMs } from "../time.js";
import type { Command, Item, ItemPatch, TimeInput, TimeMs } from "../types.js";
import { CONTINUOUS, workTime } from "./work-time.js";
import type { WorkCalendar, WorkTime } from "./work-time.js";

export { addWorkingMs, CONTINUOUS, OFFICE_WEEK, workingMs, workTime } from "./work-time.js";
export type { WorkCalendar, WorkException, WorkShift, WorkTime } from "./work-time.js";
export type { Dependency, DependencyType } from "../gantt/index.js";

/** Where a task may go, besides where its arrows put it. */
export type ConstraintType =
  | "asSoonAsPossible"
  | "asLateAsPossible"
  | "startNoEarlierThan"
  | "startNoLaterThan"
  | "finishNoEarlierThan"
  | "finishNoLaterThan"
  | "mustStartOn"
  | "mustFinishOn";

/** A date a task has to keep to — its start or its finish, no earlier, no later or exactly — or "as soon/late as possible". */
export interface TaskConstraint {
  readonly type: ConstraintType;
  /** Every type but the two "as … as possible" needs one. */
  readonly date?: TimeInput;
}

/** How `scheduleTasks` reads the items: the working calendars, the constraints, where the project starts and finishes. */
export interface ScheduleOptions<T = unknown> {
  /** The calendar of every task without its own. None: all time is working time. */
  readonly calendar?: WorkCalendar;
  readonly calendarOf?: (item: Item<T>) => WorkCalendar | undefined;
  readonly constraintOf?: (item: Item<T>) => TaskConstraint | undefined;
  /** Where tasks with nothing before them start. They stay where they are when omitted. */
  readonly projectStart?: TimeInput;
  /** What slack is measured against, and where "as late as possible" ends. The last finish when omitted. */
  readonly projectFinish?: TimeInput;
  /**
   * The timeline's zone. A task with a `granularity` is scheduled over the
   * units it is drawn over there (`end: new Date("2026-03-03")` by the day
   * runs to the end of the 3rd), and written back the way such an item writes its end:
   * the start of its last unit. UTC by default.
   */
  readonly timeZone?: string;
}

/** One task as the schedule places it: its start and end, its working duration, its slack, and whether it is critical or moved. */
export interface ScheduledTask {
  readonly id: string;
  readonly start: TimeMs;
  /**
   * Absent for a task without an end: an instant, or a milestone. For a task
   * with a `granularity`, the start of its last unit, as the item writes it.
   */
  readonly end?: TimeMs;
  /** Working time between start and end. */
  readonly durationMs: number;
  /** How much later, in working time, the task could start without moving the finish or missing a constraint. */
  readonly slackMs: number;
  /** No slack: a delay here delays the project. */
  readonly critical: boolean;
  /** Whether the schedule puts the task somewhere else. */
  readonly moved: boolean;
}

/** An upper constraint the arrows push a task past. */
export interface ScheduleConflict {
  readonly id: string;
  readonly constraint: TaskConstraint;
  /** By how much working time it is missed. */
  readonly byMs: number;
}

/** What `scheduleTasks` returns: every task placed, the critical path, the conflicts, the cycles found and the dependencies ignored. */
export interface Schedule {
  /** Every task, by id — none when there is a cycle. */
  readonly tasks: ReadonlyMap<string, ScheduledTask>;
  /** The critical tasks, predecessors first. */
  readonly critical: readonly string[];
  readonly conflicts: readonly ScheduleConflict[];
  /** Each group of tasks that depend on each other in a circle, in item order. A schedule with one does nothing. */
  readonly cycles: readonly (readonly string[])[];
  /** Dependencies naming an item that is not a task, by id. */
  readonly ignored: readonly string[];
  /** The last finish, or `projectFinish`. */
  readonly finish?: TimeMs;
}

interface Link {
  readonly from: Task;
  readonly to: Task;
  readonly lag: number;
  /** The predecessor's edge is its start. */
  readonly fromStart: boolean;
  /** The successor's edge is its finish. */
  readonly toEnd: boolean;
}

interface Task {
  readonly item: Item<unknown>;
  readonly index: number;
  readonly time: WorkTime;
  readonly constraint: TaskConstraint | undefined;
  /** The constraint's date in working time. */
  readonly date: number;
  readonly hasEnd: boolean;
  readonly duration: number;
  /**
   * Without a working calendar, the end of a task by the day (or month,
   * year…) from where its first unit starts: as many whole units as it is
   * drawn over, not as many milliseconds — a month moved into February is
   * February, a day moved onto a 23-hour day is that day (Y3).
   */
  readonly endOf: ((start: TimeMs) => TimeMs) | undefined;
  /**
   * Its inverse: the start whose end by whole units is the latest at or
   * before `end` — or, `early`, the earliest at or after it. Slack, a finish
   * link and a finish constraint step back from an end by units too (Z2).
   */
  readonly startBy: ((end: TimeMs, early: boolean) => TimeMs) | undefined;
  readonly ins: Link[];
  readonly outs: Link[];
  /** Its own instants, and where its start is in working time: a moment nothing moves keeps them. */
  readonly startMs: TimeMs;
  readonly endMs: TimeMs | undefined;
  readonly origin: number;
  /** Where it starts, in working time. */
  at: number;
  late: number;
}

/** The units that are a fixed number of milliseconds: their length is their duration. */
const FIXED_UNITS = new Set(["millisecond", "second", "minute", "hour"]);

const LOWER_START = new Set<ConstraintType>(["startNoEarlierThan", "mustStartOn"]);
const LOWER_FINISH = new Set<ConstraintType>(["finishNoEarlierThan", "mustFinishOn"]);
const UPPER_START = new Set<ConstraintType>(["startNoLaterThan", "mustStartOn"]);
const UPPER_FINISH = new Set<ConstraintType>(["finishNoLaterThan", "mustFinishOn"]);

/**
 * The instant of an edge of a task starting at `at`. A task with no duration
 * is one moment, where work stopped — unless it is where it was: every
 * instant of a break is the same working time, and its own is the one it has.
 */
function edge(task: Task, at: number, end: boolean): TimeMs {
  if (task.duration === 0) return at !== task.origin ? task.time.finish(at) : end ? (task.endMs ?? task.startMs) : task.startMs;
  return end ? (task.endOf?.(at) ?? task.time.finish(at + task.duration)) : task.time.start(at);
}

/** Its end, in working time, when it starts at `at`. */
function finishOf(task: Task, at: number): number {
  return task.endOf !== undefined && task.duration !== 0 ? task.endOf(at) : at + task.duration;
}

/** The start, in working time, that puts its end at `end`: the latest at or before it, or `early`, the earliest at or after. */
function startFor(task: Task, end: number, early: boolean): number {
  return task.startBy !== undefined && task.duration !== 0 ? task.startBy(end, early) : end - task.duration;
}

/** The latest start, in working time, that puts the task's edge at or before `limit`. */
function latest(task: Task, end: boolean, limit: TimeMs): number {
  const work = task.time.work(limit);
  if (end || task.duration === 0) return end ? startFor(task, work, false) : work;
  // Where work resumes after `limit` is later than `limit` when it falls in a
  // break: the start has to be the moment before.
  return task.time.start(work) > limit ? work - 1 : work;
}

/** The groups of tasks on a cycle, by Tarjan's components — without recursion, so a long cycle cannot overflow the stack. */
function cyclesOf(tasks: readonly Task[]): string[][] {
  const order = new Map<Task, number>();
  const low = new Map<Task, number>();
  const stack: Task[] = [];
  const held = new Set<Task>();
  const found: [number, string[]][] = [];
  let counter = 0;
  for (const root of tasks) {
    if (order.has(root)) continue;
    const path: [Task, number][] = [[root, 0]];
    order.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    held.add(root);
    while (path.length > 0) {
      const top = path[path.length - 1] as [Task, number];
      const [task, next] = top;
      const link = task.outs[next];
      if (link !== undefined) {
        top[1] = next + 1;
        const to = link.to;
        if (!order.has(to)) {
          order.set(to, counter);
          low.set(to, counter);
          counter += 1;
          stack.push(to);
          held.add(to);
          path.push([to, 0]);
        } else if (held.has(to)) {
          low.set(task, Math.min(low.get(task) as number, order.get(to) as number));
        }
        continue;
      }
      path.pop();
      const parent = path[path.length - 1];
      if (parent !== undefined) low.set(parent[0], Math.min(low.get(parent[0]) as number, low.get(task) as number));
      if (low.get(task) !== order.get(task)) continue;
      const group: Task[] = [];
      let member: Task | undefined;
      do {
        member = stack.pop() as Task;
        held.delete(member);
        group.push(member);
      } while (member !== task);
      if (group.length > 1 || task.outs.some((each) => each.to === task)) {
        group.sort((a, b) => a.index - b.index);
        found.push([(group[0] as Task).index, group.map((each) => each.item.id)]);
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map((each) => each[1]);
}

/**
 * Schedule the items by their dependencies, constraints and calendars.
 *
 * Background items are not tasks. A dependency naming something that is not
 * a task is left out and listed in `ignored`.
 */
export function scheduleTasks<T>(items: readonly Item<T>[], dependencies: readonly Dependency[], options: ScheduleOptions<T> = {}): Schedule {
  const tasks: Task[] = [];
  const byId = new Map<string, Task>();
  for (const item of items) {
    if (item.kind === "background") continue;
    const time = workTime(options.calendarOf?.(item) ?? options.calendar);
    const constraint = options.constraintOf?.(item);
    if (constraint !== undefined && constraint.date === undefined && constraint.type !== "asSoonAsPossible" && constraint.type !== "asLateAsPossible") {
      throw new RangeError(`The ${constraint.type} constraint of "${item.id}" needs a date`);
    }
    const hasEnd = item.end !== undefined && item.kind !== "milestone";
    // Where the layout draws it: a task by the day covers its whole days.
    const span = item.granularity !== undefined && item.granularity !== "millisecond" && item.open !== true ? resolveSpan(item, options.timeZone) : undefined;
    const startMs = span?.start ?? toTimeMs(item.start);
    const endMs = hasEnd ? (span?.end ?? toTimeMs(item.end as TimeInput)) : undefined;
    const start = time.work(startMs);
    let endOf: Task["endOf"];
    let startBy: Task["startBy"];
    const unit = item.granularity;
    if (span !== undefined && time === CONTINUOUS && unit !== undefined && !FIXED_UNITS.has(unit)) {
      const zone = options.timeZone;
      let units = 0;
      for (let at = span.start; at < span.end; at = addCalendar(at, unit, 1, zone)) units += 1;
      endOf = (at) => addCalendar(startOf(at, unit, zone), unit, units, zone);
      startBy = (end, early) => {
        const at = startOf(end, unit, zone);
        return addCalendar(early && at < end ? addCalendar(at, unit, 1, zone) : at, unit, -units, zone);
      };
    }
    const task: Task = {
      item: item as Item<unknown>,
      index: tasks.length,
      time,
      constraint,
      date: constraint?.date === undefined ? 0 : time.work(toTimeMs(constraint.date)),
      hasEnd,
      duration: endMs === undefined ? 0 : Math.max(0, time.work(endMs) - start),
      endOf,
      startBy,
      ins: [],
      outs: [],
      startMs,
      endMs,
      origin: start,
      at: start,
      late: 0,
    };
    tasks.push(task);
    byId.set(item.id, task);
  }

  const ignored: string[] = [];
  for (const dependency of dependencies) {
    const from = byId.get(dependency.from);
    const to = byId.get(dependency.to);
    if (from === undefined || to === undefined) {
      ignored.push(dependency.id ?? `${dependency.from}->${dependency.to}`);
      continue;
    }
    const type = dependency.type ?? "FS";
    const link: Link = { from, to, lag: dependency.lagMs ?? 0, fromStart: type[0] === "S", toEnd: type[1] === "F" };
    from.outs.push(link);
    to.ins.push(link);
  }

  // Predecessors first, ties in item order.
  const waiting = new Map<Task, number>();
  const order: Task[] = [];
  for (const task of tasks) {
    waiting.set(task, task.ins.length);
    if (task.ins.length === 0) order.push(task);
  }
  for (let index = 0; index < order.length; index += 1) {
    for (const link of (order[index] as Task).outs) {
      const left = (waiting.get(link.to) as number) - 1;
      waiting.set(link.to, left);
      if (left === 0) order.push(link.to);
    }
  }
  if (order.length < tasks.length) {
    return { tasks: new Map(), critical: [], conflicts: [], cycles: cyclesOf(tasks), ignored };
  }

  // Forward: as early as the arrows and the lower constraints let it.
  const projectStart = options.projectStart === undefined ? undefined : toTimeMs(options.projectStart);
  for (const task of order) {
    let lower = projectStart === undefined ? -Infinity : task.time.work(projectStart);
    for (const link of task.ins) {
      const at = task.time.work(edge(link.from, link.from.at, !link.fromStart)) + link.lag;
      lower = Math.max(lower, link.toEnd ? startFor(task, at, true) : at);
    }
    const type = task.constraint?.type;
    if (type !== undefined && LOWER_START.has(type)) lower = Math.max(lower, task.date);
    if (type !== undefined && LOWER_FINISH.has(type)) lower = Math.max(lower, startFor(task, task.date, true));
    // Nothing places it: it stays.
    if (lower !== -Infinity) task.at = lower;
  }

  let finish = options.projectFinish === undefined ? undefined : toTimeMs(options.projectFinish);
  if (finish === undefined) {
    for (const task of tasks) {
      const end = edge(task, task.at, true);
      if (finish === undefined || end > finish) finish = end;
    }
  }
  const last = finish as TimeMs;

  /** The latest start the finish and the successors, where they are, allow. */
  const limit = (task: Task, use: (link: Link) => number): number => {
    let at = startFor(task, task.time.work(last), false);
    for (const link of task.outs) {
      // The successor's edge minus the lag, in its working time; the latest
      // instant with no more work than that.
      at = Math.min(at, latest(task, !link.fromStart, link.to.time.start((link.toEnd ? finishOf(link.to, use(link)) : use(link)) - link.lag)));
    }
    return at;
  };

  // As late as possible: after the forward pass, last first, against the
  // successors where they now are. Later only ever keeps its own arrows in.
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const task = order[index] as Task;
    if (task.constraint?.type === "asLateAsPossible") task.at = Math.max(task.at, limit(task, (link) => link.to.at));
  }

  const conflicts: ScheduleConflict[] = [];
  const scheduled = new Map<string, ScheduledTask>();
  const critical: string[] = [];
  // Backward: the latest each could start, for its slack.
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const task = order[index] as Task;
    let late = limit(task, (link) => link.to.late);
    const type = task.constraint?.type;
    if (type !== undefined && UPPER_START.has(type)) {
      late = Math.min(late, task.date);
      if (task.at > task.date) conflicts.push({ id: task.item.id, constraint: task.constraint as TaskConstraint, byMs: task.at - task.date });
    }
    if (type !== undefined && UPPER_FINISH.has(type)) {
      late = Math.min(late, startFor(task, task.date, false));
      const done = finishOf(task, task.at);
      if (done > task.date) conflicts.push({ id: task.item.id, constraint: task.constraint as TaskConstraint, byMs: done - task.date });
    }
    task.late = late;
  }
  for (const task of order) {
    const item = task.item;
    const unit = item.granularity !== undefined && item.granularity !== "millisecond" && item.open !== true ? item.granularity : undefined;
    // Back in the item's own terms: where nothing moved, what it says; a moved
    // end by units is the start of its last unit, as the item writes it.
    // A task by the day starts on the day work starts, not at the hour (V5).
    const zone = options.timeZone ?? DEFAULT_TIME_ZONE;
    const drawnStart = unit === undefined ? edge(task, task.at, false) : startOf(edge(task, task.at, false), unit, zone);
    const drawnEnd = task.hasEnd ? edge(task, task.at, true) : undefined;
    const start = drawnStart === task.startMs ? toTimeMs(item.start) : drawnStart;
    // By units, the end is compared as the start is: its last unit against
    // the one the item is drawn to. Under a working calendar the drawn end is
    // the end of a shift, never the span's end, and an item not written at
    // the zone's midnights had its end rewritten before its start (X11).
    const lastUnit = drawnEnd === undefined || unit === undefined ? undefined : startOf(drawnEnd - 1, unit, zone);
    const kept = drawnEnd !== undefined && (unit === undefined ? drawnEnd === task.endMs : lastUnit === startOf((task.endMs as number) - 1, unit, zone));
    const end = drawnEnd === undefined ? undefined : kept ? toTimeMs(item.end as TimeInput) : (lastUnit ?? drawnEnd);
    const slack = task.late - task.at;
    const entry: { -readonly [K in keyof ScheduledTask]: ScheduledTask[K] } = {
      id: item.id,
      start,
      durationMs: task.duration,
      slackMs: slack,
      critical: slack <= 0,
      moved: start !== toTimeMs(item.start) || (end !== undefined && end !== toTimeMs(item.end as TimeInput)),
    };
    if (end !== undefined) entry.end = end;
    scheduled.set(item.id, entry);
    if (entry.critical) critical.push(item.id);
  }
  conflicts.sort((a, b) => (byId.get(a.id) as Task).index - (byId.get(b.id) as Task).index);
  return { tasks: scheduled, critical, conflicts, cycles: [], ignored, finish: last };
}

/**
 * The one command that puts the items where a schedule says.
 *
 * Only the tasks that move are in it, in item order. `undefined` when nothing
 * moves — or the schedule has a cycle, and so places nothing.
 */
export function scheduleCommand<T>(items: readonly Item<T>[], schedule: Schedule, label?: string): Command<T> | undefined {
  const before: ItemPatch<T>[] = [];
  const after: ItemPatch<T>[] = [];
  for (const item of items) {
    const task = schedule.tasks.get(item.id);
    if (task?.moved !== true) continue;
    if (task.end === undefined) {
      before.push({ id: item.id, start: toTimeMs(item.start) });
      after.push({ id: item.id, start: task.start });
    } else {
      before.push({ id: item.id, start: toTimeMs(item.start), end: toTimeMs(item.end as TimeInput) });
      after.push({ id: item.id, start: task.start, end: task.end });
    }
  }
  return after.length === 0 ? undefined : createCommand("schedule", before, after, label);
}
