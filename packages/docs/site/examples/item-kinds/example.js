import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

// Boxes, points and backgrounds are a plugin: registered once, before the first timeline.
registerPlugin(itemsPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 4, 4);

createTimeline(document.querySelector("#timeline"), {
  ariaLabel: "Release with milestones",
  domain: [start - day, start + 22 * day],
  items: [
    { id: "sprint", kind: "background", start: start, end: start + 14 * day, label: "Sprint 1" },
    { id: "build", start: start + day, end: start + 9 * day, label: "Build" },
    { id: "review", kind: "box", start: start + 11 * day, label: "Review" },
    { id: "freeze", kind: "point", start: start + 13 * day, label: "Code freeze" },
    { id: "launch", kind: "point", start: start + 18 * day, label: "Launch" },
  ],
});
