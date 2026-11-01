import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { groupsPlugin } from "@temporeum/timeline-element/groups";

// Nested groups are a plugin: registered once, before the first timeline.
registerPlugin(groupsPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 2, 2);
const groups = [
  { id: "web", label: "Web team" },
  { id: "ann", label: "Ann", parentId: "web" },
  { id: "bob", label: "Bob", parentId: "web" },
  { id: "ops", label: "Operations" },
  { id: "eve", label: "Eve", parentId: "ops" },
];
const items = [
  { id: "a1", start: start, end: start + 6 * day, label: "Design", laneId: "ann" },
  { id: "a2", start: start + 8 * day, end: start + 15 * day, label: "Build", laneId: "ann" },
  { id: "b1", start: start + 3 * day, end: start + 12 * day, label: "API", laneId: "bob" },
  { id: "e1", start: start + 5 * day, end: start + 9 * day, label: "Servers", laneId: "eve" },
  { id: "e2", start: start + 13 * day, label: "Go-live", laneId: "eve" },
];

const log = document.querySelector("#log");
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  groups,
  ariaLabel: "Team plan",
  domain: [start - day, start + 18 * day],
});

// Collapsing is view state; a reorder is a command with an inverse.
timeline.on("groupToggle", ({ group, collapsed }) => {
  log.textContent = `${group.label} ${collapsed ? "collapsed" : "expanded"}`;
});
timeline.on("groupCommand", ({ command }) => {
  log.textContent = `Moved ${command.after[0].id} — undo with timeline.applyCommand(command.inverse)`;
});
