import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item, Lane } from "@temporeum/timeline-core";
import type { Group } from "@temporeum/timeline-core/groups";
import { loadLaneId } from "@temporeum/timeline-core/resources";
import type { BacklogTask, Resource } from "@temporeum/timeline-core/resources";

import { createTimeline, registerPlugin } from "../src/index.js";
import { ganttPlugin } from "../src/gantt.js";
import { groupsPlugin } from "../src/groups.js";
import { itemsPlugin } from "../src/items.js";
import { backlogCss, describeBacklogTask, mountBacklog, resourcesPlugin } from "../src/resources.js";
import type { TemporeumTimelineElement, Timeline, TimelineConfig } from "../src/index.js";
import "../src/define.js";

// The parts on entry points of their own (P29, P30), as a page registers them.
registerPlugin(ganttPlugin, resourcesPlugin, groupsPlugin, itemsPlugin);

/**
 * P22 through the live instance, in a real Chromium: the resource view's
 * load lanes and layer, a move between resources by a key, the instance's
 * `dropItemAt`, `items` and `itemsChanged`, and the backlog beside it — its
 * keys, its pointer drag, its list following the items.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);
const domain: [number, number] = [T0, T0 + 20 * DAY];

const resources: Resource[] = [
  { id: "ana", label: "Ana" },
  { id: "ben", label: "Ben" },
  { id: "dana", label: "Dana", capacity: 0.5 },
];
const items: Item[] = [
  { id: "spec", label: "Spec", start: T0 + DAY, end: T0 + 5 * DAY, laneId: "ana" },
  { id: "api", label: "API", start: T0 + 2 * DAY, end: T0 + 9 * DAY, laneId: "ben" },
  { id: "auth", label: "Auth", start: T0 + 6 * DAY, end: T0 + 12 * DAY, laneId: "ben" },
  { id: "docs", label: "Docs", start: T0 + 3 * DAY, end: T0 + 8 * DAY, laneId: "dana", data: { units: 0.5 } },
];
const tasks: BacklogTask[] = [
  { id: "ui", label: "UI", durationMs: 6 * DAY },
  { id: "load", label: "Load tests", durationMs: 4 * HOUR },
  { id: "notes", durationMs: 30 * 60_000 },
  { id: "plain", label: "Plain" },
];

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(config: Partial<TimelineConfig> = {}, width = 900, height = 360): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:${String(height)}px;position:relative`;
  document.body.append(element);
  const timeline = createTimeline(element, {
    items,
    resources,
    domain,
    height,
    orientation: "horizontal",
    resourceOptions: { unitsOf: (item) => (item.data as { units?: number } | undefined)?.units ?? 1 },
    editing: { enabled: true, crossLane: true, drop: true, snapMs: DAY },
    ...config,
  });
  await vi.waitFor(() => {
    if (timeline.result === undefined) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const laneBox = (root: ParentNode, id: string): DOMRect => {
  const rect = [...root.querySelectorAll("rect[data-tl-lane]")].find((node) => node.getAttribute("data-tl-lane") === id);
  if (rect === undefined) throw new Error(`no lane ${id}`);
  return rect.getBoundingClientRect();
};
const laneIds = (timeline: Timeline): string[] => timeline.result?.layout.lanes.map((lane) => lane.lane.id) ?? [];

describe("the resource view", () => {
  it("puts a load lane under each resource, the load in a layer under the arrows and the items, and marks the overbooked", async () => {
    const { element, timeline } = await mount({ gantt: { dependencies: [{ from: "spec", to: "api" }] } });
    expect(laneIds(timeline)).toEqual(["ana", loadLaneId("ana"), "ben", loadLaneId("ben"), "dana", loadLaneId("dana")]);
    const layers = [...element.querySelectorAll("svg > g.tl-layer")].map((layer) => layer.getAttribute("class"));
    const items = layers.indexOf("tl-layer tl-layer--items");
    expect(layers.indexOf("tl-layer tl-layer--deps")).toBe(items - 1);
    expect(layers.indexOf("tl-layer tl-layer--load")).toBe(items - 2);
    expect(element.querySelectorAll(".tl-layer--load path.tl-load--over").length).toBe(1);
    expect(element.querySelectorAll(".tl-layer--load path.tl-overload").length).toBe(1);
    const overbooked = [...element.querySelectorAll(".tl-item--overbooked")].map((node) => node.getAttribute("data-tl-id"));
    expect(overbooked.sort()).toEqual(["api", "auth"]);
    // Dana's half-time task fills her half capacity: not over.
    expect(overbooked).not.toContain("docs");
    expect(timeline.exportSvg()).toContain("tl-layer--load");
    timeline.destroy();
  });

  it("without a histogram keeps the bands and the marks; with lanes or groups, the resources say which are theirs; cull: false draws all time", async () => {
    const { element, timeline } = await mount({ resourceOptions: { histogram: false } });
    expect(laneIds(timeline)).toEqual(["ana", "ben", "dana"]);
    expect(element.querySelectorAll(".tl-layer--load path.tl-overload").length).toBe(1);
    expect(element.querySelectorAll(".tl-layer--load path.tl-load").length).toBe(0);
    const lanes: Lane[] = [{ id: "ben", label: "Ben" }, { id: "room" }];
    timeline.update({ lanes, resourceOptions: { loadSize: 30 } });
    timeline.flush();
    // Given lanes, the resources are those: Ana's and Dana's work has no row
    // of its own, and is drawn in the default lane after them (E2), without
    // a load lane.
    expect(laneIds(timeline)).toEqual(["ben", loadLaneId("ben"), "room", ""]);
    expect(timeline.result?.layout.lanes[1]?.crossSize).toBe(30);
    // The same configuration again: the same lanes array, the same layout.
    const layout = timeline.result?.layout;
    timeline.update({ ariaLabel: "Team" });
    timeline.flush();
    expect(timeline.result?.layout).toBe(layout);
    const groups: Group[] = [{ id: "team", label: "Team" }, { id: "ana", label: "Ana", parentId: "team" }, { id: "ben", label: "Ben", parentId: "team" }];
    timeline.update({ lanes: undefined, groups, resourceOptions: { cull: false } });
    timeline.flush();
    expect(laneIds(timeline)).toContain(loadLaneId("ana"));
    expect(laneIds(timeline).indexOf(loadLaneId("ben"))).toBe(laneIds(timeline).indexOf("ben") + 1);
    timeline.update({ resources: undefined, groups: undefined });
    timeline.flush();
    expect(element.querySelector(".tl-layer--load")).toBeNull();
    timeline.destroy();
  });

  it("moves work to the next resource with Alt and an arrow, over the load lane, as one move command", async () => {
    const { element, timeline } = await mount();
    const commands: { type: string; after: readonly { id: string; laneId?: string | null }[] }[] = [];
    timeline.on("command", ({ command }) => commands.push(command));
    const svg = element.querySelector("svg");
    svg?.focus();
    expect(timeline.focusItem("spec")).toBe(true);
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    timeline.flush();
    expect(commands.at(-1)?.type).toBe("move");
    expect(commands.at(-1)?.after).toEqual([expect.objectContaining({ id: "spec", laneId: "ben" })]);
    expect(timeline.items.find((item) => item.id === "spec")?.laneId).toBe("ben");
    timeline.destroy();
  });

  it("dropItemAt adds where the pointer is — a load lane counting as its resource — and nothing outside or when dropping is off; items and itemsChanged follow", async () => {
    const { element, timeline } = await mount();
    const seen: number[] = [];
    timeline.on("itemsChanged", ({ items: now }) => seen.push(now.length));
    const box = element.getBoundingClientRect();
    expect(timeline.dropItemAt({ id: "x", durationMs: DAY }, { clientX: box.left - 5, clientY: box.top + 50 })).toBe(false);
    expect(timeline.dropItemAt({ id: "x", durationMs: DAY }, { clientX: box.left + 10, clientY: box.bottom + 5 })).toBe(false);
    const load = laneBox(element, loadLaneId("dana"));
    expect(timeline.dropItemAt({ id: "x", label: "X", durationMs: DAY }, { clientX: box.left + box.width / 2, clientY: load.top + load.height / 2 })).toBe(true);
    const placed = timeline.items.find((item) => item.id === "x");
    expect(placed?.laneId).toBe("dana");
    expect(Number(placed?.end) - Number(placed?.start)).toBe(DAY);
    expect(seen).toEqual([items.length + 1]);
    timeline.setItems(items);
    expect(seen.at(-1)).toBe(items.length);
    timeline.update({ editing: { enabled: true, drop: false } });
    expect(timeline.dropItemAt({ id: "y" }, { clientX: box.left + 100, clientY: load.top + 2 })).toBe(false);
    timeline.destroy();
  });

  it("the element takes the resources and their options as properties", async () => {
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.cssText = "display:block;width:800px;height:300px";
    // The plan's weeks in view: without a start and an end the element shows the month around today.
    element.setAttribute("start", String(domain[0]));
    element.setAttribute("end", String(domain[1]));
    document.body.append(element);
    element.items = items;
    element.resources = resources;
    element.resourceOptions = { histogram: false };
    expect(element.resources).toBe(resources);
    expect(element.resourceOptions).toEqual({ histogram: false });
    await vi.waitFor(() => {
      if (element.shadowRoot?.querySelector(".tl-layer--load path.tl-overload") === null) throw new Error("no load yet");
    });
    element.remove();
  });
});

describe("the backlog", () => {
  async function setup(config: Partial<TimelineConfig> = {}, options: Partial<Parameters<typeof mountBacklog>[2]> = {}) {
    const { element, timeline } = await mount(config);
    const box = document.createElement("div");
    box.style.cssText = "width:200px;height:300px";
    document.body.prepend(box);
    const backlog = mountBacklog(box, timeline, { tasks, focusTarget: element, ...options });
    const list = box.querySelector<HTMLElement>("[role=listbox]");
    if (list === null) throw new Error("no list");
    return { element, timeline, box, backlog, list };
  }
  const options = (list: HTMLElement): HTMLElement[] => [...list.querySelectorAll<HTMLElement>("[role=option]")];

  it("lists the tasks not on the timeline, named with their length, and says so when there are none", async () => {
    const { timeline, box, backlog, list } = await setup();
    expect(options(list).map((row) => row.textContent)).toEqual(["UI, 6 d", "Load tests, 4 h", "notes, 30 min", "Plain"]);
    expect(list.getAttribute("aria-label")).toBe("Unscheduled tasks");
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[0]?.id);
    expect(describeBacklogTask({ id: "t", durationMs: 90 * 60_000 })).toBe("t, 1.5 h");
    expect(describeBacklogTask({ id: "t", durationMs: 30 * HOUR })).toBe("t, 30 h");
    expect(backlogCss()).toContain(".tl-backlog-item");
    const empty = box.querySelector<HTMLElement>(".tl-backlog-empty");
    expect(empty?.hidden).toBe(true);
    // Placed elsewhere: the list follows the items.
    timeline.setItems([...items, { id: "ui", start: T0, end: T0 + DAY }, { id: "load", start: T0, end: T0 + DAY }, { id: "notes", start: T0 }, { id: "plain", start: T0 }]);
    expect(options(list)).toHaveLength(0);
    expect(empty?.hidden).toBe(false);
    expect(list.hasAttribute("aria-activedescendant")).toBe(false);
    expect(backlog.tasks).toEqual([]);
    backlog.update([{ id: "new", label: "New" }]);
    expect(options(list).map((row) => row.textContent)).toEqual(["New"]);
    backlog.destroy();
    backlog.destroy();
    expect(box.children).toHaveLength(0);
    timeline.destroy();
  });

  it("walks its rows with the keys, and Enter places the active one where the keyboard is, then hands the focus to the timeline", async () => {
    const { element, timeline, list, backlog } = await setup();
    const added: string[] = [];
    timeline.on("itemsAdded", ({ items }) => added.push(...items.map((item) => item.id)));
    timeline.focusItem("api");
    list.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[2]?.id);
    await userEvent.keyboard("{ArrowUp}{End}");
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[3]?.id);
    await userEvent.keyboard("{Home}{ArrowLeft}");
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[0]?.id);
    // A key with a modifier, and one the list does not use, are let through.
    await userEvent.keyboard("{Control>}{ArrowDown}{/Control}x");
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[0]?.id);
    await userEvent.keyboard("{Enter}");
    expect(added).toEqual(["ui"]);
    const ui = timeline.items.find((item) => item.id === "ui");
    expect(ui?.laneId).toBe("ben");
    expect(Number(ui?.end) - Number(ui?.start)).toBe(6 * DAY);
    expect(options(list).map((row) => row.dataset.tlTask)).toEqual(["load", "notes", "plain"]);
    expect(document.activeElement).toBe(element.querySelector("svg"));
    expect(timeline.items).toHaveLength(items.length + 1);
    // Space places the next one.
    list.focus();
    await userEvent.keyboard(" ");
    expect(added).toEqual(["ui", "load"]);
    backlog.destroy();
    timeline.destroy();
  });

  it("drags a row onto the timeline with the pointer; a release outside, a click and a cancel place nothing", async () => {
    const { element, timeline, list, backlog } = await setup();
    const row = (): DOMRect => (options(list)[0] as HTMLElement).getBoundingClientRect();
    const target = laneBox(element, "ana");
    const box = element.getBoundingClientRect();
    // A click: no drag, no place — the row becomes the active one.
    const second = (options(list)[1] as HTMLElement).getBoundingClientRect();
    await commands.mouse([
      { type: "move", x: second.left + 10, y: second.top + 10 },
      { type: "down" },
      { type: "up" },
    ]);
    expect(list.getAttribute("aria-activedescendant")).toBe(options(list)[1]?.id);
    expect(timeline.items).toHaveLength(items.length);
    // Released outside the timeline: nothing.
    await commands.mouse([
      { type: "move", x: row().left + 10, y: row().top + 10 },
      { type: "down" },
      { type: "move", x: row().left + 60, y: row().top + 12, steps: 4 },
      { type: "move", x: box.right + 40, y: row().top + 12, steps: 4 },
      { type: "up" },
    ]);
    expect(timeline.items).toHaveLength(items.length);
    expect(document.querySelector(".tl-backlog-ghost")).toBeNull();
    // Onto Ana's lane: placed there, at the time under the pointer.
    await commands.mouse([
      { type: "move", x: row().left + 10, y: row().top + 10 },
      { type: "down" },
      { type: "move", x: row().left + 60, y: row().top + 12, steps: 4 },
      { type: "move", x: box.left + box.width * 0.75, y: target.top + target.height / 2, steps: 8 },
    ]);
    expect(document.querySelector(".tl-backlog-ghost")).not.toBeNull();
    await commands.mouse([{ type: "up" }]);
    expect(document.querySelector(".tl-backlog-ghost")).toBeNull();
    const ui = timeline.items.find((item) => item.id === "ui");
    expect(ui?.laneId).toBe("ana");
    expect(options(list).map((each) => each.dataset.tlTask)).toEqual(["load", "notes", "plain"]);
    // A cancelled drag (the browser took the pointer) places nothing.
    const first = options(list)[0] as HTMLElement;
    const rect = first.getBoundingClientRect();
    // A press on the list but on no row, and a right press, start nothing.
    list.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 10 }));
    first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerId: 9 }));
    first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: rect.left + 5, clientY: rect.top + 5 }));
    // Another pointer's move is not this drag's.
    first.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 8, clientX: rect.left + 50, clientY: rect.top + 5 }));
    first.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
    first.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: box.left + 100, clientY: target.top + 5 }));
    expect(timeline.items.filter((item) => item.id === "load")).toEqual([]);
    backlog.destroy();
    timeline.destroy();
  });

  it("takes a theme, a description and an empty text of its own, and hands the focus into a custom element's shadow root", async () => {
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.cssText = "display:block;width:800px;height:300px";
    document.body.append(element);
    element.config = { items, resources, editing: { enabled: true, drop: true } };
    await vi.waitFor(() => {
      if (element.timeline?.result === undefined) throw new Error("not drawn yet");
    });
    const timeline = element.timeline as Timeline;
    const box = document.createElement("div");
    document.body.append(box);
    const dark = mountBacklog(box, timeline, { tasks, theme: "dark", label: "To do", empty: "All done", describe: (task) => `• ${task.id}`, focusTarget: element });
    const list = box.querySelector<HTMLElement>("[role=listbox]") as HTMLElement;
    expect(box.querySelector(".tl-backlog")?.getAttribute("data-tl-theme")).toBe("dark");
    expect(options(list)[0]?.textContent).toBe("• ui");
    expect(box.querySelector(".tl-backlog-empty")?.textContent).toBe("All done");
    list.focus();
    await userEvent.keyboard("{Enter}");
    expect(element.shadowRoot?.activeElement).toBe(element.shadowRoot?.querySelector("svg"));
    dark.destroy();
    const custom = mountBacklog(box, timeline, {
      tasks,
      theme: { name: "brand", tokens: { surface: "#000", surfaceAlt: "#111", text: "#fff", textMuted: "#ccc", line: "#333", lineStrong: "#555", itemFill: "#123", itemStroke: "#456", itemText: "#fff", accent: "#f80", now: "#f00", era: "#222", eraText: "#eee", marker: "#0f0", focus: "#0ff" } },
    });
    const themed = box.querySelector<HTMLElement>(".tl-backlog");
    expect(themed?.getAttribute("data-tl-theme")).toBe("custom");
    expect(themed?.style.cssText).toContain("--tl-b-surface");
    custom.destroy();
    element.remove();
  });
});
