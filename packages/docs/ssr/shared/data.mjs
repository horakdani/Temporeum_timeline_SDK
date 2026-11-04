// The shared data of the five smoke apps: the same timeline in Next,
// Nuxt, Astro, SvelteKit and Angular, so the measurement asks each of them
// the same thing.
import { registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin } from "@temporeum/timeline-element/gantt";
import { groupsPlugin } from "@temporeum/timeline-element/groups";
import { intlPlugin } from "@temporeum/timeline-element/intl";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { resourcesPlugin } from "@temporeum/timeline-element/resources";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The Gantt and the resource view are plugins, and so are the group tree,
// the item kinds, the time tools and the dictionary: they are registered
// next to the data, so the server and the client draw with the same set,
// wherever the config is imported.
registerPlugin(ganttPlugin, resourcesPlugin, groupsPlugin, itemsPlugin, toolsPlugin, intlPlugin);

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

// With a group tree, a point item and a background item: by the ssr check's proof,
// the client takes over the group headers drawn on the server too. (The HTML
// template is a function and does not travel with the JSON config; the Next
// path measures it, where the React component gets the same function on the
// server and on the client.)
export const config = {
  items: [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, label: "Planning", laneId: "l1", progress: 1 },
    { id: "b", start: START + 8 * DAY, end: START + 13 * DAY, label: "Building", laneId: "l1", progress: 0.4, baseline: { start: START + 7 * DAY, end: START + 11 * DAY } },
    { id: "c", start: START + 16 * DAY, end: START + 20 * DAY, label: "Handover", laneId: "l2" },
    { id: "d", kind: "point", start: START + 11 * DAY, label: "Milestone", laneId: "l2" },
    { id: "s", kind: "background", start: START + 1 * DAY, end: START + 9 * DAY, label: "Sprint 1" },
  ],
  groups: [
    { id: "proj", label: "Project" },
    { id: "l1", label: "Work", parentId: "proj" },
    { id: "l2", label: "Delivery", parentId: "proj" },
  ],
  // With Gantt arrows, progress and a baseline: by the ssr check's proof, the
  // client takes over the arrows drawn on the server too.
  gantt: {
    dependencies: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c", type: "SS", lagMs: DAY },
    ],
  },
  // With the resource view: the two group lanes are resources, each with a
  // load lane under it; "Work" has half capacity, so its two tasks are
  // overbooked. By the ssr check's proof, the client takes over the load drawn on
  // the server too, with the same frame.
  resources: [
    { id: "l1", label: "Work", capacity: 0.5 },
    { id: "l2", label: "Delivery" },
  ],
  // With hidden weekends, an overview strip and sticky lane headers: by the
  // the ssr check's proof, it hydrates with the same frame with these too. 3 January
  // 2026 is a Saturday; "Planning" spans the first weekend, and is drawn
  // without it.
  hiddenDates: [{ start: START + 2 * DAY, end: START + 4 * DAY, repeat: "weekly" }],
  minimap: true,
  laneHeaders: true,
  // Right to left, with the library's words in Hungarian: by the ssr check's proof,
  // it hydrates with the same frame in RTL and in another language too. The
  // dates are Intl's (hu); the dictionary below is deliberately not English —
  // it is the test data of that claim — and holds the words for names, the
  // Gantt and the load.
  direction: "rtl",
  strings: {
    listSeparator: ", ",
    FS: "befejezés–kezdés",
    SS: "kezdés–kezdés",
    dependency: "{name} ({type})",
    dependencyLag: "{name} ({type}, {amount} késleltetés)",
    days: "{count} nap",
    predecessors: "{list} után",
    successors: "{list} előtt",
    onPlan: "a terv szerint",
    behindPlan: "{count} nap csúszás",
    aheadOfPlan: "{count} nappal a terv előtt",
    progress: "{percent}% kész",
    overbooked: "túlfoglalt, a kapacitás {percent}%-a",
    loadLane: "{lane} terhelése",
    groups: "Csoportok",
    overview: "Áttekintés",
  },
  domain: [START, START + 24 * DAY],
  height: 300,
  locale: "hu",
  timeZone: "UTC",
  ariaLabel: "Project timeline",
};

/** The width the pages are laid out at, so the server draws the real size. */
export const WIDTH = 960;

/** The items' HTML template — the Next path hydrates it (a function, it does not travel with JSON). */
export const template = (item) => `<strong>${item.label ?? ""}</strong>`;
