import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { fromVis } from "@temporeum/timeline-core/vis-compat";

// vis-timeline draws every kind of item and lets the reader remove one:
// here those are the items plugin's. Groups, the time tools and right to
// left are plugins too (`/groups`, `/tools`, `/intl`) — register what the
// converted configuration uses.
registerPlugin(itemsPlugin);

// Data and options in vis-timeline's shape, as an existing app has them.
const visGroups = [
  { id: 1, content: "Design" },
  { id: 2, content: "Engineering" },
];
const visItems = [
  { id: 1, group: 1, content: "Research", start: "2026-03-02", end: "2026-03-09" },
  { id: 2, group: 1, content: "Mock-ups", start: "2026-03-06", end: "2026-03-16" },
  { id: 3, group: 2, content: "API", start: "2026-03-09", end: "2026-03-23" },
  { id: 4, group: 2, content: "Release", start: "2026-03-27", type: "point" },
];
const visOptions = { editable: true, stack: true, zoomMin: 7 * 86_400_000, orientation: "top" };

// The whole conversion. Date strings are read as vis-timeline reads them —
// "2026-03-02" is local midnight, not UTC — ids become strings, groups lanes.
const { config, warnings } = fromVis(visItems, visGroups, visOptions);

createTimeline(document.querySelector("#timeline"), {
  ...config,
  ariaLabel: "Project plan, converted from vis-timeline data",
});

// What did not carry over is named, not dropped: here the axis on top.
document.querySelector("#log").textContent = warnings.map((warning) => `${warning.option}: ${warning.message}`).join("\n");
