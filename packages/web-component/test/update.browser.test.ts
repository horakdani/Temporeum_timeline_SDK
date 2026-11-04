import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { commands } from "vitest/browser";

import type { Domain, Item } from "@temporeum/timeline-core";

import { createTimeline, defineTimelineElement } from "../src/index.js";
import type { TemporeumTimelineElement, Timeline, TimelineElementEventMap, TimelineInstanceEventMap } from "../src/index.js";

/**
 * `update` and a host that hands its props again on every render. A component writes `editing={{ enabled: true }}` into its
 * render: every render is a new object that says nothing new. The instance
 * used to take the key's presence as a change and build a new input
 * machine — the press under the reader's pointer was dropped mid-drag.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const items: Item[] = [
  { id: "a", start: T0 + DAY, end: T0 + 3 * DAY, label: "Spec" },
  { id: "b", start: T0 + 5 * DAY, end: T0 + 7 * DAY, label: "Build" },
];
const domain: [number, number] = [T0, T0 + 10 * DAY];

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(config: Parameters<typeof createTimeline>[1] = {}): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  document.body.style.margin = "0";
  const element = document.createElement("div");
  element.style.width = "800px";
  element.style.height = "200px";
  document.body.append(element);
  const timeline = createTimeline(element, { items, domain, ...config });
  await vi.waitFor(() => expect(timeline.result).toBeDefined());
  return { element, timeline };
}

function centre(id: string): { x: number; y: number } {
  const box = (document.querySelector(`[data-tl-id="${id}"]`) as Element).getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

describe("update: a value that says the same is no change", () => {
  it("an editing object written anew mid-drag does not drop the drag", async () => {
    const { timeline } = await mount({ editing: { enabled: true, snapMs: DAY } });
    const moved = vi.fn();
    timeline.on("itemMoved", moved);
    const from = centre("a");
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 80, y: from.y, steps: 5 },
    ]);
    // What a re-render hands over: the same rules, a new object.
    timeline.update({ editing: { enabled: true, snapMs: DAY } });
    await commands.mouse([
      { type: "move", x: from.x + 160, y: from.y, steps: 5 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    // 160 px of 800 over ten days: two days.
    expect(moved.mock.calls[0]?.[0].to.start).toBe(T0 + 3 * DAY);
    timeline.destroy();
  });

  it("a new canMove is the one asked from then on, without a new machine", async () => {
    const { timeline } = await mount({ editing: { enabled: true, snapMs: DAY, canMove: () => true } });
    const moved = vi.fn();
    timeline.on("itemMoved", moved);
    timeline.update({ editing: { enabled: true, snapMs: DAY, canMove: () => false } });
    const from = centre("a");
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 160, y: from.y, steps: 6 },
      { type: "up" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(moved).not.toHaveBeenCalled();
    expect(timeline.items.find((item) => item.id === "a")?.start).toBe(T0 + DAY);
    timeline.destroy();
  });

  it("the same domain values do not move the view back; other values do", async () => {
    const { timeline } = await mount();
    timeline.zoomTo([T0 + DAY, T0 + 5 * DAY]);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain).toEqual([T0 + DAY, T0 + 5 * DAY]));
    // A host writing its first range back on render, as a new array and as dates.
    timeline.update({ domain: [T0, T0 + 10 * DAY] });
    timeline.update({ domain: [new Date(T0), new Date(T0 + 10 * DAY)] });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(timeline.getSnapshot().domain).toEqual([T0 + DAY, T0 + 5 * DAY]);
    timeline.update({ domain: [T0, T0 + 20 * DAY] });
    await vi.waitFor(() => expect(timeline.getSnapshot().domain).toEqual([T0, T0 + 20 * DAY]));
    timeline.destroy();
  });

  it("the same selectedIds values do not take back the reader's selection", async () => {
    const { timeline } = await mount({ selectedIds: ["a"] });
    timeline.select(["b"]);
    timeline.update({ selectedIds: ["a"] });
    await vi.waitFor(() => expect(timeline.getSnapshot().selectedIds).toEqual(["b"]));
    timeline.update({ selectedIds: ["a", "b"] });
    await vi.waitFor(() => expect(timeline.getSnapshot().selectedIds).toEqual(["a", "b"]));
    timeline.destroy();
  });

  it("a new fetch function is no reload: what was loaded stays, the next fetch is the new one's", async () => {
    const first = vi.fn((range: Domain) => Promise.resolve(items.filter((item) => Number(item.start) < range[1])));
    const { timeline } = await mount({ items: first });
    await vi.waitFor(() => expect(timeline.items).toHaveLength(2));
    const calls = first.mock.calls.length;
    const second = vi.fn((range: Domain) => Promise.resolve(items.filter((item) => Number(item.start) < range[1])));
    timeline.update({ items: second });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(first.mock.calls.length).toBe(calls);
    expect(second).not.toHaveBeenCalled();
    expect(timeline.items).toHaveLength(2);
    // Far away, where nothing is loaded: the new function is asked.
    timeline.zoomTo([T0 + 400 * DAY, T0 + 410 * DAY]);
    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    expect(first.mock.calls.length).toBe(calls);
    // `setItems` is the reload.
    timeline.setItems(first);
    await vi.waitFor(() => expect(first.mock.calls.length).toBeGreaterThan(calls));
    timeline.destroy();
  });
});

describe("the element's selectedIds property is a command", () => {
  it("setting the same ids again selects them again, after the reader selected others", async () => {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.items = items;
    element.selectedIds = ["a"];
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.getSnapshot().selectedIds).toEqual(["a"]));
    element.timeline?.select(["b"]);
    await vi.waitFor(() => expect(element.selectedIds).toEqual(["b"]));
    element.selectedIds = ["a"];
    await vi.waitFor(() => expect(element.timeline?.getSnapshot().selectedIds).toEqual(["a"]));
  });
});

describe("an attribute change hands the instance that change only", () => {
  it("a theme switch does not move the view back, rebuild the input or take back the selection", async () => {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.setAttribute("start", String(domain[0]));
    element.setAttribute("end", String(domain[1]));
    element.setAttribute("editable", "");
    element.setAttribute("aria-label", "Plan");
    element.items = items;
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    const timeline = element.timeline as Timeline;
    timeline.zoomTo([T0 + DAY, T0 + 5 * DAY]);
    timeline.select(["b"]);
    const update = vi.spyOn(timeline, "update");
    element.setAttribute("theme", "dark");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toEqual({ theme: "dark" });
    element.removeAttribute("aria-label");
    expect(update.mock.calls[1]?.[0]).toEqual({ ariaLabel: undefined });
    element.removeAttribute("editable");
    expect(update.mock.calls[2]?.[0]).toEqual({ editing: undefined });
    element.setAttribute("snap-ms", String(DAY));
    expect(update.mock.calls[3]?.[0]).toEqual({ editing: { enabled: false, snapMs: DAY } });
    // An attribute that says the same again is no call at all.
    element.setAttribute("theme", "dark");
    expect(update).toHaveBeenCalledTimes(4);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain).toEqual([T0 + DAY, T0 + 5 * DAY]));
    expect(timeline.getSnapshot().selectedIds).toEqual(["b"]);
  });
});

describe("properties set before the element is defined", () => {
  it("are taken through the setters on upgrade, not left hiding them", async () => {
    const tag = "temporeum-timeline-early";
    const element = document.createElement(tag) as TemporeumTimelineElement;
    element.style.width = "800px";
    // What a framework does with a tag whose module has not loaded yet.
    Object.assign(element, { config: { domain, height: 180 }, items, selectedIds: ["a"] });
    document.body.append(element);
    defineTimelineElement(tag);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    expect(Object.hasOwn(element, "items")).toBe(false);
    expect(element.timeline?.items).toHaveLength(2);
    expect(element.timeline?.getSnapshot().selectedIds).toEqual(["a"]);
    expect(element.timeline?.getSnapshot().domain).toEqual(domain);
    // And the accessors work from then on.
    element.items = [items[0] as Item];
    await vi.waitFor(() => expect(element.timeline?.items).toHaveLength(1));
  });
});

describe("moving the element keeps the instance", () => {
  async function placed(): Promise<TemporeumTimelineElement> {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.items = items;
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    return element;
  }

  it("an append into another parent keeps the view, the selection and the listeners", async () => {
    const element = await placed();
    const timeline = element.timeline as Timeline;
    timeline.zoomTo([T0 + DAY, T0 + 5 * DAY]);
    timeline.select(["b"]);
    const heard = vi.fn();
    timeline.on("selectionChanged", heard);
    const other = document.createElement("section");
    document.body.append(other);
    other.append(element);
    await Promise.resolve();
    expect(element.timeline).toBe(timeline);
    expect(timeline.destroyed).toBe(false);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain).toEqual([T0 + DAY, T0 + 5 * DAY]));
    expect(timeline.getSnapshot().selectedIds).toEqual(["b"]);
    timeline.select(["a"]);
    expect(heard).toHaveBeenCalledTimes(1);
    // The DOM events still come from the element.
    const events = vi.fn();
    element.addEventListener("selection-changed", events);
    timeline.select(["b"]);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it("moveBefore keeps it too, and a removal lets it go", async () => {
    const element = await placed();
    const timeline = element.timeline as Timeline;
    const parent = element.parentNode as ParentNode & { moveBefore?: (node: Node, child: Node | null) => void };
    if (typeof parent.moveBefore === "function") {
      const marker = document.createElement("hr");
      document.body.prepend(marker);
      parent.moveBefore(element, marker);
      await Promise.resolve();
      expect(element.timeline).toBe(timeline);
    }
    element.remove();
    await Promise.resolve();
    expect(timeline.destroyed).toBe(true);
    expect(element.timeline).toBeUndefined();
  });
});

describe("the element's property model", () => {
  async function placed(): Promise<TemporeumTimelineElement> {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.items = items;
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    return element;
  }
  const svgOf = (element: TemporeumTimelineElement): SVGSVGElement => (element.shadowRoot as ShadowRoot).querySelector("svg") as SVGSVGElement;

  it("orientation, density, theme, height and editable are properties too, and win over the attributes", async () => {
    const element = await placed();
    element.setAttribute("orientation", "horizontal");
    element.orientation = "vertical";
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(element.getAttribute("orientation")).toBe("horizontal");
    // Back to the attribute.
    element.orientation = undefined;
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-orientation")).toBe("horizontal"));
    element.density = "dense";
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-density")).toBe("dense"));
    element.theme = "dark";
    expect(element.theme).toBe("dark");
    expect(element.timeline?.getSnapshot()).toBeDefined();
    element.height = 240;
    expect(element.style.getPropertyValue("--tl-height")).toBe("240px");
    expect(element.editable).toBe(false);
    element.editable = true;
    expect(element.editable).toBe(true);
    expect(element.config.editing?.enabled).toBe(true);
  });

  it("config replaces what the config before it said: a field left out goes back to the attribute or the default", async () => {
    const element = await placed();
    element.setAttribute("density", "compact");
    element.lanes = [{ id: "l1", label: "Work" }];
    element.config = { items, density: "dense", orientation: "vertical" };
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-orientation")).toBe("vertical"));
    element.config = { items };
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-orientation")).toBe("horizontal"));
    await vi.waitFor(() => expect(svgOf(element).getAttribute("data-tl-density")).toBe("compact"));
    expect(element.config.orientation).toBeUndefined();
    // A named property set on its own stays.
    expect(element.lanes).toEqual([{ id: "l1", label: "Work" }]);
  });

  it("the tag and the events are typed", () => {
    expectTypeOf(document.createElement("temporeum-timeline")).toEqualTypeOf<TemporeumTimelineElement>();
    expectTypeOf<TimelineElementEventMap["item-moved"]>().toEqualTypeOf<CustomEvent<TimelineInstanceEventMap["itemMoved"]>>();
    expectTypeOf<TimelineElementEventMap>().toHaveProperty("timeline-command");
    expectTypeOf<TimelineElementEventMap>().not.toHaveProperty("command");
    const listen = (element: TemporeumTimelineElement): void => {
      element.addEventListener("item-moved", (event) => {
        expectTypeOf(event.detail.item.id).toBeString();
      });
    };
    expect(listen).toBeTypeOf("function");
  });
});

describe("the host's accessible name and focus", () => {
  it("names the timeline by the elements aria-labelledby points at, and focus() reaches the timeline", async () => {
    defineTimelineElement();
    const caption = document.createElement("h2");
    caption.id = "plan-caption";
    caption.textContent = "Release plan";
    const note = document.createElement("span");
    note.id = "plan-note";
    note.textContent = "Q1";
    document.body.append(caption, note);
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.setAttribute("aria-labelledby", "plan-caption plan-note");
    element.items = items;
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    const named = (): Element | null => (element.shadowRoot as ShadowRoot).querySelector("[aria-label='Release plan Q1']");
    await vi.waitFor(() => expect(named()).not.toBeNull());
    // aria-label wins, as it does in the platform's name computation.
    element.setAttribute("aria-label", "Roadmap");
    await vi.waitFor(() => expect((element.shadowRoot as ShadowRoot).querySelector("[aria-label='Roadmap']")).not.toBeNull());
    element.focus();
    expect(document.activeElement).toBe(element);
    const inner = (element.shadowRoot as ShadowRoot).activeElement;
    expect(inner?.getAttribute("tabindex")).toBe("0");
  });
});
