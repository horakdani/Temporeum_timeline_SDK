import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The Gantt chart, and the zoom presets for frappe-gantt's view modes.
registerPlugin(ganttPlugin, toolsPlugin);

// Tasks in frappe-gantt's shape, as an existing app has them.
const frappeTasks = [
  { id: "spec", name: "Spec", start: "2026-03-02", end: "2026-03-05", progress: 100 },
  { id: "design", name: "Design", start: "2026-03-06", end: "2026-03-12", progress: 60, dependencies: "spec" },
  { id: "build", name: "Build", start: "2026-03-09", end: "2026-03-19", progress: 30, dependencies: "spec" },
  { id: "test", name: "Test", start: "2026-03-20", end: "2026-03-26", progress: 0, dependencies: "design, build", custom_class: "at-risk" },
];

// frappe-gantt reads "2026-03-02" as local midnight, and a date-only end as
// the end of that day; progress runs to 100.
const DAY = 86_400_000;
const local = (text) => {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
};
/** @type {import("@temporeum/timeline-core").Item[]} */
const items = frappeTasks.map((task) => ({
  id: task.id,
  laneId: task.id,
  label: task.name,
  start: local(task.start),
  end: new Date(local(task.end).getTime() + DAY),
  progress: task.progress / 100,
  ...(task.custom_class ? { className: task.custom_class } : {}),
}));
items.push({ id: "launch", laneId: "launch", label: "Launch", start: local("2026-03-30"), kind: "milestone" });
const lanes = items.map((item) => ({ id: item.id, label: item.label }));
const dependencies = frappeTasks.flatMap((task) =>
  (task.dependencies ?? "")
    .split(",")
    .map((from) => from.trim())
    .filter(Boolean)
    .map((from) => ({ from, to: task.id })),
);
dependencies.push({ from: "test", to: "launch" });

// frappe-gantt: { view_mode: "Week", readonly: false, snap_at: "1d" }
const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  lanes,
  gantt: { dependencies },
  orientation: "horizontal",
  zoomPresets: true,
  editing: { enabled: true, snapMs: DAY },
  ariaLabel: "Release plan, converted from frappe-gantt tasks",
});
timeline.zoomToPreset("month");
mountTaskGrid(document.querySelector("#grid"), timeline, { label: "Release tasks", focusTarget: element });

// on_date_change(task, start, end)
timeline.on("itemMoved", ({ item, to }) => {
  document.querySelector("#log").textContent = `${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`;
});
