import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { defaultTaskColumns, ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";
import { resourcesPlugin } from "@temporeum/timeline-element/resources";
import { addWorkingMs, scheduleCommand, scheduleTasks } from "@temporeum/timeline-core/schedule";

registerPlugin(ganttPlugin, resourcesPlugin);

const hour = 3_600_000;
const day = 24 * hour;
// Office hours, Monday to Friday: durations and lags below are working time.
const calendar = { timeZone: "UTC" };
const KICKOFF = Date.UTC(2026, 0, 5, 9);
const TODAY = Date.UTC(2026, 2, 16);

// A made-up launch, the same on every load: twelve streams of 25 tasks, a milestone closing each.
function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return Math.imul(x, 0xc2b2ae35) >>> 0;
}
const STREAMS = [
  ["research", "Research", ["Interviews", "Survey", "Competitor review", "Synthesis", "Personas"]],
  ["design", "Design", ["Wireframes", "Prototype", "Usability test", "Visual design", "Design review"]],
  ["backend", "Backend", ["Schema", "Auth endpoints", "Billing API", "Search index", "Rate limits"]],
  ["frontend", "Frontend", ["Routing", "Onboarding flow", "Settings", "Dashboard", "Empty states"]],
  ["mobile", "Mobile", ["iOS shell", "Android shell", "Offline sync", "Push", "Store assets"]],
  ["data", "Data", ["Event schema", "Pipelines", "Dashboards", "Backfill", "Data checks"]],
  ["infra", "Infrastructure", ["Clusters", "CI pipeline", "Monitoring", "Backups", "Load balancer"]],
  ["security", "Security", ["Threat model", "Pen test", "Secrets", "SSO", "Audit log"]],
  ["qa", "QA", ["Test plan", "Automation", "Regression", "Performance", "Accessibility"]],
  ["docs", "Docs", ["Guides", "API reference", "Tutorials", "Changelog", "Screenshots"]],
  ["marketing", "Marketing", ["Positioning", "Landing page", "Launch video", "Press kit", "Campaign"]],
  ["support", "Support", ["Help centre", "Macros", "Training", "Status page", "On-call"]],
];
const PEOPLE = ["Ada", "Ben", "Chen", "Dana", "Eli", "Fatima", "Goran", "Hana", "Ivo", "Jun"].map((label) => ({ id: label.toLowerCase(), label }));

/** @type {import("@temporeum/timeline-core").Item<any>[]} */
const items = [];
/** @type {import("@temporeum/timeline-core/schedule").Dependency[]} */
const dependencies = [];
STREAMS.forEach(([stream, streamLabel, names], s) => {
  for (let i = 0; i < 25; i += 1) {
    const h = hash(s * 100 + i);
    const id = `${stream}-${String(i + 1)}`;
    items.push({
      id,
      label: `${names[i % names.length]} ${String(Math.floor(i / names.length) + 1)}`,
      laneId: id,
      start: KICKOFF,
      end: addWorkingMs(calendar, KICKOFF, (2 + (h % 7)) * 8 * hour),
      data: { stream: streamLabel, owner: PEOPLE[(s + (h % 3)) % PEOPLE.length].id },
    });
    if (i > 0) {
      // Mostly finish-to-start; now and then a task starts with its predecessor, a day later.
      dependencies.push(h % 5 === 0 ? { from: `${stream}-${String(i)}`, to: id, type: "SS", lagMs: 8 * hour } : { from: `${stream}-${String(i)}`, to: id });
    }
    // Every sixth task waits for the stream before it.
    if (s > 0 && i % 6 === 3) dependencies.push({ from: `${STREAMS[s - 1][0]}-${String(i)}`, to: id });
  }
  items.push({ id: `${stream}-done`, label: `${streamLabel} done`, laneId: `${stream}-done`, start: KICKOFF, kind: "milestone", data: { stream: streamLabel } });
  dependencies.push({ from: `${stream}-25`, to: `${stream}-done` });
  dependencies.push({ from: `${stream}-done`, to: "launch" });
});
items.push({ id: "launch", label: "Launch", laneId: "launch", start: KICKOFF, kind: "milestone", data: { stream: "Launch" } });
const lanes = items.map(({ id, label }) => ({ id, label }));

// The first schedule is the plan: it becomes every task's baseline, and the progress is measured against today.
const plan = scheduleTasks(items, dependencies, { calendar });
const planned = items.map((item) => {
  const task = plan.tasks.get(item.id);
  const placed = { ...item, start: task.start, ...(task.end === undefined ? {} : { end: task.end }) };
  if (item.kind === "milestone") return placed;
  const progress = Math.min(1, Math.max(0, (TODAY - task.start) / (task.end - task.start)));
  return { ...placed, baseline: { start: task.start, end: task.end }, progress: Math.round(progress * 10) / 10 };
});

const narrow = matchMedia("(max-width: 640px)").matches;
const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items: planned,
  lanes,
  gantt: { dependencies },
  editing: { enabled: true, snapMs: day },
  // Beside the table the lanes stay rows; on a phone there is no table, and the container decides.
  orientation: narrow ? "auto" : "horizontal",
  density: "compact",
  ariaLabel: "Launch plan, 313 tasks",
  locale: "en-GB",
  domain: [KICKOFF - 3 * day, KICKOFF + 75 * day],
  decorations: [{ kind: "banding" }, { kind: "now", time: TODAY, label: "Today" }],
});

if (narrow) document.querySelector("#plan").classList.add("narrow");
else {
  const stream = { id: "stream", header: "Stream", width: 100, value: (row) => row.items[0]?.data?.stream ?? "" };
  const [name, start] = defaultTaskColumns({ locale: "en-GB" });
  mountTaskGrid(document.querySelector("#grid"), timeline, { columns: [stream, name, start], ariaLabel: "Launch tasks", focusTarget: element });
}

// The critical path, worked out again after every edit: red bars have no slack.
const status = document.querySelector("#status");
const finish = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
let critical = new Set();
function markCritical() {
  const result = scheduleTasks(timeline.items, dependencies, { calendar });
  const next = new Set(result.critical);
  const changed = timeline.items.filter((item) => next.has(item.id) !== critical.has(item.id));
  critical = next;
  if (changed.length > 0) timeline.updateItems(changed.map((item) => ({ id: item.id, className: critical.has(item.id) ? "critical" : undefined })));
  const late = timeline.items.filter((item) => item.kind !== "milestone" && result.tasks.get(item.id)?.moved).length;
  status.dataset.tasks = String(timeline.items.length);
  status.textContent = `${String(timeline.items.length)} tasks · launch ${finish.format(result.finish)} · ${String(critical.size)} critical${late > 0 ? ` · ${String(late)} out of order` : ""}`;
  return result;
}

// Undo and redo: every edit, and every reschedule, is one command with an exact inverse.
const undo = [];
const redo = [];
const buttons = { undo: document.querySelector("#undo"), redo: document.querySelector("#redo") };
function refresh() {
  buttons.undo.disabled = undo.length === 0;
  buttons.redo.disabled = redo.length === 0;
  markCritical();
}
timeline.on("command", ({ command }) => {
  undo.push(command);
  redo.length = 0;
  refresh();
});
function step(from, to, apply) {
  const command = from.pop();
  if (command === undefined) return;
  timeline.applyCommand(apply(command));
  to.push(command);
  refresh();
}
buttons.undo.addEventListener("click", () => step(undo, redo, (command) => command.inverse));
buttons.redo.addEventListener("click", () => step(redo, undo, (command) => command));
addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  if (event.shiftKey) step(redo, undo, (command) => command);
  else step(undo, redo, (command) => command.inverse);
});

// The scheduler computes; one command applies it, and Undo takes it back.
document.querySelector("#schedule").addEventListener("click", () => {
  const command = scheduleCommand(timeline.items, scheduleTasks(timeline.items, dependencies, { calendar }), "Reschedule");
  if (command === undefined) return;
  timeline.applyCommand(command);
  undo.push(command);
  redo.length = 0;
  refresh();
});

// The same tasks by owner: the resource view, drawn on demand.
const team = document.querySelector("#team");
const load = document.querySelector("#load");
let loadView;
const byOwner = () => timeline.items.filter((item) => item.kind !== "milestone").map((item) => ({ ...item, laneId: item.data.owner, className: undefined }));
team.addEventListener("click", () => {
  const show = team.getAttribute("aria-pressed") !== "true";
  team.setAttribute("aria-pressed", String(show));
  load.hidden = !show;
  if (show && loadView === undefined) {
    loadView = createTimeline(load, { items: byOwner(), resources: PEOPLE, orientation: "horizontal", density: "compact", ariaLabel: "Team load", locale: "en-GB", domain: timeline.getSnapshot().domain });
  } else if (show) loadView.setItems(byOwner());
});
timeline.on("itemsChanged", () => {
  if (loadView !== undefined && !load.hidden) loadView.setItems(byOwner());
});

refresh();
// Open on the critical path: once the first layout is there, the first red bar's row comes into view.
const first = plan.critical.find((id) => !id.endsWith("-done"));
const stop = timeline.on("layoutChanged", () => {
  stop();
  if (first === undefined) return;
  // From the bottom, revealing a row scrolls up just far enough: the row lands at the top.
  timeline.scrollLanes(Number.MAX_SAFE_INTEGER);
  timeline.revealLane(first);
  timeline.scrollTo(plan.tasks.get(first).start + 30 * day);
});
