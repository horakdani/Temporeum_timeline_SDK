import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { mountTaskGrid } from "@temporeum/timeline-element/gantt";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { mountBacklog, resourcesPlugin } from "@temporeum/timeline-element/resources";

// The resource view is a plugin: registered once, before the first timeline.
// Dropping an unscheduled task onto it is the items plugin's.
registerPlugin(resourcesPlugin, itemsPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 3, 6);
const at = (offset) => start + offset * day;

// The people are the lanes. Dana works half time: a capacity of 0.5.
const resources = [
  { id: "ana", label: "Ana" },
  { id: "ben", label: "Ben" },
  { id: "dana", label: "Dana", capacity: 0.5 },
  { id: "lab", label: "Test lab", capacity: 2 },
];

// The work assigned to them. Ben has two things at once in the second week.
const items = [
  { id: "spec", label: "Spec", start: at(0), end: at(4), laneId: "ana" },
  { id: "design", label: "Design", start: at(4), end: at(11), laneId: "ana" },
  { id: "api", label: "API", start: at(1), end: at(10), laneId: "ben" },
  { id: "auth", label: "Auth", start: at(7), end: at(12), laneId: "ben" },
  { id: "docs", label: "Docs", start: at(3), end: at(13), laneId: "dana", data: { units: 0.5 } },
  { id: "smoke", label: "Smoke tests", start: at(9), end: at(14), laneId: "lab" },
];

// Not on the timeline yet.
const tasks = [
  { id: "ui", label: "UI", durationMs: 6 * day },
  { id: "load", label: "Load tests", durationMs: 3 * day },
  { id: "release", label: "Release notes", durationMs: 2 * day, data: { units: 0.5 } },
];

const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  resources,
  // How much of a person a task takes: all of them, unless it says.
  resourceOptions: { unitsOf: (item) => item.data?.units ?? 1 },
  editing: { enabled: true, crossLane: true, drop: true, snapMs: day },
  orientation: "horizontal",
  ariaLabel: "Team plan",
  domain: [at(-1), at(16)],
});

// Who each row is: a column of names, on the lanes' lines — the load row is "Ben load".
const names = [{ id: "name", header: "Resource", value: (row) => row.lane.label ?? "" }];
mountTaskGrid(document.querySelector("#people"), timeline, { columns: names, label: "Resources", focusTarget: element });

// The tasks still to place, beside it.
mountBacklog(document.querySelector("#backlog"), timeline, { tasks, label: "Unscheduled tasks", focusTarget: element });

// Every edit is one command; the host keeps them for undo.
const undo = [];
const button = document.querySelector("#undo");
const log = document.querySelector("#log");
timeline.on("command", ({ command }) => {
  undo.push(command);
  button.disabled = false;
  log.textContent = `${command.type === "add" ? "Placed" : "Moved"} ${command.after.map((patch) => patch.id).join(", ")}.`;
});
button.addEventListener("click", () => {
  const command = undo.pop();
  if (command === undefined) return;
  timeline.applyCommand(command.inverse);
  button.disabled = undo.length === 0;
  log.textContent = "Undone.";
});
