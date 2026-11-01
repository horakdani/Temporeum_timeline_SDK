import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The teams' names, held at the start of the view, are one of the time tools.
registerPlugin(toolsPlugin);

const day = 86_400_000;
const week = 7 * day;
const quarter = (y, q) => Date.UTC(y, (q - 1) * 3, 1);
const TODAY = Date.UTC(2026, 4, 18);

// A made-up product's year: what shipped, what is in flight, what is planned.
const plan = [
  ["sso", "Single sign-on", "platform", [2026, 1], 9, "done"],
  ["audit", "Audit log", "platform", [2026, 2], 10, "now"],
  ["regions", "EU data region", "platform", [2026, 3], 14, "later"],
  ["billing", "Usage-based billing", "platform", [2026, 4], 11, "later"],
  ["onboarding", "New onboarding", "product", [2026, 1], 6, "done"],
  ["search", "Search everywhere", "product", [2026, 2], 8, "now"],
  ["offline", "Offline mode", "product", [2026, 3], 13, "later"],
  ["templates", "Templates gallery", "product", [2026, 4], 7, "later"],
  ["ios", "iOS app", "mobile", [2026, 1], 12, "done"],
  ["android", "Android app", "mobile", [2026, 2], 12, "now"],
  ["widgets", "Home-screen widgets", "mobile", [2026, 4], 6, "later"],
  ["partners", "Partner API", "growth", [2026, 2], 9, "now"],
  ["pricing", "New pricing page", "growth", [2026, 3], 4, "later"],
  ["referrals", "Referrals", "growth", [2026, 3], 8, "later"],
  ["conference", "User conference", "growth", [2026, 4], 1, "later"],
];
const items = plan.map(([id, label, laneId, [y, q], weeks, status]) => ({
  id,
  label,
  laneId,
  start: quarter(y, q) + week,
  end: quarter(y, q) + week + weeks * week,
  className: `status-${status}`,
}));

/** @type {import("@temporeum/timeline-core").Decoration[]} */
const decorations = [{ kind: "now", time: TODAY, label: "Today" }];
for (let q = 1; q <= 4; q += 1) decorations.push({ kind: "era", id: `q${String(q)}`, start: quarter(2026, q), end: q === 4 ? quarter(2027, 1) : quarter(2026, q + 1), label: `Q${String(q)}` });

// On a phone the tour goes under the roadmap, and the container's width turns the roadmap vertical.
const narrow = matchMedia("(max-width: 640px)").matches;
if (narrow) document.querySelector("#wrap").classList.add("narrow");

const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  lanes: [
    { id: "platform", label: "Platform" },
    { id: "product", label: "Product" },
    { id: "mobile", label: "Mobile" },
    { id: "growth", label: "Growth" },
  ],
  ariaLabel: "Product roadmap 2026",
  // Rows of teams on a desktop; on a phone the container decides, and it is narrow.
  orientation: narrow ? "auto" : "horizontal",
  laneHeaders: true,
  locale: "en-GB",
  // Room before January for the teams' names, which sit at the start of the view.
  domain: [quarter(2026, 1) - 7 * week, quarter(2027, 1) + 2 * week],
  editing: { enabled: true, crossLane: true, snapMs: week, snapOrigin: quarter(2026, 1), minDurationMs: week },
  decorations,
});

// The tour: each step is ticked by what the timeline reports, not by which key was pressed.
const said = document.querySelector("#said");
function done(step, message) {
  const li = document.querySelector(`[data-step="${step}"]`);
  if (li.hasAttribute("data-done")) return;
  li.setAttribute("data-done", "");
  said.textContent = message;
}
element.addEventListener("focusin", () => done("focus", "The roadmap has focus: a screen reader hears its name and how many items it holds."));
const walked = new Set();
timeline.subscribe(() => {
  const id = timeline.getSnapshot().focusedId;
  if (id === null) return;
  walked.add(id);
  if (walked.size >= 3) done("walk", "Every item is reachable by key, in time order and across the rows.");
});

const undo = [];
timeline.on("command", ({ command }) => {
  undo.push(command);
  const lane = command.after.some((patch, i) => patch.laneId !== undefined && patch.laneId !== command.before[i]?.laneId);
  if (lane) done("lane", "Moved to another team: the same command a drag across the rows makes.");
  else if (command.type.startsWith("resize")) done("resize", "Longer by a week: Shift + Alt + → would move its start instead.");
  else if (command.type === "move") done("move", "One key press is one command — and so one undo step.");
});
addEventListener("keydown", (event) => {
  if (event.key !== "u" || event.ctrlKey || event.metaKey || event.altKey) return;
  const command = undo.pop();
  if (command === undefined) return;
  timeline.applyCommand(command.inverse);
  if (undo.length === 0) done("undo", "Back where it started: every edit was undone by its inverse.");
  else said.textContent = `Undone. ${String(undo.length)} more to go.`;
});
