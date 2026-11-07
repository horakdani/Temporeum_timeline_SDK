# Scheduling

The scheduler puts tasks where their dependencies, constraints and working calendars say, measures how much each one can slip, and finds the critical path. It is on its own entry point, `@temporeum/timeline-core/schedule`, and it is pure: items and dependencies in, a schedule out. Nothing moves until you apply the one command it gives you — and that command's inverse is the undo.

## One call, one command

```js excerpt:example/schedule
import { addWorkingMs, scheduleCommand, scheduleTasks } from "@temporeum/timeline-core/schedule";
// …
  const result = scheduleTasks(items, dependencies, { calendar, constraintOf: (item) => constraints[item.id] });
  const command = scheduleCommand(items, result, "Schedule");
  if (command !== undefined) {
    apply(command);
    undo.push(command);
  }
```

::: example schedule

- **`scheduleTasks` computes, and changes nothing.** It returns where every task goes (`start`, `end`), how much working time it can slip (`slackMs`), whether it is `critical`, and which constraints cannot hold (`conflicts`).
- **`scheduleCommand` is the only way a schedule reaches the items.** It is one command, of type `"schedule"`, with a patch for each task that moves and none for the rest. Apply it with `timeline.applyCommand(command)`, keep it, and `command.inverse` puts every task back exactly. `undefined` means there is nothing to move.
- **The library does not save.** Storing the plan is yours, like every other edit.
- **The dependencies are the ones the arrows draw** — the same `Dependency` objects: `from`, `to`, `type` (`FS`, `SS`, `FF`, `SF`) and `lagMs`, which may be negative for a lead.
- **A task by the day is scheduled as it is drawn.** An item with a `granularity` covers its whole units — `end: new Date("2026-03-03")` by the day runs to the end of the 3rd — so its successor starts on the 4th. That `Date` is midnight in UTC; with another `timeZone`, give that zone's midnight, or the day is the one before. Give the timeline's `timeZone` to `scheduleTasks` so the days are the ones on screen; a moved end comes back the way such an item writes it, as the start of its last day.

## Working time

```js excerpt:example/schedule
// Office hours (Monday to Friday, 08:00–12:00 and 13:00–17:00) in Budapest.
const calendar = { timeZone: "Europe/Budapest", exceptions: [{ date: "2026-04-06" }] };
```

A calendar is a time zone, a week of shifts and the days that differ from it:

| Field | What it is |
|---|---|
| `timeZone` | The IANA zone the shifts and dates are read in. `UTC` by default. |
| `week` | Seven days, Monday first; each a list of shifts, `[from, to]` in minutes after midnight. Monday to Friday, 08:00–12:00 and 13:00–17:00, when omitted. |
| `exceptions` | `{ date, until?, shifts? }` — days, `YYYY-MM-DD` in the zone, worked differently. No shifts is a day off. |

Everything the scheduler measures is working time. A task's duration is the working time between its start and end, so a task that runs from Friday 16:00 to Monday 09:00 is two hours long, and stays two hours long wherever it moves. A lag is working time in the successor's calendar. Daylight-saving changes are read off the platform's zone data: a shift is as long as the clock says it is, on both sides of a change.

- **A task starts where work resumes, and finishes where it stops.** Two hours after Friday 16:00 is Monday 09:00; a task that follows one finishing Friday 17:00 starts Monday 08:00.
- **Each task can have its own calendar** (`calendarOf`), and tasks without one use `calendar`. With no calendar at all, every hour is working time.
- `workingMs(calendar, from, to)` and `addWorkingMs(calendar, t, ms)` do the same arithmetic for you — the example builds its tasks with the second.

## Constraints

```js excerpt:example/schedule
// Launch by Thursday 16 April, 17:00.
const constraints = { launch: { type: "finishNoLaterThan", date: Date.UTC(2026, 3, 16, 15) } };
```

| `type` | The task… |
|---|---|
| `asSoonAsPossible` (default) | starts as early as its predecessors allow |
| `asLateAsPossible` | finishes as late as its successors and the project's finish allow |
| `startNoEarlierThan`, `finishNoEarlierThan` | does not start, or finish, before `date` |
| `startNoLaterThan`, `finishNoLaterThan` | should not start, or finish, after `date` |
| `mustStartOn`, `mustFinishOn` | starts, or finishes, on `date` |

**An arrow is never broken to keep a date.** The lower constraints always hold. An upper one that the dependencies push a task past is reported in `conflicts`, with how many working hours it is missed by, and the task's slack goes negative. In the example the launch is four working hours late, and the status line says so.

A task with nothing before it — no predecessor, no lower constraint — stays where it is, moved only onto working time. A milestone, or anything else that takes no working time, is not moved at all: a milestone at Monday 08:00 stays at Monday 08:00, though it is the same working time as Friday 17:00. Give `projectStart` and they all start there instead.

## Slack and the critical path

`slackMs` is how much later, in working time, a task could start without moving the project's finish or missing a constraint. The finish is the last task's, or `projectFinish` if you give one. A task with no slack is `critical`, and `schedule.critical` lists them, predecessors first: each one either finishes the project or drives a critical successor.

## Cycles

A cycle cannot be scheduled. `scheduleTasks` finds every one — the tasks of each group that depend on each other in a circle, in item order — and returns them in `cycles`, with no tasks placed; `scheduleCommand` then gives `undefined`. A dependency that names an item that is not there is left out and listed in `ignored`. Background items are never tasks.

## What it does not do yet

- **Resources.** Two tasks of one person can overlap; levelling them is the resource view's job.
- **Splitting.** A task is one run of work; it is not split around another.
- **Progress.** `progress` is drawn, not used: a half-done task is scheduled as a whole one.
- **Scheduling on its own.** Nothing reschedules when a task moves; the host calls the scheduler, as the example's button does.
