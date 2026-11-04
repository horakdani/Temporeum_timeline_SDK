import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { Command, Item } from "@temporeum/timeline-core";
import type { Group, GroupCommand } from "@temporeum/timeline-core/groups";

import { createTimeline, registerPlugin, renderTimelineHtml, renderTimelineSvg } from "../src/index.js";
import { defineTimelineElement } from "../src/index.js";
import type { TemporeumTimelineElement, Timeline } from "../src/index.js";
import { groupsPlugin } from "../src/groups.js";
import { intlPlugin } from "../src/intl.js";
import { itemsPlugin } from "../src/items.js";
import "../src/define.js";
import { normalisedHtml } from "./sheets.js";

// The parts on entry points of their own, as a page registers them.
registerPlugin(groupsPlugin, itemsPlugin, intlPlugin);

/**
 * Groups, item kinds, adding, templates and dropping through the live instance, in a real Chromium: the group tree, item
 * kinds, adding and removing, dropping in, and templates.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const domain: [number, number] = [T0, T0 + 20 * DAY];
const groups: Group[] = [
  { id: "team", label: "Team" },
  { id: "ann", label: "Ann", parentId: "team" },
  { id: "bob", label: "Bob", parentId: "team" },
  { id: "ops", label: "Ops" },
];
const items: Item[] = [
  { id: "a", start: T0 + DAY, end: T0 + 4 * DAY, laneId: "ann", label: "A" },
  { id: "b", start: T0 + 6 * DAY, end: T0 + 9 * DAY, laneId: "bob", label: "B" },
  { id: "c", start: T0 + 2 * DAY, end: T0 + 5 * DAY, laneId: "ops", label: "C" },
];

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(config: Parameters<typeof createTimeline>[1], width = 900): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:400px;position:relative`;
  document.body.append(element);
  const timeline = createTimeline(element, { domain, ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const headers = (element: Element): HTMLElement[] => [...element.querySelectorAll<HTMLElement>("[role=treeitem]")];
const options = (element: Element): string[] => [...element.querySelectorAll("[role=option]")].map((node) => node.getAttribute("data-tl-id") ?? "");
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe("the group tree", () => {
  it("is a role=tree outside the listbox, one treeitem per shown group, with level, position and state", async () => {
    const { element } = await mount({ items, groups });
    const tree = element.querySelector("[role=tree]");
    expect(tree).not.toBeNull();
    expect(tree?.closest("[role=listbox]")).toBeNull();
    expect(headers(element).map((node) => [node.textContent?.slice(1), node.getAttribute("aria-level"), node.getAttribute("aria-posinset"), node.getAttribute("aria-setsize"), node.getAttribute("aria-expanded")])).toEqual([
      ["Team", "1", "1", "2", "true"],
      ["Ann", "2", "1", "2", "true"],
      ["Bob", "2", "2", "2", "true"],
      ["Ops", "1", "2", "2", "true"],
    ]);
    // A roving tab stop: exactly one header is in the tab order.
    expect(headers(element).filter((node) => node.tabIndex === 0)).toHaveLength(1);
  });

  it("a click collapses a group: its descendants leave the drawing; a second click brings the same layout back", async () => {
    const { element, timeline } = await mount({ items, groups });
    const before = JSON.stringify(timeline.layout);
    const toggles: unknown[] = [];
    timeline.on("groupToggled", ({ group, collapsed }) => toggles.push([group.id, collapsed]));
    await userEvent.click(headers(element)[0] as HTMLElement);
    await nextFrame();
    timeline.flush();
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "ops"]);
    expect(options(element)).toEqual(["c"]);
    await userEvent.click(headers(element)[0] as HTMLElement);
    timeline.flush();
    expect(JSON.stringify(timeline.layout)).toBe(before);
    expect(toggles).toEqual([["team", true], ["team", false]]);
  });

  it("the keyboard walks, collapses and reorders; the reorder is a command its inverse undoes", async () => {
    const { element, timeline } = await mount({ items, groups });
    const commands: GroupCommand[] = [];
    timeline.on("groupMoved", ({ command }) => commands.push(command));
    (headers(element)[0] as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("data-tl-group")).toBe("ann");
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    timeline.flush();
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "bob", "ann", "ops"]);
    expect(commands).toHaveLength(1);
    expect(document.activeElement?.getAttribute("data-tl-group")).toBe("ann");
    timeline.applyCommand((commands[0] as GroupCommand).inverse);
    timeline.flush();
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "ann", "bob", "ops"]);
    await userEvent.keyboard("{ArrowLeft}");
    timeline.flush();
    expect(options(element)).not.toContain("a");
    // The tree's keys never reach the timeline's own: no view change.
    expect(timeline.getSnapshot().domain).toEqual(domain);
  });

  it("a header dragged past its sibling reorders the groups", async () => {
    const { element, timeline } = await mount({ items, groups });
    const commands: GroupCommand[] = [];
    timeline.on("groupMoved", ({ command }) => commands.push(command));
    const ann = headers(element)[1] as HTMLElement;
    const bob = headers(element)[2] as HTMLElement;
    const from = ann.getBoundingClientRect();
    const to = bob.getBoundingClientRect();
    const x = from.left + 10;
    ann.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, clientX: x, clientY: from.top + 5, button: 0 }));
    ann.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: x, clientY: to.bottom + 2 }));
    ann.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: x, clientY: to.bottom + 2 }));
    timeline.flush();
    expect(commands.map((command) => command.after)).toEqual([[{ id: "ann", index: 2 }]]);
    expect(timeline.getSnapshot().domain).toEqual(domain);
  });

  it("the server prints the same tree the client shows", async () => {
    const config = { items, groups, domain };
    const server = renderTimelineSvg(config, { width: 900 });
    expect(server.groups).toContain('role="tree"');
    const { element } = await mount(config);
    const parsed = new DOMParser().parseFromString(`<div>${server.groups}</div>`, "text/html");
    // A `style` as the CSSOM writes it on both sides: the client writes it through the CSSOM.
    const serverHeaders = [...parsed.querySelectorAll("[role=treeitem]")].map(normalisedHtml);
    expect(headers(element).map(normalisedHtml)).toEqual(serverHeaders);
    expect(renderTimelineHtml(config)).toContain('class="tl-groups');
  });
});

describe("item kinds", () => {
  it("draws boxes, points and backgrounds without configuration", async () => {
    const { element, timeline } = await mount({
      items: [
        { id: "r", start: T0 + DAY, end: T0 + 3 * DAY, label: "Range" },
        { id: "x", kind: "box", start: T0 + 5 * DAY, label: "Box" },
        { id: "p", kind: "point", start: T0 + 7 * DAY, label: "Point" },
        { id: "bg", kind: "background", start: T0, end: T0 + 10 * DAY, label: "Sprint" },
      ],
    });
    expect(options(element).sort()).toEqual(["p", "r", "x"]);
    expect(element.querySelector(".tl-item-dot")).not.toBeNull();
    expect(element.querySelector(".tl-background")).not.toBeNull();
    expect(timeline.layout?.items.map((placed) => placed.item.id)).not.toContain("bg");
  });
});

describe("adding and removing", () => {
  it("a double click on empty row space adds an item there, instead of zooming", async () => {
    const { element, timeline } = await mount({ items, groups, editing: { enabled: true, add: true } });
    const added: Command[] = [];
    timeline.on("command", ({ command }) => added.push(command));
    const ops = timeline.layout?.lanes.find((lane) => lane.lane.id === "ops");
    const box = element.getBoundingClientRect();
    const svg = element.querySelector("svg") as SVGSVGElement;
    const axis = Number(svg.querySelector(".tl-lane")?.getAttribute("y") ?? 0) - (timeline.layout?.lanes[0]?.cross ?? 0);
    await userEvent.dblClick(svg, { position: { x: 700, y: axis + (ops?.cross ?? 0) + 5 } });
    timeline.flush();
    expect(added.map((command) => command.type)).toEqual(["add"]);
    const item = added[0]?.after[0]?.item;
    expect(item?.laneId).toBe("ops");
    expect(timeline.getSnapshot().domain).toEqual(domain);
    expect(box.width).toBe(900);
    timeline.applyCommand((added[0] as Command).inverse);
    timeline.flush();
    expect(options(element).sort()).toEqual(["a", "b", "c"]);
  });

  it("n adds and Delete removes from the keyboard; a veto is atomic", async () => {
    const { element, timeline } = await mount({
      items,
      editing: { enabled: true, add: true, remove: true, multiSelect: true, canRemove: (item) => item.id !== "c" },
    });
    const svg = element.querySelector("svg") as SVGSVGElement;
    svg.focus();
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("n");
    timeline.flush();
    expect(options(element)).toHaveLength(4);
    const added = timeline.getSnapshot().selectedIds[0];
    expect(added).toMatch(/^item-/);
    await userEvent.keyboard("{Delete}");
    timeline.flush();
    expect(options(element).sort()).toEqual(["a", "b", "c"]);
    timeline.select(["a", "c"]);
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Escape}");
    timeline.select(["a", "c"]);
    await userEvent.keyboard("{Delete}");
    timeline.flush();
    expect(options(element).sort()).toEqual(["a", "b", "c"]);
  });

  it("the remove handle on a selected item removes it with a click", async () => {
    const { element, timeline } = await mount({ items, editing: { enabled: true, remove: true }, selectedIds: ["b"] });
    timeline.flush();
    const handle = element.querySelector('[data-tl-remove="b"]');
    expect(handle).not.toBeNull();
    await userEvent.click(handle as Element);
    timeline.flush();
    expect(options(element)).not.toContain("b");
  });

  it("dropItem adds a payload at the keyboard's place", async () => {
    const { element, timeline } = await mount({ items, editing: { enabled: true, drop: true } });
    expect(timeline.dropItem({ id: "ext", label: "External", durationMs: DAY })).toBe(true);
    timeline.flush();
    expect(options(element)).toContain("ext");
    const placed = timeline.layout?.items.find((each) => each.item.id === "ext");
    expect(Number(placed?.item.start)).toBe((domain[0] + domain[1]) / 2);
    expect(timeline.dropItem({ id: "ext" })).toBe(false);
  });
});

describe("templates", () => {
  it("draws a sanitised template, keeps the accessible name, and runs nothing", async () => {
    const win = window as unknown as { __p19?: string };
    delete win.__p19;
    const { element } = await mount({
      items,
      template: (item) => `<b>${item.label ?? ""}</b><img src="/nope.png" onerror="window.__p19='ran'"><script>window.__p19='ran'</script>`,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(element.querySelectorAll(".tl-template b")).toHaveLength(3);
    expect(element.querySelector(".tl-template img, .tl-template script")).toBeNull();
    expect(win.__p19).toBeUndefined();
    expect(element.querySelector('[data-tl-id="a"]')?.getAttribute("aria-label")).toMatch(/^A/);
  });
});

describe("the group tree at its edges", () => {
  const press = (node: Element, type: string, init: PointerEventInit): void => {
    node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, ...init }));
  };

  it("stands vertically too, carries a custom theme, a group's class, and names a group without a label by its id", async () => {
    const theme = { name: "brand", tokens: { ...(await import("@temporeum/timeline-core")).LIGHT_THEME.tokens, surface: "#fffbe6" } };
    const { element } = await mount({ items, groups: [{ id: "solo", className: "hot" }, ...groups.slice(1)], orientation: "vertical", theme });
    const tree = element.querySelector(".tl-groups") as HTMLElement;
    expect(tree.classList.contains("tl-groups--vertical")).toBe(true);
    expect(tree.getAttribute("data-tl-theme")).toBe("custom");
    expect(tree.style.left).not.toBe("");
    const solo = element.querySelector('[data-tl-group="solo"]') as HTMLElement;
    expect(solo.className).toBe("tl-group hot");
    expect(solo.textContent).toContain("solo");
  });

  it("a vertical header drags across, and the drag reorders", async () => {
    const { element, timeline } = await mount({ items, groups, orientation: "vertical" });
    const commands: GroupCommand[] = [];
    timeline.on("groupMoved", ({ command }) => commands.push(command));
    const ann = headers(element)[1] as HTMLElement;
    const bob = headers(element)[2] as HTMLElement;
    const from = ann.getBoundingClientRect();
    const to = bob.getBoundingClientRect();
    press(ann, "pointerdown", { clientX: from.left + 5, clientY: from.top + 10, button: 0 });
    press(ann, "pointermove", { clientX: to.right + 2, clientY: from.top + 10 });
    expect(ann.style.transform).toMatch(/^translateX/);
    press(ann, "pointerup", { clientX: to.right + 2, clientY: from.top + 10 });
    timeline.flush();
    expect(commands.map((command) => command.after)).toEqual([[{ id: "ann", index: 2 }]]);
  });

  it("ignores a secondary button, a cancelled press and a stray move; a cancelled drag puts the header back", async () => {
    const { element, timeline } = await mount({ items, groups });
    const events: unknown[] = [];
    timeline.on("groupToggled", (event) => events.push(event));
    timeline.on("groupMoved", (event) => events.push(event));
    const team = headers(element)[0] as HTMLElement;
    const box = team.getBoundingClientRect();
    press(team, "pointermove", { clientX: box.left + 5, clientY: box.top + 40 });
    press(team, "pointerdown", { clientX: box.left + 5, clientY: box.top + 5, button: 2 });
    press(team, "pointerup", { clientX: box.left + 5, clientY: box.top + 5, button: 2 });
    press(team, "pointerdown", { clientX: box.left + 5, clientY: box.top + 5, button: 0 });
    press(team, "pointermove", { clientX: box.left + 5, clientY: box.top + 60 });
    press(team, "pointerup", { clientX: box.left + 5, clientY: box.top + 60, pointerId: 9 });
    press(team, "pointercancel", { clientX: box.left + 5, clientY: box.top + 60 });
    expect(team.style.transform).toBe("");
    expect(team.classList.contains("tl-group--dragging")).toBe(false);
    timeline.flush();
    expect(events).toEqual([]);
    expect(headers(element)).toHaveLength(4);
  });

  it("a key the tree does not know, and a key outside a header, reach no group", async () => {
    const { element, timeline } = await mount({ items, groups });
    const events: unknown[] = [];
    timeline.on("groupToggled", (event) => events.push(event));
    const team = headers(element)[0] as HTMLElement;
    team.focus();
    await userEvent.keyboard("q");
    const tree = element.querySelector(".tl-groups") as HTMLElement;
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(events).toEqual([]);
    expect(document.activeElement).toBe(team);
  });

  it("a groups update keeps the state of a kept group and starts a new one as it says", async () => {
    const { element, timeline } = await mount({ items, groups });
    timeline.toggleGroup("team", true);
    timeline.flush();
    timeline.update({ groups: [...groups, { id: "new", label: "New", collapsed: true }] });
    timeline.flush();
    expect(headers(element).map((node) => [node.dataset.tlGroup, node.getAttribute("aria-expanded")])).toEqual([
      ["team", "false"],
      ["ops", "true"],
      ["new", "false"],
    ]);
  });

  it("toggleGroup ignores an unknown group and a state it is already in", async () => {
    const { timeline } = await mount({ items, groups });
    const events: unknown[] = [];
    timeline.on("groupToggled", (event) => events.push(event));
    timeline.toggleGroup("nobody");
    timeline.toggleGroup("team", false);
    timeline.toggleGroup("team");
    expect(events).toHaveLength(1);
  });

  it("names a built-in theme by its name", async () => {
    const { element } = await mount({ items, groups, theme: "dark" });
    expect(element.querySelector(".tl-groups")?.getAttribute("data-tl-theme")).toBe("dark");
  });

  it("a press that travels less than the threshold is still a click", async () => {
    const { element, timeline } = await mount({ items, groups });
    const toggles: unknown[] = [];
    timeline.on("groupToggled", ({ group, collapsed }) => toggles.push([group.id, collapsed]));
    const ops = headers(element)[3] as HTMLElement;
    const box = ops.getBoundingClientRect();
    press(ops, "pointerdown", { clientX: box.left + 5, clientY: box.top + 5, button: 0 });
    press(ops, "pointermove", { clientX: box.left + 5, clientY: box.top + 6 });
    press(ops, "pointerup", { clientX: box.left + 5, clientY: box.top + 6 });
    expect(toggles).toEqual([["ops", true]]);
  });

  it("a header let go in its own place, and the first group moved earlier, give no command", async () => {
    const { element, timeline } = await mount({ items, groups });
    const commands: GroupCommand[] = [];
    timeline.on("groupMoved", ({ command }) => commands.push(command));
    const ann = headers(element)[1] as HTMLElement;
    const box = ann.getBoundingClientRect();
    press(ann, "pointerdown", { clientX: box.left + 5, clientY: box.top + 2, button: 0 });
    press(ann, "pointermove", { clientX: box.left + 5, clientY: box.top + 12 });
    press(ann, "pointerup", { clientX: box.left + 5, clientY: box.top + 12 });
    (headers(element)[0] as HTMLElement).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    timeline.flush();
    expect(commands).toEqual([]);
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "ann", "bob", "ops"]);
  });

  it("a redraw during a drag leaves the dragged header where the pointer has it", async () => {
    const { element, timeline } = await mount({ items, groups });
    const ann = headers(element)[1] as HTMLElement;
    const box = ann.getBoundingClientRect();
    press(ann, "pointerdown", { clientX: box.left + 5, clientY: box.top + 5, button: 0 });
    press(ann, "pointermove", { clientX: box.left + 5, clientY: box.top + 40 });
    const transform = ann.style.transform;
    expect(transform).toMatch(/^translateY/);
    timeline.update({ items: [...items] });
    timeline.flush();
    expect(ann.style.transform).toBe(transform);
    press(ann, "pointercancel", { clientX: box.left + 5, clientY: box.top + 40 });
  });

  it("hydrating, the client takes over the server's tree instead of drawing a second one", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.setHTMLUnsafe(renderTimelineHtml({ items, groups, domain, height: 300 }, { tagName: "tl-hydrate-groups" }));
    document.body.append(host);
    const el = host.firstElementChild as TemporeumTimelineElement;
    const root = el.shadowRoot as ShadowRoot;
    const tree = root.querySelector(".tl-groups");
    const team = root.querySelector('[data-tl-group="team"]');
    expect(tree).not.toBeNull();
    defineTimelineElement("tl-hydrate-groups");
    await vi.waitFor(() => {
      if (el.timeline?.result === undefined) throw new Error("not drawn yet");
    });
    await nextFrame();
    expect(root.querySelectorAll(".tl-groups")).toHaveLength(1);
    expect(root.querySelector(".tl-groups")).toBe(tree);
    expect(root.querySelector('[data-tl-group="team"]')).toBe(team);
  });

  it("is removed with the timeline", async () => {
    const { element, timeline } = await mount({ items, groups });
    expect(element.querySelector(".tl-groups")).not.toBeNull();
    timeline.destroy();
    expect(element.querySelector(".tl-groups")).toBeNull();
  });
});

describe("dropping in at its edges", () => {
  const MIME = "application/x-temporeum-item";
  const drag = (target: Element, type: string, payload: string | undefined, at: { x: number; y: number }): DragEvent => {
    const data = new DataTransfer();
    if (payload !== undefined) data.setData(MIME, payload);
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: at.x, clientY: at.y });
    target.dispatchEvent(event);
    return event;
  };

  it("a drop with the item type is accepted and placed under the pointer; any other drag is not", async () => {
    const { element, timeline } = await mount({ items, groups, editing: { enabled: true, drop: true } });
    const svg = element.querySelector("svg") as SVGSVGElement;
    const box = element.getBoundingClientRect();
    const ops = timeline.layout?.lanes.find((lane) => lane.lane.id === "ops");
    const axis = Number(svg.querySelector(".tl-lane")?.getAttribute("y") ?? 0) - (timeline.layout?.lanes[0]?.cross ?? 0);
    const at = { x: box.left + 450, y: box.top + axis + (ops?.cross ?? 0) + 5 };
    expect(drag(svg, "dragover", undefined, at).defaultPrevented).toBe(false);
    const over = drag(svg, "dragover", JSON.stringify({ id: "ext" }), at);
    expect(over.defaultPrevented).toBe(true);
    expect(drag(svg, "drop", "", at).defaultPrevented).toBe(false);
    expect(drag(svg, "drop", JSON.stringify({ id: "ext", label: "External", durationMs: DAY }), at).defaultPrevented).toBe(true);
    timeline.flush();
    const placed = timeline.layout?.items.find((each) => each.item.id === "ext");
    expect(placed?.laneId).toBe("ops");
  });

  it("without drop switched on, neither a drag nor dropItem adds anything", async () => {
    const { element, timeline } = await mount({ items, editing: { enabled: true } });
    const svg = element.querySelector("svg") as SVGSVGElement;
    const box = element.getBoundingClientRect();
    const at = { x: box.left + 450, y: box.top + 80 };
    expect(drag(svg, "dragover", JSON.stringify({ id: "ext" }), at).defaultPrevented).toBe(false);
    expect(drag(svg, "drop", JSON.stringify({ id: "ext" }), at).defaultPrevented).toBe(false);
    expect(timeline.dropItem({ id: "ext" })).toBe(false);
    timeline.flush();
    expect(options(element)).not.toContain("ext");
  });

  it("with groups and nothing focused, the keyboard adds to the first group's lane; Delete with nothing focused does nothing", async () => {
    const { element, timeline } = await mount({ items, groups: groups.slice(1), editing: { enabled: true, add: true, remove: true } });
    const svg = element.querySelector("svg") as SVGSVGElement;
    svg.focus();
    await userEvent.keyboard("{Delete}");
    timeline.flush();
    expect(options(element).sort()).toEqual(["a", "b", "c"]);
    await userEvent.keyboard("n");
    timeline.flush();
    const added = timeline.layout?.items.find((each) => each.item.id.startsWith("item-"));
    expect(added?.laneId).toBe("ann");
  });
});

describe("the element's group and item properties", () => {
  it("groups, template and hooks are properties that reach the drawing", async () => {
    const el = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    el.style.cssText = "display:block;width:800px;height:400px";
    el.config = { items, domain };
    document.body.append(el);
    el.groups = groups;
    el.template = (item) => `<b>${item.label ?? ""}</b>`;
    const hooks = {};
    el.hooks = hooks;
    expect(el.groups).toBe(groups);
    expect(el.template).toBeTypeOf("function");
    expect(el.hooks).toBe(hooks);
    const root = el.shadowRoot as ShadowRoot;
    await vi.waitFor(() => {
      if (root.querySelectorAll("[role=treeitem]").length !== 4) throw new Error("no tree yet");
      if (root.querySelector(".tl-template b") === null) throw new Error("no template yet");
    });
  });
});

describe("the group tree right to left", () => {
  it("a collapsed group's toggle points left, the way the labels read, and the arrows trade places: ← opens, → closes", async () => {
    const { element } = await mount({ items, groups: groups.map((group) => (group.id === "team" ? { ...group, collapsed: true } : group)), direction: "rtl" });
    const team = (): HTMLElement => element.querySelector('[data-tl-group="team"]') as HTMLElement;
    expect(team().querySelector(".tl-group-toggle")?.textContent).toBe("◂");
    team().focus();
    await userEvent.keyboard("{ArrowLeft}");
    await nextFrame();
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "ann", "bob", "ops"]);
    expect(team().querySelector(".tl-group-toggle")?.textContent).toBe("▾");
    team().focus();
    await userEvent.keyboard("{ArrowRight}");
    await nextFrame();
    expect(headers(element).map((node) => node.dataset.tlGroup)).toEqual(["team", "ops"]);
  });
});
