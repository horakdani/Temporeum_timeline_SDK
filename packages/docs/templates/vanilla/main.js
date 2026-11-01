import { createTimeline } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);
const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
  { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY },
  { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: DAY },
});

const undo = [];
const button = document.querySelector("#undo");
timeline.on("command", ({ command }) => {
  undo.push(command);
  button.disabled = false;
});
button.addEventListener("click", () => {
  timeline.applyCommand(undo.pop().inverse);
  button.disabled = undo.length === 0;
});
