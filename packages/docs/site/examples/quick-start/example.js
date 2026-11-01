import { createTimeline } from "@temporeum/timeline-element";

const items = [
  { id: "design", start: new Date("2026-03-02"), end: new Date("2026-03-09"), label: "Design", laneId: "work" },
  { id: "build", start: new Date("2026-03-06"), end: new Date("2026-03-20"), label: "Build", laneId: "work" },
  { id: "review", start: new Date("2026-03-23"), label: "Review", laneId: "ship" },
  { id: "launch", start: new Date("2026-03-27"), end: new Date("2026-04-03"), label: "Launch", laneId: "ship" },
  { id: "retro", start: new Date("2026-04-06"), label: "Retro", laneId: "work" },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

const log = document.querySelector("#log");
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: 86_400_000 },
});

// The library never saves: an edit comes out as a command, and it is yours.
timeline.on("itemMoved", ({ item, to }) => {
  log.textContent = `${item.label} now starts ${new Date(to.start ?? item.start).toDateString()}`;
});
