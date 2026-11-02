import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { Command, Item, Lane } from "@temporeum/timeline-core";

import { createTimeline, hasPlugin, registerPlugin } from "../src/index.js";
import type { Timeline, TimelineConfig } from "../src/index.js";
import { groupsPlugin } from "../src/groups.js";
import { itemsPlugin } from "../src/items.js";
import { toolsPlugin } from "../src/tools.js";

/**
 * The tools, groups, items and intl plugins through the live instance, in a
 * real Chromium, on a page that starts with no plugin registered: a plain
 * timeline draws, pans, edits and takes live changes without any of the four; an option, a change or
 * a command that needs one throws — naming the import — and leaves the
 * instance as it was; registered, the same calls work.
 *
 * The registry is the page's, and this file's page starts with none: the
 * order of the tests below is the order of a page's life.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const lanes: Lane[] = [
  { id: "a", label: "Ann" },
  { id: "b", label: "Bob" },
];
const items: Item[] = [
  { id: "one", label: "One", start: T0 + DAY, end: T0 + 3 * DAY, laneId: "a" },
  { id: "two", label: "Two", start: T0 + 4 * DAY, end: T0 + 6 * DAY, laneId: "b" },
];

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(config: Partial<TimelineConfig> = {}): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = "width:900px;height:300px;position:relative";
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + 8 * DAY], height: 300, timeZone: "UTC", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [role=option]") === null) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const options = (element: Element): string[] => [...element.querySelectorAll("svg [role=option]")].map((node) => node.getAttribute("data-tl-id") ?? "");

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof TypeError ? error.message : `not a TypeError: ${String(error)}`;
  }
  return "nothing thrown";
}

describe("a page with none of the four plugins", () => {
  it("draws, edits and takes live changes with none of them", async () => {
    for (const name of ["tools", "groups", "items", "intl"] as const) expect(hasPlugin(name)).toBe(false);
    const { element, timeline } = await mount({ editing: { enabled: true } });
    expect(options(element).sort()).toEqual(["one", "two"]);
    // No layer of the tools' or the tree's.
    expect(element.querySelector(".tl-tools")).toBeNull();
    expect(element.querySelector(".tl-groups")).toBeNull();
    // `n` and Delete mean nothing without the items plugin: no add, no removal.
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("n");
    await userEvent.keyboard("{Delete}");
    timeline.flush();
    expect(options(element).sort()).toEqual(["one", "two"]);
    // Live data is the base's.
    timeline.addItems([{ id: "three", label: "Three", start: T0 + 2 * DAY, end: T0 + 5 * DAY, laneId: "a" }]);
    timeline.flush();
    expect(options(element).sort()).toEqual(["one", "three", "two"]);
    // A plain move command is the base's too.
    const move: Command = {
      type: "move",
      before: [{ id: "one", start: T0 + DAY, end: T0 + 3 * DAY }],
      after: [{ id: "one", start: T0 + 2 * DAY, end: T0 + 4 * DAY }],
    } as unknown as Command;
    timeline.applyCommand(move);
    expect(timeline.items.find((item) => item.id === "one")?.start).toBe(T0 + 2 * DAY);
    timeline.destroy();
  });

  it("an option that needs a plugin throws where the timeline is created, naming the import", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    expect(thrown(() => createTimeline(element, { items, tooltip: true }))).toContain('import { toolsPlugin } from "@temporeum/timeline-element/tools"');
    expect(thrown(() => createTimeline(element, { items, groups: [{ id: "a", label: "Ann" }] }))).toContain('import { groupsPlugin } from "@temporeum/timeline-element/groups"');
    expect(thrown(() => createTimeline(element, { items: [{ id: "p", start: T0, kind: "point" }] }))).toContain('An item of kind "point" needs the items plugin');
    expect(thrown(() => createTimeline(element, { items, editing: { enabled: true, add: true } }))).toContain("The editing.add option needs the items plugin");
    expect(thrown(() => createTimeline(element, { items, strings: { newItem: "Új" } }))).toContain('import { intlPlugin } from "@temporeum/timeline-element/intl"');
    // Nothing was mounted by the calls that threw.
    expect(element.childElementCount).toBe(0);
  });

  it("an update, a live change or a command that needs one throws, and the instance is as it was", async () => {
    const { element, timeline } = await mount();
    expect(thrown(() => timeline.update({ minimap: true }))).toContain("The minimap option needs the tools plugin");
    expect(thrown(() => timeline.update({ direction: "rtl" }))).toContain('The direction "rtl" option needs the intl plugin');
    expect(thrown(() => timeline.setItems([{ id: "b", start: T0, end: T0 + DAY, kind: "box" }]))).toContain('An item of kind "box" needs the items plugin');
    expect(thrown(() => timeline.addItems([{ id: "bg", start: T0, end: T0 + DAY, kind: "background" }]))).toContain('An item of kind "background"');
    const add = {
      type: "add",
      before: [{ id: "new", item: null }],
      after: [{ id: "new", item: { id: "new", start: T0, end: T0 + DAY, laneId: "a" } }],
    } as unknown as Command;
    expect(thrown(() => timeline.applyCommand(add))).toContain("A command that adds or removes items needs the items plugin");
    timeline.flush();
    // Still the same timeline: no strip, not mirrored, the same items.
    expect(element.querySelector(".tl-layer--minimap")).toBeNull();
    expect(element.querySelector("svg")?.getAttribute("dir")).toBeNull();
    expect(options(element).sort()).toEqual(["one", "two"]);
    timeline.destroy();
  });
});

describe("registered, the same calls work", () => {
  it("adds from the keyboard, applies an add command, shows the tools and the tree", async () => {
    registerPlugin(itemsPlugin, toolsPlugin, groupsPlugin);
    const { element, timeline } = await mount({ editing: { enabled: true, add: true }, tooltip: true, minimap: true });
    expect(element.querySelector(".tl-tools")).not.toBeNull();
    expect(element.querySelector(".tl-layer--minimap")).not.toBeNull();
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("n");
    timeline.flush();
    expect(options(element)).toHaveLength(3);
    const add = {
      type: "add",
      before: [{ id: "new", item: null }],
      after: [{ id: "new", item: { id: "new", start: T0 + DAY, end: T0 + 2 * DAY, laneId: "b" } }],
    } as unknown as Command;
    timeline.applyCommand(add);
    timeline.flush();
    expect(options(element)).toContain("new");
    timeline.update({ groups: [{ id: "a", label: "Ann" }, { id: "b", label: "Bob" }] });
    timeline.flush();
    expect(element.querySelector(".tl-groups [role=tree], .tl-groups[role=tree]")).not.toBeNull();
    timeline.destroy();
  });
});
