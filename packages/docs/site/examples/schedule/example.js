import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin } from "@temporeum/timeline-element/gantt";
import { applyPatches } from "@temporeum/timeline-core";
import { addWorkingMs, scheduleCommand, scheduleTasks } from "@temporeum/timeline-core/schedule";

registerPlugin(ganttPlugin);

const hour = 3_600_000;
const day = 24 * hour;
// Monday 6 April 2026, 08:00 in Budapest — Easter Monday, a day off.
const monday = Date.UTC(2026, 3, 6, 6);

// Office hours (Monday to Friday, 08:00–12:00 and 13:00–17:00) in Budapest.
const calendar = { timeZone: "Europe/Budapest", exceptions: [{ date: "2026-04-06" }] };

// Every task starts on Monday for now; its length is working hours.
const task = (id, label, hours) => ({ id, label, laneId: id, start: monday, end: addWorkingMs(calendar, monday, hours * hour) });
/** @type {import("@temporeum/timeline-core").Item[]} */
let items = [
  task("spec", "Spec", 16),
  task("design", "Design", 24),
  task("api", "API", 32),
  task("ui", "UI", 24),
  task("test", "Testing", 16),
  { id: "launch", label: "Launch", laneId: "launch", start: monday, kind: "milestone" },
];
const lanes = items.map(({ id, label }) => ({ id, label }));

/** @type {import("@temporeum/timeline-core/schedule").Dependency[]} */
const dependencies = [
  { from: "spec", to: "design" },
  { from: "spec", to: "api", type: "SS", lagMs: 8 * hour },
  { from: "design", to: "ui" },
  { from: "api", to: "test" },
  { from: "ui", to: "test", type: "FF", lagMs: 4 * hour },
  { from: "test", to: "launch" },
];
// Launch by Thursday 16 April, 17:00.
const constraints = { launch: { type: "finishNoLaterThan", date: Date.UTC(2026, 3, 16, 15) } };

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  gantt: { dependencies },
  editing: { enabled: true, snapMs: hour },
  orientation: "horizontal",
  ariaLabel: "Release plan in office hours",
  domain: [monday - day, monday + 13 * day],
});

const undo = [];
const plan = document.querySelector("#plan");
const status = document.querySelector("#status");
const when = new Intl.DateTimeFormat("en-GB", { timeZone: calendar.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function apply(command) {
  items = applyPatches(items, command.after);
  timeline.applyCommand(command);
}

// The schedule is computed, not applied: one command does that, and its inverse undoes it.
function schedule() {
  const result = scheduleTasks(items, dependencies, { calendar, constraintOf: (item) => constraints[item.id] });
  const command = scheduleCommand(items, result, "Schedule");
  if (command !== undefined) {
    apply(command);
    undo.push(command);
  }
  plan.replaceChildren(
    ...items.map((item) => {
      const scheduled = result.tasks.get(item.id);
      const row = document.createElement("li");
      row.textContent = `${item.label}: ${when.format(scheduled.start)} — ${scheduled.critical ? "critical" : `${String(scheduled.slackMs / hour)} h slack`}`;
      if (scheduled.critical) row.dataset.critical = "";
      return row;
    }),
  );
  const late = result.conflicts.map((conflict) => `${conflict.id} is ${String(conflict.byMs / hour)} working hours late`);
  status.textContent = `${command === undefined ? "Nothing to move." : `Moved ${String(command.after.length)} task(s).`} ${late.join("; ")}`;
}

// A drag is a command too: keep the host's items in step, and let the next schedule reflow.
timeline.on("command", ({ command }) => {
  items = applyPatches(items, command.after);
  undo.push(command);
});
document.querySelector("#schedule").addEventListener("click", schedule);
document.querySelector("#undo").addEventListener("click", () => {
  const command = undo.pop();
  if (command !== undefined) apply(command.inverse);
});
schedule();
