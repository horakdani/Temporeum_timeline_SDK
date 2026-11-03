import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import "../src/define.js";
import { createTimeline, registerPlugin, renderTimelineHtml, renderTimelineSvg } from "../src/index.js";
import type { ItemSlot, MetricsSetting, SizeOverrides, SlotsChangedPayload, TemporeumTimelineElement, Timeline } from "../src/index.js";
import { groupsPlugin } from "../src/groups.js";
import { itemsPlugin } from "../src/items.js";
import { mountTaskGrid } from "../src/task-grid.js";
import { toolsPlugin } from "../src/tools.js";

registerPlugin(itemsPlugin);
registerPlugin(groupsPlugin);
registerPlugin(toolsPlugin);

/**
 * P35 through the live instance, in a real Chromium: a page styles the
 * custom element from outside its shadow root — the tokens it sets on the
 * element, `::part()` for any node — sizes are configuration the layout
 * measures with, and slots are boxes a framework renders into, handed over
 * in the frame that drew them.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Design", laneId: "l1", className: "urgent" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Build", laneId: "l1" },
  { id: "c", start: T0 + 16 * DAY, end: T0 + 20 * DAY, label: "Ship", laneId: "l2" },
];
const lanes = [
  { id: "l1", label: "Work" },
  { id: "l2", label: "Delivery" },
];
const domain: [number, number] = [T0, T0 + 24 * DAY];

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-p35]").forEach((node) => node.remove());
});

function pageCss(css: string): void {
  const style = document.createElement("style");
  style.dataset.p35 = "";
  style.textContent = css;
  document.head.append(style);
}

async function place(config: Record<string, unknown> = {}, attributes: Record<string, string> = {}): Promise<TemporeumTimelineElement> {
  const el = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
  el.style.width = "800px";
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.items = items;
  el.lanes = lanes;
  el.config = { domain, ...config };
  document.body.append(el);
  await vi.waitFor(() => {
    if (el.timeline?.result === undefined) throw new Error("not drawn yet");
  });
  return el;
}

async function plain(config: Record<string, unknown> = {}): Promise<{ timeline: Timeline; element: HTMLDivElement }> {
  const element = document.createElement("div");
  element.style.cssText = "width:800px;height:240px;position:relative";
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain, height: 240, timeZone: "UTC", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined) throw new Error("not drawn yet");
  });
  return { timeline, element };
}

const rectOf = (root: ParentNode, id: string): SVGRectElement => root.querySelector(`rect[data-tl-id="${id}"], [data-tl-id="${id}"] > rect`) as SVGRectElement;
const fill = (node: Element): string => getComputedStyle(node).fill;

describe("styling the custom element from the page", () => {
  it("takes the tokens the page sets on the element, in both themes", async () => {
    pageCss("temporeum-timeline.pink { --tl-item-fill: rgb(250, 200, 220); --tl-surface: rgb(1, 2, 3); }");
    const el = await place({}, { class: "pink" });
    const root = el.shadowRoot as ShadowRoot;
    expect(fill(rectOf(root, "b"))).toBe("rgb(250, 200, 220)");
    expect(fill(root.querySelector(".tl-surface") as Element)).toBe("rgb(1, 2, 3)");
    el.setAttribute("theme", "dark");
    await vi.waitFor(() => expect(root.querySelector("svg style")?.textContent).toMatch(/^:host\{--tl-surface:#14171c/));
    expect(fill(rectOf(root, "b"))).toBe("rgb(250, 200, 220)");
    // Without a rule of the page's, the theme's own.
    el.classList.remove("pink");
    expect(fill(rectOf(root, "b"))).toBe("rgb(30, 51, 80)");
  });

  it("names every node by its classes, so ::part() reaches items, states and the host's own classes", async () => {
    pageCss(
      "temporeum-timeline::part(urgent) { fill: rgb(255, 120, 0); }" +
        "temporeum-timeline::part(item-selected) { stroke: rgb(0, 128, 0); }" +
        "temporeum-timeline::part(tick-label) { fill: rgb(9, 9, 9); }",
    );
    const el = await place();
    const root = el.shadowRoot as ShadowRoot;
    expect(root.querySelector("svg")?.getAttribute("part")).toBe("timeline");
    expect(rectOf(root, "a").getAttribute("part")).toBe("item urgent");
    expect(fill(rectOf(root, "a"))).toBe("rgb(255, 120, 0)");
    expect(fill(root.querySelector(".tl-tick-label") as Element)).toBe("rgb(9, 9, 9)");
    el.timeline?.select(["b"]);
    el.timeline?.flush();
    await vi.waitFor(() => expect(rectOf(root, "b").getAttribute("part")).toBe("item item-selected"));
    expect(getComputedStyle(rectOf(root, "b")).stroke).toBe("rgb(0, 128, 0)");
  });

  it("gives the overlays parts too: the group tree, the tooltip", async () => {
    const el = await place({ groups: [{ id: "team", label: "Team", children: [{ id: "l1", label: "Work" }, { id: "l2", label: "Delivery" }] }], tooltip: true });
    const root = el.shadowRoot as ShadowRoot;
    await vi.waitFor(() => expect(root.querySelector(".tl-group")).not.toBeNull());
    expect(root.querySelector(".tl-group")?.getAttribute("part")).toBe("group");
    expect(root.querySelector(".tl-group-label")?.getAttribute("part")).toBe("group-label");
    expect(root.querySelector(".tl-groups")?.getAttribute("part")).toBe("groups groups-horizontal");
    expect(root.querySelector(".tl-tooltip")?.getAttribute("part")).toBe("tooltip");
  });

  it("declares the tokens on :host for both schemes when the theme follows the platform, a scoped stylesheet's too", async () => {
    const el = await place({ instanceId: "plan" });
    const css = (el.shadowRoot as ShadowRoot).querySelector("svg style")?.textContent ?? "";
    expect(css).toMatch(/^:host\{--tl-surface:#ffffff;/);
    expect(css).toContain("@media (prefers-color-scheme:dark){:host{--tl-surface:#14171c;");
    // The rest of the stylesheet is the root's.
    expect(css).toContain('.tl[data-tl-instance="plan"] .tl-item{fill:var(--tl-item-fill)');
    expect(css).not.toMatch(/\.tl(\[data-tl-instance="plan"\])?(:not\(\[data-tl-theme="light"\]\))?\{--tl-/);
  });

  it("exports a file whose stylesheet is not the shadow root's", async () => {
    const el = await place();
    const svg = el.timeline?.exportSvg() ?? "";
    expect(svg).not.toContain(":host");
    expect(svg).toMatch(/\.tl(\[[^\]]*\])?\{--tl-surface/);
  });

  it("is printed by the server with the tokens on :host and the parts, and taken over as it is", async () => {
    const html = renderTimelineHtml({ items, lanes, domain, timeZone: "UTC" }, { tagName: "temporeum-timeline" });
    expect(html).toContain(":host{--tl-surface");
    expect(html).toContain('part="item urgent"');
    const svg = renderTimelineSvg({ items, lanes, domain, timeZone: "UTC" }).svg;
    expect(svg).not.toContain(":host");
    expect(svg).not.toContain(" part=");
    const host = document.createElement("div");
    document.body.append(host);
    host.setHTMLUnsafe(html.replace("<temporeum-timeline", '<temporeum-timeline style="width:800px"'));
    const el = host.firstElementChild as TemporeumTimelineElement;
    const before = rectOf(el.shadowRoot as ShadowRoot, "a");
    await vi.waitFor(() => {
      if (el.timeline?.result === undefined) throw new Error("not drawn yet");
    });
    expect(rectOf(el.shadowRoot as ShadowRoot, "a")).toBe(before);
    expect(before.getAttribute("part")).toBe("item urgent");
  });

  it("leaves a timeline in the page's own DOM without parts: the page reaches its classes", async () => {
    const { element } = await plain();
    expect(element.querySelector("[part]")).toBeNull();
    expect(element.querySelector("style")?.textContent).not.toContain(":host");
  });
});

describe("metrics", () => {
  it("draws, measures and packs with the host's sizes and font", async () => {
    const before = await plain();
    const height = before.timeline.result?.contentCrossSize ?? 0;
    before.timeline.destroy();
    document.body.replaceChildren();
    const { timeline, element } = await plain({ density: "comfortable", metrics: { rowSize: 44, cornerRadius: 10, fontSize: 16, lineHeight: 20, fontFamily: "Georgia, serif" } });
    expect(timeline.metrics?.rowSize).toBe(44);
    expect(timeline.result?.contentCrossSize).toBeGreaterThan(height);
    expect(rectOf(element, "a").getAttribute("rx")).toBe("10");
    const label = element.querySelector(".tl-label") as Element;
    expect(getComputedStyle(label).fontSize).toBe("16px");
    expect(getComputedStyle(label).fontFamily).toContain("Georgia");
    // The labels were measured in that font: each fits the room it was given.
    for (const kept of timeline.result?.labels.kept ?? []) expect(kept.box.mainSize).toBeGreaterThan(0);
  });

  it("changes with update, and a function sets each level apart", async () => {
    const { timeline } = await plain({ density: "compact" });
    const compact = timeline.metrics?.rowSize ?? 0;
    timeline.update({ metrics: (base) => ({ rowSize: base.rowSize * 2 }) });
    timeline.flush();
    await vi.waitFor(() => expect(timeline.metrics?.rowSize).toBe(compact * 2));
    timeline.update({ metrics: undefined });
    timeline.flush();
    await vi.waitFor(() => expect(timeline.metrics?.rowSize).toBe(compact));
  });

  it("refuses, where it is configured, a size nothing can be drawn at and a font stack that would end the stylesheet's rule", async () => {
    const element = document.createElement("div");
    element.style.cssText = "width:800px;height:240px;position:relative";
    document.body.append(element);
    const make = (metrics: MetricsSetting) => () => createTimeline(element, { items, domain, metrics });
    expect(make({ rowSize: 0 })).toThrow(/metrics\.rowSize must be a positive number of pixels, got 0/);
    expect(make({ fontSize: Number.NaN })).toThrow(/metrics\.fontSize must be a positive number/);
    expect(make({ rowGap: -1 })).toThrow(/metrics\.rowGap must be a non-negative number of pixels, got -1/);
    for (const font of ["", "  ", "x}svg{display:none", "x;}.tl{fill:red", "Inter</style><script>", "a\\62 c", "Inter /* */"]) {
      expect(make({ fontFamily: font })).toThrow(/metrics\.fontFamily must be a CSS font stack/);
    }
    expect(make({ fontSize: "12px" as unknown as number })).toThrow(/metrics\.fontSize must be a positive number of pixels, got "12px"/);
    // A function's sizes are checked too, and an update is checked where it is made.
    expect(make(() => ({ lineHeight: -2 }))).toThrow(/metrics\.lineHeight/);
    const { timeline } = await plain({ metrics: { rowGap: 0 } });
    expect(timeline.metrics?.rowGap).toBe(0);
    expect(() => timeline.update({ metrics: { cornerRadius: Number.POSITIVE_INFINITY } })).toThrow(/metrics\.cornerRadius/);
  });

  it("makes one set of sizes per level and orientation, whatever is asked how often", async () => {
    let calls = 0;
    const grow = (base: { rowSize: number }) => {
      calls += 1;
      return { rowSize: base.rowSize + 10, density: "dense", autoMainRoom: 0 } as SizeOverrides;
    };
    const { timeline } = await plain({ metrics: grow });
    timeline.zoomBy(1.5);
    timeline.flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // `density: "auto"` measured all three levels, once each; the frames asked again and again.
    expect(calls).toBe(3);
    const metrics = timeline.metrics;
    expect(metrics?.rowSize).toBe(38);
    // Only the sizes a host may set: the level and its thresholds stay the table's.
    expect(metrics?.density).toBe("comfortable");
    expect(metrics?.autoMainRoom).toBe(72);
  });

  it("lines the task grid up with the axis the frame drew", async () => {
    const { timeline } = await plain({ metrics: { axisSize: 64 } });
    const grid = document.createElement("div");
    grid.style.cssText = "width:300px;height:240px";
    document.body.append(grid);
    const handle = mountTaskGrid(grid, timeline);
    await vi.waitFor(() => expect(grid.querySelector("[role=row]")).not.toBeNull());
    expect(grid.innerHTML).toContain("64");
    handle.destroy();
  });
});

describe("slots", () => {
  it("leaves each drawn item an empty box, named by the item, instead of its label", async () => {
    const { timeline, element } = await plain({ slots: true });
    const slots = timeline.slots;
    expect([...slots.keys()].sort()).toEqual(["a", "b", "c"]);
    const slot = slots.get("a") as ItemSlot;
    expect(slot.item).toBe(items[0]);
    // The item's own host, in the box over the item.
    expect(slot.element.className).toBe("tl-slot-content");
    expect(slot.element.parentElement?.getAttribute("data-tl-slot")).toBe("a");
    expect(slot.element.parentElement?.parentElement?.localName).toBe("foreignObject");
    expect(slot.element.parentElement?.parentElement?.getAttribute("class")).toBe("tl-label tl-slot");
    expect(element.querySelectorAll(".tl-label:not(.tl-slot)")).toHaveLength(0);
    // The item keeps its accessible name.
    expect(element.querySelector('[data-tl-id="a"][role=option]')?.getAttribute("aria-label")).toContain("Design");
  });

  it("keeps what the host rendered through every redraw — a zoom's new tiles too", async () => {
    const { timeline } = await plain({ slots: true });
    const box = timeline.slots.get("b")?.element as HTMLElement;
    const content = document.createElement("strong");
    content.textContent = "Build — 60%";
    box.append(content);
    timeline.select(["b"]);
    timeline.zoomBy(1.2);
    timeline.flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    timeline.flush();
    expect(timeline.slots.get("b")?.element).toBe(box);
    expect(box.firstElementChild).toBe(content);
  });

  it("says which boxes are drawn, in the frame that drew them, when they are others", async () => {
    const { timeline } = await plain({ slots: true });
    const seen: SlotsChangedPayload[] = [];
    let inFrame = 0;
    timeline.on("slotsChanged", (payload) => {
      seen.push(payload);
      // The boxes it names are in the document now.
      for (const slot of payload.slots.values()) if (slot.element.isConnected) inFrame += 1;
    });
    // Only "c" in view.
    timeline.zoomTo([T0 + 15 * DAY, T0 + 21 * DAY]);
    timeline.flush();
    await vi.waitFor(() => expect(seen.at(-1)?.slots.has("a")).toBe(false));
    const last = seen.at(-1) as SlotsChangedPayload;
    expect([...last.slots.keys()]).toEqual(["c"]);
    expect(inFrame).toBeGreaterThan(0);
    expect(timeline.slots).toBe(last.slots);
    // A redraw with the same boxes says nothing.
    const count = seen.length;
    timeline.select(["c"]);
    timeline.flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(seen).toHaveLength(count);
    // A changed item is a change, in the same box.
    const box = last.slots.get("c")?.element;
    timeline.updateItems([{ id: "c", label: "Ship it" }]);
    timeline.flush();
    await vi.waitFor(() => expect(timeline.slots.get("c")?.item.label).toBe("Ship it"));
    expect(timeline.slots.get("c")?.element).toBe(box);
  });

  it("moves each host into the box drawn for its item, when a pooled box goes to another", async () => {
    const many: Item[] = Array.from({ length: 120 }, (_, index) => ({ id: `i${String(index)}`, start: T0 + index * DAY, end: T0 + index * DAY + DAY / 2, label: `Item ${String(index)}`, laneId: "l1" }));
    const { timeline } = await plain({ items: many, slots: true, domain: [T0, T0 + 10 * DAY] });
    for (const step of [20, 40, 60, 80]) {
      timeline.zoomTo([T0 + step * DAY, T0 + (step + 10) * DAY]);
      timeline.flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      timeline.flush();
      for (const [id, slot] of timeline.slots) {
        expect(slot.element.parentElement?.getAttribute("data-tl-slot")).toBe(id);
        expect(slot.item.id).toBe(id);
        expect(slot.element.isConnected).toBe(true);
      }
      // Every box holds its own item's host and no other.
      for (const box of document.querySelectorAll("[data-tl-slot]")) {
        expect(box.children).toHaveLength(1);
        expect(box.firstElementChild?.getAttribute("data-tl-content")).toBe(box.getAttribute("data-tl-slot"));
      }
    }
  });

  it("are the items a function picks, and none once turned off", async () => {
    const { timeline, element } = await plain({ slots: (item: Item) => item.laneId === "l1" });
    expect([...timeline.slots.keys()].sort()).toEqual(["a", "b"]);
    expect(element.querySelector('.tl-label:not(.tl-slot)')?.textContent).toContain("Ship");
    const seen: SlotsChangedPayload[] = [];
    timeline.on("slotsChanged", (payload) => seen.push(payload));
    timeline.update({ slots: false });
    timeline.flush();
    await vi.waitFor(() => expect(timeline.slots.size).toBe(0));
    expect(seen.at(-1)?.slots.size).toBe(0);
    expect(element.querySelector("[data-tl-slot]")).toBeNull();
  });

  it("win over a template", async () => {
    const { timeline, element } = await plain({ template: (item: Item) => `<b>${item.label ?? ""}</b>`, slots: true });
    expect(timeline.slots.size).toBe(3);
    expect(element.querySelector(".tl-template")).toBeNull();
  });
});
