import { createTimeline } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const KICKOFF = Date.UTC(2026, 2, 2);
const at = (day) => KICKOFF + day * DAY;

const lanes = [
  { id: "design", label: "Design" },
  { id: "build", label: "Build" },
  { id: "ship", label: "Ship" },
];
const task = (id, label, laneId, from, days) => ({ id, label, laneId, start: at(from), end: at(from + days), className: `phase-${laneId}` });
/** @type {import("@temporeum/timeline-core").Item[]} */
const items = [
  task("research", "Research", "design", 0, 6),
  task("wireframes", "Wireframes", "design", 4, 7),
  task("visual", "Visual design", "design", 10, 8),
  task("api", "API", "build", 7, 12),
  task("client", "Client", "build", 12, 14),
  task("migration", "Data migration", "build", 20, 6),
  task("beta", "Beta", "ship", 24, 7),
  task("docs", "Docs", "ship", 26, 8),
  // A milestone is an instant: it has no end.
  { id: "launch", label: "Launch", laneId: "ship", start: at(35), granularity: "day", className: "phase-ship" },
];

const undo = [];
const redo = [];
const status = document.querySelector("#status");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  theme: "light",
  ariaLabel: "Project plan",
  domain: [at(-3), at(40)],
  decorations: [
    { kind: "banding" },
    { kind: "marker", id: "kickoff", time: KICKOFF, label: "Kickoff" },
    { kind: "era", id: "freeze", start: at(31), end: at(35), label: "Code freeze" },
  ],
  editing: {
    enabled: true,
    snapMs: DAY,
    crossLane: true,
    // The host's rule, asked before every move: nothing starts before kickoff.
    canMove: (item, next) => next.start === undefined || next.start >= KICKOFF,
  },
});

function refresh(message) {
  undoButton.disabled = undo.length === 0;
  redoButton.disabled = redo.length === 0;
  if (message) status.textContent = message;
}

// Every edit is one reversible command; its inverse is the undo.
timeline.on("command", ({ command }) => {
  undo.push(command);
  redo.length = 0;
  refresh(`${command.label ?? command.type} — ${String(undo.length)} step(s) to undo`);
});
undoButton.addEventListener("click", () => {
  const command = undo.pop();
  timeline.applyCommand(command.inverse);
  redo.push(command);
  refresh("Undone.");
});
redoButton.addEventListener("click", () => {
  const command = redo.pop();
  timeline.applyCommand(command);
  undo.push(command);
  refresh("Redone.");
});
