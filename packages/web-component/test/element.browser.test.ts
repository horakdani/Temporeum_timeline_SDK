import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import { DEFAULT_LANE_ID, densityMetrics } from "@temporeum/timeline-core";
import type { Item } from "@temporeum/timeline-core";

import "../src/define.js";
import { createTimeline, defineTimelineElement, renderTimelineHtml, renderTimelineSvg, TemporeumTimelineElement, TIMELINE_EVENTS } from "../src/index.js";
import type { Timeline, TimelineSnapshot } from "../src/index.js";

/**
 * `<temporeum-timeline>` and `createTimeline` in a real Chromium: a real
 * custom element registry, a real shadow root, declarative shadow DOM from
 * the parser, and input sent through the browser (Playwright/CDP), not
 * events constructed in the page — except where the claim is about what
 * the instance does with a burst of events inside one frame, which a real
 * device cannot be made to produce on demand.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning", laneId: "l1" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building", laneId: "l1" },
  { id: "c", start: T0 + 16 * DAY, end: T0 + 20 * DAY, label: "Handover", laneId: "l2" },
];
const lanes = [
  { id: "l1", label: "Work" },
  { id: "l2", label: "Delivery" },
];
const domain: [number, number] = [T0, T0 + 24 * DAY];

beforeEach(() => {
  document.body.style.margin = "0";
});
afterEach(() => {
  document.body.replaceChildren();
});

async function drawn(el: TemporeumTimelineElement): Promise<void> {
  await vi.waitFor(() => {
    if (el.timeline?.result === undefined) throw new Error("not drawn yet");
  });
}

async function place(setup: (el: TemporeumTimelineElement) => void = () => {}, width = 800): Promise<TemporeumTimelineElement> {
  const el = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
  el.style.width = `${String(width)}px`;
  el.items = items;
  el.lanes = lanes;
  el.config = { domain };
  setup(el);
  document.body.append(el);
  await drawn(el);
  return el;
}

const svgOf = (el: Element): SVGSVGElement => (el.shadowRoot as ShadowRoot).querySelector("svg") as SVGSVGElement;
const nodeOf = (el: Element, id: string): Element => (el.shadowRoot as ShadowRoot).querySelector(`[data-tl-id="${id}"]`) as Element;
function centre(node: Element): { x: number; y: number } {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
function record<D>(target: EventTarget, name: string): D[] {
  const seen: D[] = [];
  target.addEventListener(name, (event) => seen.push((event as CustomEvent<D>).detail));
  return seen;
}
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe("<temporeum-timeline>", () => {
  it("draws into its own shadow root, at the size CSS gives it", async () => {
    const el = await place((each) => each.setAttribute("height", "240"));
    expect(el).toBeInstanceOf(TemporeumTimelineElement);
    expect(el.getBoundingClientRect().height).toBe(240);
    const svg = svgOf(el);
    expect(svg.getAttribute("width")).toBe("800");
    expect(svg.getAttribute("height")).toBe("240");
    expect(svg.querySelectorAll("[role=option]")).toHaveLength(3);
    // Nothing leaks into the page's DOM.
    expect(document.querySelector(".tl")).toBeNull();
    expect(el.timeline?.getSnapshot().viewport?.mainSize).toBe(800);
  });

  it("reads a JSON child for a page without a script of its own, dates as text included", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<temporeum-timeline style="width:600px" height="200"><script type="application/json">${JSON.stringify({
      items: [
        { id: "x", start: "2026-03-01T00:00:00Z", end: "2026-03-05T00:00:00Z", label: "X" },
        { id: "y", start: "2026-03-10", label: "Y" },
      ],
      domain: ["2026-02-25", "2026-03-15"],
    })}</script></temporeum-timeline>`;
    document.body.append(host);
    const el = host.firstElementChild as TemporeumTimelineElement;
    await drawn(el);
    expect(el.timeline?.getSnapshot().domain).toEqual([Date.parse("2026-02-25"), Date.parse("2026-03-15")]);
    expect(nodeOf(el, "x")).not.toBeNull();
    expect(nodeOf(el, "y")).not.toBeNull();
  });

  it("ignores a broken JSON child and still draws what the attributes say", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<temporeum-timeline style="width:600px" start="2026-01-01" end="2026-02-01"><script type="application/json">{not json</script></temporeum-timeline>`;
    document.body.append(host);
    const el = host.firstElementChild as TemporeumTimelineElement;
    await drawn(el);
    expect(el.timeline?.getSnapshot().domain).toEqual([Date.parse("2026-01-01"), Date.parse("2026-02-01")]);
  });

  it("follows attribute changes, and a removed attribute goes back to the default", async () => {
    const el = await place();
    el.setAttribute("orientation", "vertical");
    el.setAttribute("height", "500");
    await vi.waitFor(() => expect(svgOf(el).getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(el.getBoundingClientRect().height).toBe(500);
    el.removeAttribute("orientation");
    el.removeAttribute("height");
    await vi.waitFor(() => expect(svgOf(el).getAttribute("data-tl-orientation")).toBe("horizontal"));
    expect(el.getBoundingClientRect().height).toBe(300);
    el.setAttribute("density", "dense");
    await vi.waitFor(() => expect(svgOf(el).getAttribute("data-tl-density")).toBe("dense"));
    el.setAttribute("start", String(T0 + 4 * DAY));
    el.setAttribute("end", String(T0 + 8 * DAY));
    await vi.waitFor(() => expect(el.timeline?.getSnapshot().domain).toEqual([T0 + 4 * DAY, T0 + 8 * DAY]));
    el.setAttribute("aria-label", "Projekt");
    await vi.waitFor(() => expect(svgOf(el).getAttribute("aria-label")).toBe("Projekt"));
    // The platform's own property is the attribute's: ARIA reflection.
    el.ariaLabel = "Plan";
    await vi.waitFor(() => expect(svgOf(el).getAttribute("aria-label")).toBe("Plan"));
    // The earlier spelling is not read.
    el.setAttribute("label", "Ignored");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(svgOf(el).getAttribute("aria-label")).toBe("Plan");
  });

  it("keeps two themes apart: the shadow root is the scope", async () => {
    const light = await place((each) => each.setAttribute("theme", "light"));
    const dark = await place((each) => each.setAttribute("theme", "dark"));
    const fill = (el: Element): string => getComputedStyle(svgOf(el).querySelector(".tl-item") ?? svgOf(el)).fill;
    expect(svgOf(light).getAttribute("data-tl-theme")).toBe("light");
    expect(svgOf(dark).getAttribute("data-tl-theme")).toBe("dark");
    expect(fill(light)).not.toBe(fill(dark));
  });

  it("a click selects, and the events reach the page bubbling out of the shadow root", async () => {
    const el = await place();
    const clicks = record<{ item: Item }>(document, "item-click");
    const selections = record<{ ids: string[] }>(document, "selection-changed");
    await userEvent.click(nodeOf(el, "b"));
    await vi.waitFor(() => expect(selections).toHaveLength(1));
    expect(selections[0]?.ids).toEqual(["b"]);
    expect(clicks[0]?.item.id).toBe("b");
    expect(el.selectedIds).toEqual(["b"]);
    await vi.waitFor(() => expect(nodeOf(el, "b").getAttribute("aria-selected")).toBe("true"));
    // A click on nothing clears it.
    const svg = svgOf(el).getBoundingClientRect();
    await userEvent.click(svgOf(el), { position: { x: svg.width - 4, y: svg.height - 4 } });
    await vi.waitFor(() => expect(selections.at(-1)?.ids).toEqual([]));
  });

  it("dispatches every instance event, the items changing included", async () => {
    const el = await place();
    const changed = record<{ items: Item[] }>(document, "items-changed");
    el.items = [{ id: "only", start: T0, end: T0 + DAY }];
    await vi.waitFor(() => expect(changed).toHaveLength(1));
    expect(changed[0]?.items.map((item) => item.id)).toEqual(["only"]);
    expect(TIMELINE_EVENTS).toContain("itemsChanged");
    expect(new Set(TIMELINE_EVENTS).size).toBe(TIMELINE_EVENTS.length);
  });

  it("is a keyboard listbox: arrows move, Enter selects, g asks for a date", async () => {
    const el = await place();
    const selections = record<{ ids: string[] }>(el, "selection-changed");
    const jumps = record<{ time: number }>(el, "jump-request");
    svgOf(el).focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(svgOf(el).getAttribute("aria-activedescendant")).toMatch(/a$/));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(selections.at(-1)?.ids).toEqual(["b"]));
    await userEvent.keyboard("g");
    await vi.waitFor(() => expect(jumps).toHaveLength(1));
    expect(jumps[0]?.time).toBe((domain[0] + domain[1]) / 2);
  });

  it("zooms with Ctrl+wheel around the pointer and reports why", async () => {
    const el = await place();
    const views = record<{ reason: string; viewport: { domain: [number, number] } }>(el, "viewport-changed");
    const at = centre(nodeOf(el, "b"));
    await commands.mouse([
      { type: "move", x: at.x, y: at.y },
      { type: "wheel", deltaY: -240, modifiers: ["Control"] },
    ]);
    await vi.waitFor(() => expect(views.some((view) => view.reason === "zoom")).toBe(true));
    const after = el.timeline?.getSnapshot().domain as readonly [number, number];
    expect(after[1] - after[0]).toBeLessThan(domain[1] - domain[0]);
    // The time under the pointer stayed under the pointer.
    const timeAt = (range: readonly [number, number]): number => range[0] + ((range[1] - range[0]) * at.x) / 800;
    expect(Math.abs(timeAt(after) - timeAt(domain))).toBeLessThan(DAY / 10);
  });

  it("an editable timeline moves an item by drag, shows it, and reports a command the host can undo", async () => {
    const el = await place((each) => {
      each.setAttribute("editable", "");
      each.setAttribute("snap-ms", String(DAY));
    });
    const moved = record<{ item: Item; from: { start: number }; to: { start: number } }>(el, "item-moved");
    const commandsSeen = record<{ command: { after: { id: string; start: number }[]; inverse: unknown } }>(el, "timeline-command");
    // Not the platform's `command` (the Invoker Commands API's CommandEvent).
    const platformCommands = record<unknown>(el, "command");
    const from = centre(nodeOf(el, "a"));
    const before = nodeOf(el, "a").getBoundingClientRect().left;
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(moved).toHaveLength(1));
    expect(moved[0]?.item.id).toBe("a");
    expect(moved[0]?.to.start).toBeGreaterThan(moved[0]?.from.start ?? Infinity);
    // Snapped to whole days.
    expect(((moved[0]?.to.start ?? 1) - T0) % DAY).toBe(0);
    expect(commandsSeen).toHaveLength(1);
    expect(platformCommands).toHaveLength(0);
    await vi.waitFor(() => expect(nodeOf(el, "a").getBoundingClientRect().left).toBeGreaterThan(before + 50));
    // Undo is the inverse, applied.
    el.timeline?.applyCommand(commandsSeen[0]?.command.inverse as Parameters<Timeline["applyCommand"]>[0]);
    await vi.waitFor(() => expect(Math.abs(nodeOf(el, "a").getBoundingClientRect().left - before)).toBeLessThan(1));
  });

  it("a read-only timeline pans on drag instead", async () => {
    const el = await place();
    const views = record<{ reason: string }>(el, "viewport-changed");
    const from = centre(nodeOf(el, "a"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 120, y: from.y, steps: 6 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(views.some((view) => view.reason === "pan")).toBe(true));
    expect(el.timeline?.getSnapshot().domain[0]).toBeLessThan(domain[0]);
  });

  it("opens a cluster on click", async () => {
    const dense: Item[] = Array.from({ length: 40 }, (_, index) => ({ id: `d${String(index)}`, start: T0 + 10 * DAY + index * 60_000, laneId: "l1" }));
    const el = await place((each) => {
      each.items = dense;
      each.setAttribute("cluster", "");
    });
    const opened = record<{ cluster: { members: unknown[] } }>(el, "cluster-opened");
    const marker = (el.shadowRoot as ShadowRoot).querySelector("[data-tl-cluster]") as Element;
    expect(marker).not.toBeNull();
    const at = centre(marker);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "down" }, { type: "up" }]);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.cluster.members).toHaveLength(40);
    await vi.waitFor(() => expect((el.timeline?.getSnapshot().domain[1] ?? 0) - (el.timeline?.getSnapshot().domain[0] ?? 0)).toBeLessThan(domain[1] - domain[0]));
  });

  it("reports orientation and density as `auto` resolves them after a resize", async () => {
    const el = await place((each) => {
      each.setAttribute("orientation", "auto");
      each.setAttribute("breakpoint", "600");
    }, 900);
    const turns = record<{ orientation: string; previous: string }>(el, "orientation-changed");
    el.style.width = "320px";
    await vi.waitFor(() => expect(turns).toEqual([{ orientation: "vertical", previous: "horizontal" }]));
    expect(svgOf(el).getAttribute("data-tl-orientation")).toBe("vertical");
  });

  it("lets go of everything on disconnect, and draws again when put back", async () => {
    const el = await place();
    const first = el.timeline as Timeline;
    el.remove();
    expect(first.destroyed).toBe(true);
    expect(el.timeline).toBeUndefined();
    expect(svgOf(el)).toBeNull();
    document.body.append(el);
    await drawn(el);
    expect(el.timeline).not.toBe(first);
    expect(svgOf(el).querySelectorAll("[role=option]")).toHaveLength(3);
    // The element's stylesheet was not added a second time.
    expect([...(el.shadowRoot as ShadowRoot).children].filter((child) => child.localName === "style")).toHaveLength(1);
  });

  it("takes properties before and after it is connected", async () => {
    const el = await place();
    el.items = [items[0] as Item];
    await vi.waitFor(() => expect(svgOf(el).querySelectorAll("[role=option]")).toHaveLength(1));
    el.selectedIds = ["a"];
    await vi.waitFor(() => expect(nodeOf(el, "a").getAttribute("aria-selected")).toBe("true"));
    el.hooks = { describeItem: (placed) => `Item: ${String(placed.item.label)}` };
    await vi.waitFor(() => expect(nodeOf(el, "a").getAttribute("aria-label")).toBe("Item: Planning"));
    el.lanes = undefined;
    el.hooks = undefined;
    expect(el.items).toHaveLength(1);
    expect(el.lanes).toEqual([]);
    expect(el.config.domain).toEqual(domain);
    el.zoomTo([new Date(T0), T0 + 2 * DAY]);
    await vi.waitFor(() => expect(el.timeline?.getSnapshot().domain).toEqual([T0, T0 + 2 * DAY]));
  });

  it("registers under another name, and twice is harmless", () => {
    defineTimelineElement();
    defineTimelineElement("other-timeline");
    defineTimelineElement("other-timeline");
    expect(customElements.get("temporeum-timeline")).toBe(TemporeumTimelineElement);
    expect(new (customElements.get("other-timeline") as CustomElementConstructor)()).toBeInstanceOf(TemporeumTimelineElement);
  });
});

describe("hydration — the client takes over the server's drawing", () => {
  const config = { items, lanes, domain, height: 260 };

  it("keeps the server's nodes and the focus the reader put on them before the script ran", async () => {
    // Parsed, not created: the declarative shadow root is the parser's.
    const host = document.createElement("div");
    host.style.width = "960px";
    host.setHTMLUnsafe(renderTimelineHtml(config, { tagName: "tl-hydrate-a" }));
    document.body.append(host);
    const el = host.firstElementChild as TemporeumTimelineElement;
    const root = el.shadowRoot as ShadowRoot;
    expect(root).not.toBeNull();
    const svg = root.querySelector("svg") as SVGSVGElement;
    const options = [...root.querySelectorAll("[data-tl-id]")];
    expect(options).toHaveLength(3);
    svg.focus();
    expect(root.activeElement).toBe(svg);
    const removed: Node[] = [];
    new MutationObserver((records) => {
      for (const each of records) removed.push(...each.removedNodes);
    }).observe(root, { childList: true, subtree: true });

    defineTimelineElement("tl-hydrate-a");
    await drawn(el);
    await nextFrame();

    expect(root.querySelector("svg")).toBe(svg);
    expect([...root.querySelectorAll("[data-tl-id]")]).toEqual(options);
    expect(removed.filter((node) => node.nodeName === "svg" || (node instanceof Element && node.hasAttribute("data-tl-id")))).toEqual([]);
    expect(root.activeElement).toBe(svg);
    expect(root.querySelectorAll("svg")).toHaveLength(1);
    expect([...root.children].filter((child) => child.localName === "style")).toHaveLength(1);
    // And it is live: the keyboard works on the adopted nodes.
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(svg.getAttribute("aria-activedescendant")).toMatch(/a$/));
  });

  it("redraws the adopted nodes at the real width, without replacing them", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.setHTMLUnsafe(renderTimelineHtml(config, { tagName: "tl-hydrate-b", width: 960 }));
    document.body.append(host);
    const el = host.firstElementChild as TemporeumTimelineElement;
    const svg = (el.shadowRoot as ShadowRoot).querySelector("svg") as SVGSVGElement;
    const option = nodeOf(el, "b");
    defineTimelineElement("tl-hydrate-b");
    await drawn(el);
    expect((el.shadowRoot as ShadowRoot).querySelector("svg")).toBe(svg);
    expect(svg.getAttribute("width")).toBe("640");
    expect(nodeOf(el, "b")).toBe(option);
  });

  it("with the page's font switched off, the first client frame is the server's frame: not one mutation", async () => {
    const container = document.createElement("div");
    container.style.cssText = "width:960px;height:260px;position:relative";
    const frame = renderTimelineSvg(config);
    container.innerHTML = frame.svg;
    document.body.append(container);
    const svg = container.querySelector("svg");
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    const timeline = createTimeline(container, { ...config, domain: frame.domain }, { hydrate: true, measureText: false });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    await nextFrame();
    mutations.push(...observer.takeRecords());
    expect(container.querySelector("svg")).toBe(svg);
    expect(mutations.map((each) => `${each.type}:${each.attributeName ?? ""}:${(each.target as Element).getAttribute?.("class") ?? ""}`)).toEqual([]);
    timeline.destroy();
  });
});

describe("createTimeline — the instance and its store", () => {
  async function instance(config = {}, width = 800): Promise<{ timeline: Timeline; el: HTMLElement }> {
    const el = document.createElement("div");
    el.style.cssText = `width:${String(width)}px;height:300px;position:relative`;
    document.body.append(el);
    const timeline = createTimeline(el, { items, lanes, domain, ...config });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    return { timeline, el };
  }

  it("notifies at most once per frame, however many events the frame held", async () => {
    const { timeline, el } = await instance();
    let notified = 0;
    const snapshots = new Set<TimelineSnapshot>();
    timeline.subscribe(() => {
      notified += 1;
      snapshots.add(timeline.getSnapshot());
    });
    const box = el.getBoundingClientRect();
    const pointer = (type: string, x: number): void => {
      el.dispatchEvent(
        new PointerEvent(type, { pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: box.left + x, clientY: box.top + 150, bubbles: true }),
      );
    };
    pointer("pointerdown", 400);
    for (let step = 1; step <= 60; step += 1) pointer("pointermove", 400 + step * 2);
    pointer("pointerup", 520);
    await nextFrame();
    await nextFrame();
    // Sixty-two events, one frame: one notification.
    expect(notified).toBe(1);
    expect(snapshots.size).toBe(1);
    expect(timeline.getSnapshot().domain[0]).toBeLessThan(domain[0]);
    timeline.destroy();
  });

  it("keeps the snapshot's identity while nothing in it changed", async () => {
    const { timeline } = await instance();
    const before = timeline.getSnapshot();
    timeline.update({ ariaLabel: "Another name" });
    timeline.flush();
    expect(timeline.getSnapshot()).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    timeline.select(["c"]);
    timeline.flush();
    expect(timeline.getSnapshot()).not.toBe(before);
    expect(timeline.getSnapshot().selectedIds).toEqual(["c"]);
    timeline.destroy();
  });

  it("zoomTo, zoomBy and scrollTo move the view and say it was the API", async () => {
    const { timeline } = await instance();
    const reasons: string[] = [];
    timeline.on("viewportChanged", ({ reason }) => reasons.push(reason));
    timeline.zoomTo([T0 + 4 * DAY, T0 + 12 * DAY]);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 4 * DAY, T0 + 12 * DAY]);
    timeline.zoomBy(2, T0 + 8 * DAY);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 6 * DAY, T0 + 10 * DAY]);
    timeline.zoomBy(0.5);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 4 * DAY, T0 + 12 * DAY]);
    timeline.scrollTo(T0 + 20 * DAY);
    await vi.waitFor(() => {
      const [start, end] = timeline.getSnapshot().domain;
      expect((start + end) / 2).toBeCloseTo(T0 + 20 * DAY, -3);
    });
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    expect(reasons.every((reason) => reason === "api")).toBe(true);
    timeline.destroy();
  });

  it("emits layoutChanged when the items change, and exports a standalone SVG", async () => {
    const { timeline } = await instance();
    const layouts: number[] = [];
    timeline.on("layoutChanged", ({ visibleItemCount }) => layouts.push(visibleItemCount));
    timeline.setItems([...items, { id: "d", start: T0 + 22 * DAY, label: "New", laneId: "l2" }]);
    timeline.flush();
    expect(layouts).toEqual([4]);
    expect(timeline.layout?.items).toHaveLength(4);
    const svg = timeline.exportSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("[data-tl-id]")).toHaveLength(4);
    timeline.destroy();
    expect(timeline.exportSvg()).toContain("<svg");
  });

  it("fetches a windowed source and reports when it is busy", async () => {
    // Every window waits for the same gate: the overscan the loader asks
    // for next is answered as soon as the first one is.
    let resolve: () => void = () => {};
    const gate = new Promise<void>((done) => (resolve = done));
    const source = async (): Promise<readonly Item[]> => {
      await gate;
      return items;
    };
    const { timeline, el } = await instance({ items: source });
    expect(el.querySelectorAll("[data-tl-id]")).toHaveLength(0);
    expect(timeline.getSnapshot().busy).toBe(true);
    resolve();
    await vi.waitFor(() => expect(el.querySelectorAll("[data-tl-id]")).toHaveLength(3));
    await vi.waitFor(() => expect(timeline.getSnapshot().busy).toBe(false));
    // Back to an array: the loader is let go.
    timeline.setItems([items[0] as Item]);
    timeline.flush();
    expect(el.querySelectorAll("[data-tl-id]")).toHaveLength(1);
    timeline.destroy();
  });

  it("a drag the browser cancels puts the item back; a vetoed one stops where the rule allows", async () => {
    const limit = T0 + 4 * DAY;
    const { timeline, el } = await instance({ editing: { enabled: true, canMove: (_item: Item, next: { start?: number }) => (next.start ?? 0) < limit } });
    const moved: { id: string; start: number }[] = [];
    timeline.on("itemMoved", ({ item, to }) => moved.push({ id: item.id, start: to.start ?? NaN }));
    let pointerId = -1;
    el.addEventListener("pointerdown", (event) => (pointerId = event.pointerId));
    const node = el.querySelector('[data-tl-id="a"]') as Element;
    const at = centre(node);
    const before = node.getBoundingClientRect().left;
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "down" }, { type: "move", x: at.x + 40, y: at.y, steps: 4 }]);
    await vi.waitFor(() => expect(timeline.getSnapshot().editing).toBe(true));
    // The browser taking the pointer away — a system gesture, a context menu.
    // A released capture is lost at the pointer's next event (Pointer Events
    // spec: pending capture is processed before the next dispatch): a nudge
    // of the still-held button. Before rc.2 an exact frame's node churn under
    // the pointer made Chrome send one by itself; a scene space keeps the
    // nodes, so nothing does.
    el.releasePointerCapture(pointerId);
    await commands.mouse([{ type: "move", x: at.x + 41, y: at.y }]);
    await vi.waitFor(() => expect(timeline.getSnapshot().editing).toBe(false));
    await commands.mouse([{ type: "up" }]);
    timeline.flush();
    expect(Math.abs((el.querySelector('[data-tl-id="a"]') as Element).getBoundingClientRect().left - before)).toBeLessThan(1);
    expect(moved).toEqual([]);

    // Now past the rule: the item follows only as far as `canMove` allows.
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "down" }, { type: "move", x: at.x + 200, y: at.y, steps: 8 }, { type: "up" }]);
    await vi.waitFor(() => expect(moved).toHaveLength(1));
    expect(moved[0]?.start).toBeLessThan(limit);
    timeline.destroy();
  });

  it("recreates its machine when the interaction rules change, keeping the view and the selection", async () => {
    const { timeline, el } = await instance({ selectedIds: ["b"] });
    timeline.zoomTo([T0 + 2 * DAY, T0 + 14 * DAY]);
    timeline.update({ editing: { enabled: true }, interactions: { pan: false } });
    timeline.flush();
    expect(timeline.getSnapshot().selectedIds).toEqual(["b"]);
    expect(timeline.getSnapshot().domain).toEqual([T0 + 2 * DAY, T0 + 14 * DAY]);
    // Pan is off: a drag on empty ground leaves the view where it is.
    const box = el.getBoundingClientRect();
    await commands.mouse([{ type: "move", x: box.left + 700, y: box.top + 280 }, { type: "down" }, { type: "move", x: box.left + 500, y: box.top + 280, steps: 5 }, { type: "up" }]);
    await nextFrame();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 2 * DAY, T0 + 14 * DAY]);
    timeline.update({ domain: [T0, T0 + DAY], selectedIds: [] });
    timeline.flush();
    expect(timeline.getSnapshot()).toMatchObject({ domain: [T0, T0 + DAY], selectedIds: [] });
    timeline.destroy();
    timeline.destroy();
    timeline.update({ ariaLabel: "x" });
    expect(timeline.destroyed).toBe(true);
    expect(el.querySelector("svg")).toBeNull();
  });

  it("emits itemDblClick on a double click and toggles a multi-selection", async () => {
    const { timeline, el } = await instance({ editing: { enabled: false, multiSelect: true } });
    const doubles: string[] = [];
    timeline.on("itemDblClick", ({ item }) => doubles.push(item.id));
    await userEvent.click(el.querySelector('[data-tl-id="a"]') as Element);
    await userEvent.click(el.querySelector('[data-tl-id="c"]') as Element, { delay: 400 } as never);
    await vi.waitFor(() => expect(timeline.getSnapshot().selectedIds).toEqual(["a", "c"]));
    await new Promise((done) => setTimeout(done, 400));
    await userEvent.click(el.querySelector('[data-tl-id="a"]') as Element);
    await vi.waitFor(() => expect(timeline.getSnapshot().selectedIds).toEqual(["c"]));
    await new Promise((done) => setTimeout(done, 400));
    await userEvent.dblClick(el.querySelector('[data-tl-id="b"]') as Element);
    await vi.waitFor(() => expect(doubles).toEqual(["b"]));
    timeline.destroy();
  });

  it("measures labels with a real font, and the server's estimate stays an estimate", async () => {
    const long = [{ id: "w", start: T0 + 2 * DAY, end: T0 + 9 * DAY, label: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii", laneId: "l1" }].map((item) => ({ ...item, end: T0 + 6 * DAY }));
    const measured = await instance({ items: long });
    const estimated = renderTimelineSvg({ items: long, lanes, domain }, { width: 800 });
    // A run of narrow letters is far narrower than the average advance the
    // estimate assumes: the measured box is the font's, the estimate's is not.
    const box = (label: { box: { mainSize: number } } | undefined): number => label?.box.mainSize ?? NaN;
    const real = box(measured.timeline.result?.labels.kept[0]);
    const guess = box(estimated.result.labels.kept[0]);
    expect(real).toBeLessThan(guess);
    // The box is the text plus the label's padding on both sides; the text
    // is what the browser itself lays out for the drawn label — a line of
    // HTML in a foreignObject, so its text node's own extent.
    const padding = 2 * densityMetrics("comfortable", "horizontal").labelPadding;
    const line = measured.el.querySelector(".tl-label > div")?.firstChild as Node;
    const range = document.createRange();
    range.selectNodeContents(line);
    const drawnText = range.getBoundingClientRect().width;
    expect(Math.abs(real - padding - drawnText)).toBeLessThan(0.5);
    measured.timeline.destroy();
  });

  it("[claim:text-spacing] measures labels with the reader's text spacing (1.4.12), and again when it comes and when it goes — in the page and in the element's shadow root", async () => {
    // WCAG's override, as the Understanding document's bookmarklet applies it.
    const spacing = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }";
    const spaced = [{ id: "s", start: T0 + 2 * DAY, end: T0 + 12 * DAY, label: "Plan the work", laneId: "l1" }];
    const padding = 2 * densityMetrics("comfortable", "horizontal").labelPadding;
    const light = await instance({ items: spaced });
    const host = await place((el) => {
      el.items = spaced;
    });
    const cases = [
      { name: "page", root: light.el as ParentNode, result: () => light.timeline.result },
      { name: "shadow root", root: host.shadowRoot as ParentNode, result: () => host.timeline?.result },
    ];
    /** The label's box, its text as the browser lays it out, and whether it was shortened. */
    const seen = (at: (typeof cases)[number]) => {
      const kept = at.result()?.labels.kept.find((label) => label.id === "s");
      const range = document.createRange();
      range.selectNodeContents(at.root.querySelector(".tl-label > div")?.firstChild as Node);
      return { box: (kept?.box.mainSize ?? NaN) - padding, text: range.getBoundingClientRect().width, shortened: kept?.shortened === true };
    };
    const plain = cases.map(seen);
    const style = document.createElement("style");
    style.textContent = spacing;
    document.head.append(style);
    for (const [index, at] of cases.entries()) {
      // No resize, no call: the spacing itself makes the timeline draw again.
      await vi.waitFor(() => expect(seen(at).box).toBeGreaterThan((plain[index]?.box ?? NaN) + 10));
      const now = seen(at);
      // The box holds the text as drawn, whole: it is not shortened, and is at
      // most a pixel wider than the text.
      expect(now.shortened, at.name).toBe(false);
      expect(now.box - now.text, at.name).toBeGreaterThanOrEqual(-0.5);
      expect(now.box - now.text, at.name).toBeLessThan(1.5);
    }
    style.remove();
    for (const [index, at] of cases.entries()) {
      await vi.waitFor(() => expect(Math.abs(seen(at).box - (plain[index]?.box ?? NaN))).toBeLessThan(0.5));
    }
    light.timeline.destroy();
  });

  it("forwards limits and interaction rules to the machine", async () => {
    const { timeline, el } = await instance({
      limits: { min: T0, max: T0 + 30 * DAY, minSpanMs: DAY },
      interactions: { zoom: false, dragThreshold: 6, moveTrigger: "handle", longPressMs: 300 },
    });
    // Zoom is off: Ctrl+wheel does nothing to the span.
    const at = centre(el.querySelector('[data-tl-id="b"]') as Element);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "wheel", deltaY: -240, modifiers: ["Control"] }]);
    await nextFrame();
    expect(timeline.getSnapshot().domain).toEqual(domain);
    // The limits hold for the API too.
    timeline.zoomTo([T0 - 10 * DAY, T0 - 9 * DAY]);
    timeline.flush();
    expect(timeline.getSnapshot().domain[0]).toBeGreaterThanOrEqual(T0);
    expect(timeline.getSnapshot().domain[1] - timeline.getSnapshot().domain[0]).toBeGreaterThanOrEqual(DAY);
    timeline.destroy();
  });

  it("carries an item into another lane when crossLane is on, and restores an instant without a lane exactly", async () => {
    const mixed: Item[] = [
      { id: "m", start: T0 + 3 * DAY, end: T0 + 7 * DAY, label: "Moving", laneId: "l1" },
      { id: "p", start: T0 + 12 * DAY, label: "Instant" },
    ];
    const { timeline, el } = await instance({ items: mixed, lanes: undefined, editing: { enabled: true, crossLane: true } });
    timeline.update({ lanes: [...lanes, { id: DEFAULT_LANE_ID, label: "Other" }] });
    timeline.flush();
    const moved: { id: string; laneId: string | null | undefined }[] = [];
    timeline.on("itemMoved", ({ item, to }) => moved.push({ id: item.id, laneId: to.laneId }));
    const from = centre(el.querySelector('[data-tl-id="m"]') as Element);
    const target = centre([...el.querySelectorAll("[data-tl-lane]")].find((lane) => lane.getAttribute("data-tl-lane") === "l2") as Element);
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x, y: target.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(moved).toEqual([{ id: "m", laneId: "l2" }]));

    // A cancelled drag of an instant that has no lane: back to exactly that.
    let pointerId = -1;
    el.addEventListener("pointerdown", (event) => (pointerId = event.pointerId));
    const instant = centre(el.querySelector('[data-tl-id="p"]') as Element);
    await commands.mouse([{ type: "move", x: instant.x, y: instant.y }, { type: "down" }, { type: "move", x: instant.x + 60, y: instant.y, steps: 4 }]);
    await vi.waitFor(() => expect(timeline.getSnapshot().editing).toBe(true));
    el.releasePointerCapture(pointerId);
    await commands.mouse([{ type: "up" }]);
    timeline.flush();
    const placed = timeline.layout?.items.find((each) => each.item.id === "p");
    expect(placed?.item.start).toBe(T0 + 12 * DAY);
    expect(placed?.item.end).toBeUndefined();
    expect(placed?.item.laneId).toBeUndefined();
    timeline.destroy();
  });

  it("an edit on a fetched source goes into the loader", async () => {
    const { timeline, el } = await instance({ items: () => Promise.resolve(items), editing: { enabled: true } });
    await vi.waitFor(() => expect(el.querySelectorAll("[data-tl-id]")).toHaveLength(3));
    const moved: number[] = [];
    timeline.on("itemMoved", ({ to }) => moved.push(to.start ?? NaN));
    const from = centre(el.querySelector('[data-tl-id="c"]') as Element);
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x - 80, y: from.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(moved).toHaveLength(1));
    timeline.flush();
    expect(timeline.layout?.items.find((each) => each.item.id === "c")?.item.start).toBe(moved[0]);
    timeline.destroy();
  });

  it("Enter on a cluster opens it like a tap; selecting what is selected says nothing", async () => {
    const dense: Item[] = Array.from({ length: 30 }, (_, index) => ({ id: `k${String(index)}`, start: T0 + 8 * DAY + index * 60_000, laneId: "l1" }));
    const { timeline, el } = await instance({ items: dense, cluster: true });
    const opened: number[] = [];
    timeline.on("clusterOpened", ({ cluster }) => opened.push(cluster.members.length));
    (el.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el.querySelector("svg")?.getAttribute("aria-activedescendant")).toMatch(/-c-/));
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(opened).toEqual([30]));
    const changes: unknown[] = [];
    timeline.on("selectionChanged", (payload) => changes.push(payload));
    timeline.select(["k1"]);
    timeline.select(["k1"]);
    expect(changes).toHaveLength(1);
    timeline.destroy();
    // A frame asked for after destroy draws nothing and throws nothing.
    timeline.flush();
  });
});

describe("createTimeline — a large timeline draws in a scene space", () => {
  // 1200 items, one every 2.4 hours, half a day long: five rows. The view is
  // 30 of the 120 days, so ~300 items are on screen.
  const many: Item[] = Array.from({ length: 1200 }, (_, index) => ({
    id: `m${String(index)}`,
    start: T0 + (index * DAY) / 10,
    end: T0 + (index * DAY) / 10 + DAY / 2,
    label: `M${String(index)}`,
  }));
  const view: [number, number] = [T0 + 30 * DAY, T0 + 60 * DAY];

  async function large(config: Parameters<typeof createTimeline>[1] = {}): Promise<{ timeline: Timeline; el: HTMLElement }> {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:300px;position:relative";
    document.body.append(el);
    const timeline = createTimeline(el, { items: many, domain: view, ...config });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    // At rest the space grows into its overscan a strip per frame.
    for (let frame = 0; frame < 12; frame += 1) await nextFrame();
    return { timeline, el };
  }

  /** Drag the view 60 px to the left, and every mutation the drag caused. */
  async function pan(el: HTMLElement): Promise<MutationRecord[]> {
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(el, { subtree: true, childList: true, attributes: true });
    const box = el.getBoundingClientRect();
    const y = box.top + box.height / 2;
    await commands.mouse([
      { type: "move", x: box.left + 500, y },
      { type: "down" },
      { type: "move", x: box.left + 440, y, steps: 6 },
      { type: "up" },
    ]);
    for (let frame = 0; frame < 4; frame += 1) await nextFrame();
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    return mutations;
  }

  /** Items on screen before and after the pan whose node had an attribute rewritten. */
  const itemWrites = (mutations: readonly MutationRecord[]): string[] => {
    const onScreen = new Set(
      many.filter((item) => (item.end as number) > view[0] + 3 * DAY && (item.start as number) < view[1] - 3 * DAY).map((item) => item.id),
    );
    return mutations
      .filter((each) => each.type === "attributes" && onScreen.has((each.target as Element).getAttribute("data-tl-id") ?? ""))
      .map((each) => `${(each.target as Element).getAttribute("data-tl-id") ?? ""}:${each.attributeName ?? ""}`);
  };

  it("a pan inside what is drawn rewrites no item on screen — only the layers' transforms", async () => {
    const { timeline, el } = await large();
    expect(el.querySelector(".tl-tile")).not.toBeNull();
    const kept = el.querySelector('[data-tl-id="m400"]');
    expect(kept).not.toBeNull();
    const mutations = await pan(el);
    expect(timeline.getSnapshot().domain[0]).toBeGreaterThan(view[0]);
    expect(itemWrites(mutations)).toEqual([]);
    expect(mutations.some((each) => each.attributeName === "transform")).toBe(true);
    expect(el.querySelector('[data-tl-id="m400"]')).toBe(kept);
    timeline.destroy();
  });

  it("a run of wheel zoom steps stretches the space instead of redrawing per notch, and is exact when it ends", async () => {
    const { timeline, el } = await large();
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(el, { subtree: true, childList: true, attributes: true });
    const box = el.getBoundingClientRect();
    const at = { x: box.left + 400, y: box.top + 150 };
    // Three notches of 1.1x: within the space's 1.5x stretch.
    await commands.mouse([
      { type: "move", x: at.x, y: at.y },
      { type: "wheel", deltaY: -20, modifiers: ["Control"] },
      { type: "wheel", deltaY: -20, modifiers: ["Control"] },
      { type: "wheel", deltaY: -20, modifiers: ["Control"] },
    ]);
    await nextFrame();
    await nextFrame();
    mutations.push(...observer.takeRecords());
    const zoomed = timeline.getSnapshot().domain;
    expect(zoomed[1] - zoomed[0]).toBeLessThan(view[1] - view[0]);
    expect(itemWrites(mutations)).toEqual([]);
    // When the run has ended, the frame is exact again: re-anchored, every item rewritten.
    await new Promise((done) => setTimeout(done, 400));
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    expect(new Set(itemWrites(mutations).map((write) => write.split(":")[0])).size).toBeGreaterThan(100);
    timeline.destroy();
  });

  it("NEGATIVE CONTROL: with sceneSpace false the same pan rewrites every item on screen", async () => {
    const { timeline, el } = await large({ sceneSpace: false });
    expect(el.querySelector(".tl-tile")).toBeNull();
    const mutations = await pan(el);
    expect(new Set(itemWrites(mutations).map((write) => write.split(":")[0])).size).toBeGreaterThan(200);
    timeline.destroy();
  });

  it("draws only the view until the reader touches it; the first input fills the overscan", async () => {
    const { timeline, el } = await large();
    const untouched = el.querySelectorAll("[data-tl-id]").length;
    expect(untouched).toBeLessThan(timeline.getSnapshot().visibleCount + 30);
    await pan(el);
    for (let frame = 0; frame < 12; frame += 1) await nextFrame();
    expect(el.querySelectorAll("[data-tl-id]").length).toBeGreaterThan(untouched + 200);
    timeline.destroy();
  });

  it("counts the items in the view, not what is drawn ahead in the overscan", async () => {
    const { timeline, el } = await large();
    const exact = await large({ sceneSpace: false });
    // The same drag on both: the same view, and the space's overscan filled.
    await pan(el);
    await pan(exact.el);
    for (let frame = 0; frame < 12; frame += 1) await nextFrame();
    expect(timeline.getSnapshot().domain).toEqual(exact.timeline.getSnapshot().domain);
    const [from, to] = timeline.getSnapshot().domain;
    const visible = timeline.getSnapshot().visibleCount;
    const inView = many.filter((item) => (item.end as number) > from && (item.start as number) < to).length;
    expect(visible).toBeGreaterThanOrEqual(inView);
    // The same count as an exact frame's, culling margin and all.
    expect(visible).toBe(exact.timeline.getSnapshot().visibleCount);
    expect(el.querySelectorAll("[data-tl-id]").length).toBeGreaterThan(visible + 100);
    timeline.destroy();
    exact.timeline.destroy();
  });

  it("exports the view exactly, without the overscan", async () => {
    const spaced = await large();
    const exact = await large({ sceneSpace: false });
    expect(spaced.timeline.exportSvg()).toBe(exact.timeline.exportSvg());
    spaced.timeline.destroy();
    exact.timeline.destroy();
  });

  it("draws a small timeline in a space too, with the exact frame's labels at rest; false draws exact", async () => {
    // Until rc.2 "auto" drew exact below 1000 items: a space at rest could
    // drop a label an exact frame keeps. It no longer can (the core's
    // G-REST-LABELS property), so the threshold is gone.
    const box = (): HTMLElement => {
      const el = document.createElement("div");
      el.style.cssText = "width:800px;height:300px;position:relative";
      return document.body.appendChild(el);
    };
    const small = createTimeline(box(), { items, lanes, domain });
    const forced = createTimeline(box(), { items, lanes, domain, sceneSpace: true });
    const exact = createTimeline(box(), { items, lanes, domain, sceneSpace: false });
    await vi.waitFor(() =>
      expect(small.result !== undefined && forced.result !== undefined && exact.result !== undefined).toBe(true),
    );
    expect(JSON.stringify(small.result?.scene)).toContain("tl-tile");
    expect(JSON.stringify(forced.result?.scene)).toContain("tl-tile");
    expect(JSON.stringify(exact.result?.scene)).not.toContain("tl-tile");
    const ids = (timeline: Timeline): string[] => (timeline.result?.labels.kept ?? []).map((label) => label.id).sort();
    expect(ids(small)).toEqual(ids(exact));
    expect(ids(exact).length).toBeGreaterThan(0);
    small.destroy();
    forced.destroy();
    exact.destroy();
  });

  it("the server draws a large timeline in the same space, and the client takes its nodes over", async () => {
    const container = document.createElement("div");
    container.style.cssText = "width:960px;height:300px;position:relative";
    const frame = renderTimelineSvg({ items: many, domain: view });
    expect(frame.svg).toContain("tl-tile");
    container.innerHTML = frame.svg;
    document.body.append(container);
    const svg = container.querySelector("svg");
    const server = [...container.querySelectorAll("[data-tl-id]")];
    expect(server.length).toBeGreaterThan(200);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    const timeline = createTimeline(container, { items: many, domain: frame.domain }, { hydrate: true, measureText: false });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    for (let each = 0; each < 12; each += 1) await nextFrame();
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    // Untouched, it is the server's frame and stays it: not one mutation.
    expect(container.querySelector("svg")).toBe(svg);
    expect(mutations.length).toBe(0);
    // Touched, the overscan grows around the server's nodes, and every one
    // still in view is still the node for its item. (When a tile stops being
    // the first, the core may reorder its children — a move, not a new node.)
    await pan(container);
    for (let each = 0; each < 12; each += 1) await nextFrame();
    expect(container.querySelectorAll("[data-tl-id]").length).toBeGreaterThan(server.length + 200);
    const [from, to] = timeline.getSnapshot().domain;
    const stillInView = server.filter((node) => {
      const item = many.find((each) => each.id === node.getAttribute("data-tl-id"));
      return item !== undefined && (item.end as number) > from && (item.start as number) < to;
    });
    expect(stillInView.length).toBeGreaterThan(200);
    for (const node of stillInView) {
      expect(container.querySelector(`[data-tl-id="${node.getAttribute("data-tl-id") ?? ""}"]`)).toBe(node);
    }
    timeline.destroy();
  });
});

describe("createTimeline — core options the configuration passes on", () => {
  it("formatTick writes the axis labels", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:300px;position:relative";
    document.body.append(el);
    const timeline = createTimeline(el, { items, lanes, domain, formatTick: (tick) => `T${String(tick.time - T0)}` });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    const labels = [...el.querySelectorAll(".tl-tick-label")].map((node) => node.textContent ?? "");
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label).toMatch(/^T-?\d+$/);
    timeline.destroy();
  });

  it("touchAction reaches the stylesheet and the input machine, and update() switches it", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:300px;position:relative";
    document.body.append(el);
    const timeline = createTimeline(el, { items, lanes, domain, touchAction: "cooperative" });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    expect(el.querySelector("style")?.textContent).toContain("touch-action:pan-y");
    // A plain wheel over a cooperative timeline is the page's scroll, not a pan.
    const at = centre(el.querySelector('[data-tl-id="b"]') as Element);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "wheel", deltaY: 240 }]);
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();
    expect(timeline.getSnapshot().domain).toEqual(domain);
    timeline.update({ touchAction: "own" });
    timeline.flush();
    expect(el.querySelector("style")?.textContent).toContain("touch-action:none");
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "wheel", deltaY: 240 }]);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain[0]).not.toBe(domain[0]));
    timeline.destroy();
  });

  async function editable(editing: Record<string, unknown>): Promise<{ timeline: Timeline; el: HTMLElement }> {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:300px;position:relative";
    document.body.append(el);
    const timeline = createTimeline(el, { items, lanes, domain, editing: { enabled: true, ...editing } });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    return { timeline, el };
  }

  it("maxLabels caps the drawn labels", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:300px;position:relative";
    document.body.append(el);
    const timeline = createTimeline(el, { items, lanes, domain, maxLabels: 1 });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    expect(timeline.result?.labels.kept).toHaveLength(1);
    expect(el.querySelectorAll(".tl-label")).toHaveLength(1);
    timeline.destroy();
  });

  it("editing.snapOrigin anchors the snap grid", async () => {
    const origin = T0 + DAY / 2;
    const { timeline, el } = await editable({ snapMs: DAY, snapOrigin: origin });
    const moved: number[] = [];
    timeline.on("itemMoved", (payload) => moved.push(payload.item.start as number));
    const from = centre(el.querySelector('[data-tl-id="a"]') as Element);
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(moved).toHaveLength(1));
    expect(((moved[0] ?? 1) - origin) % DAY).toBe(0);
    timeline.destroy();
  });

  it("editing.minDurationMs stops a resize from squashing an item", async () => {
    const { timeline, el } = await editable({ minDurationMs: 2 * DAY });
    const resized: number[] = [];
    // The item as it is after the edit.
    timeline.on("itemResized", (payload) => resized.push((payload.item.end as number) - (payload.item.start as number)));
    const box = (el.querySelector('[data-tl-id="a"]') as Element).getBoundingClientRect();
    const y = box.top + box.height / 2;
    await commands.mouse([
      { type: "move", x: box.right - 2, y },
      { type: "down" },
      { type: "move", x: box.left - 40, y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(resized).toHaveLength(1));
    expect(resized[0]).toBe(2 * DAY);
    timeline.destroy();
  });

  it("the element reads touch-action from its attribute", async () => {
    const el = await place((each) => each.setAttribute("touch-action", "cooperative"));
    expect(svgOf(el).querySelector("style")?.textContent).toContain("touch-action:pan-y");
    el.setAttribute("touch-action", "nonsense");
    el.timeline?.flush();
    expect(svgOf(el).querySelector("style")?.textContent).toContain("touch-action:none");
  });
});
