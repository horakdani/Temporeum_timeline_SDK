import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";

// The Gantt chart is a plugin: registered once, before the first timeline.
registerPlugin(ganttPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 3, 6);
const at = (offset) => start + offset * day;

// One task per row: the row is the task's lane.
/** @type {import("@temporeum/timeline-core").Item[]} */
const tasks = [
  { id: "spec", label: "Spec", start: at(0), end: at(5), progress: 1, baseline: { start: at(0), end: at(4) } },
  { id: "design", label: "Design", start: at(5), end: at(12), progress: 0.6, baseline: { start: at(4), end: at(10) } },
  { id: "api", label: "API", start: at(7), end: at(16), progress: 0.3 },
  { id: "ui", label: "UI", start: at(12), end: at(20), progress: 0.1 },
  { id: "test", label: "Testing", start: at(16), end: at(23) },
  { id: "launch", label: "Launch", start: at(24), kind: "milestone" },
];
const items = tasks.map((task) => ({ ...task, laneId: task.id }));
const lanes = tasks.map((task) => ({ id: task.id, label: task.label }));

/** @type {import("@temporeum/timeline-core/schedule").Dependency[]} */
const dependencies = [
  { from: "spec", to: "design" },
  { from: "spec", to: "api", type: "SS", lagMs: 2 * day },
  { from: "design", to: "ui" },
  { from: "api", to: "test" },
  { from: "ui", to: "test", type: "FF", lagMs: 3 * day },
  { from: "test", to: "launch" },
];

const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  lanes,
  gantt: { dependencies },
  // The table is beside the chart, so the lanes stay rows at any width.
  orientation: "horizontal",
  ariaLabel: "Release plan",
  domain: [at(-1), at(26)],
});

// The table beside it: one row per lane, on the lane's line.
mountTaskGrid(document.querySelector("#grid"), timeline, { label: "Release tasks", focusTarget: element });

const log = document.querySelector("#log");
let focused = null;
timeline.subscribe(() => {
  const id = timeline.getSnapshot().focusedId;
  if (id === null || id === focused) return;
  focused = id;
  log.textContent = `Focused: ${tasks.find((task) => task.id === id)?.label ?? id}`;
});
