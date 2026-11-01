import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The time tools are a plugin: registered once, before the first timeline.
registerPlugin(toolsPlugin);

const hour = 3_600_000;
const day = 24 * hour;
// Monday 2026-05-04, 00:00 UTC.
const monday = Date.UTC(2026, 4, 4);
const at = (days, hours = 0) => monday + days * day + hours * hour;

const lanes = [
  { id: "line-1", label: "Line 1" },
  { id: "line-2", label: "Line 2" },
  { id: "dock", label: "Dock" },
];

const items = [
  { id: "cut", label: "Cutting", start: at(0, 8), end: at(1, 12), laneId: "line-1" },
  { id: "weld", label: "Welding", start: at(1, 13), end: at(4, 11), laneId: "line-1" },
  { id: "paint", label: "Painting", start: at(2, 9), end: at(3, 16), laneId: "line-2" },
  { id: "pack", label: "Packing", start: at(4, 12), end: at(7, 15), laneId: "line-2" },
  { id: "ship", label: "Shipping", start: at(7, 9), end: at(8, 12), laneId: "dock" },
];

const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  lanes,
  domain: [at(0, 8), at(9, 17)],
  timeZone: "UTC",
  ariaLabel: "Plant schedule",
  // Working hours only: nights and weekends take no room on the axis.
  hiddenDates: [
    { start: at(0, 17), end: at(1, 8), repeat: "daily" },
    { start: at(-2), end: at(0, 8), repeat: "weekly" },
  ],
  // A line of the host's own, which the reader can move.
  timeBars: [{ id: "cutoff", time: at(3, 12), label: "Cut-off" }],
  timeBarOptions: { snapMs: hour },
  rangeSelect: { snapMs: hour, stepMs: 4 * hour },
  minimap: true,
  laneHeaders: true,
  zoomPresets: true,
  tooltip: true,
});

const log = document.querySelector("#log");
const format = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
timeline.on("timeBarMoved", ({ time }) => {
  log.textContent = `Cut-off moved to ${format.format(time)}.`;
});
timeline.on("rangeSelected", ({ start, end }) => {
  log.textContent = `Selected ${format.format(start)} – ${format.format(end)}.`;
});

// Live data: one more delivery, without reloading the others.
let deliveries = 0;
document.querySelector("#add").addEventListener("click", () => {
  deliveries += 1;
  const start = at(7 + deliveries, 9);
  timeline.addItems([{ id: `delivery-${String(deliveries)}`, label: `Delivery ${String(deliveries)}`, start, end: start + 5 * hour, laneId: "dock" }]);
  log.textContent = `Delivery ${String(deliveries)} added.`;
});
