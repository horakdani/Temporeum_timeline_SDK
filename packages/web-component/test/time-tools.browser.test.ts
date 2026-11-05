import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item, Lane } from "@temporeum/timeline-core";

import { createTimeline, registerPlugin, renderTimelineSvg, TIMELINE_EVENTS } from "../src/index.js";
import type { Timeline, TimelineConfig } from "../src/index.js";
import { mountToolsLayer } from "../src/tools/layer.js";
import { toolsPlugin } from "../src/tools.js";

// The parts on entry points of their own, as a page registers them.
registerPlugin(toolsPlugin);

/**
 * The time tools through the live instance, in a real Chromium: hidden dates through
 * the machine and the renderer, a time bar dragged and keyed, the overview
 * strip's window dragged, pressed beside and keyed, a range dragged and
 * keyed, the zoom presets, the sticky lane headers, the tooltip, the clock
 * the view follows, live data against a full reload — and a server frame
 * with hidden dates and the strip taken over node for node.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 5);
const lanes: Lane[] = [
  { id: "a", label: "Ann" },
  { id: "b", label: "Bob" },
];
const items: Item[] = [
  { id: "one", label: "One", start: T0 + 9 * HOUR, end: T0 + DAY + 12 * HOUR, laneId: "a" },
  { id: "two", label: "Two", start: T0 + DAY + 13 * HOUR, end: T0 + 3 * DAY + 11 * HOUR, laneId: "a" },
  { id: "three", label: "Three", start: T0 + 2 * DAY + 9 * HOUR, end: T0 + 3 * DAY + 16 * HOUR, laneId: "b" },
];
const hiddenDates = [{ start: T0 + 17 * HOUR, end: T0 + DAY + 8 * HOUR, repeat: "daily" as const }];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function mount(config: Partial<TimelineConfig> = {}, width = 1000, height = 360): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:${String(height)}px;position:relative`;
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain: [T0 + 8 * HOUR, T0 + 4 * DAY + 17 * HOUR], height, timeZone: "UTC", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [role=option]") === null) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const centre = (node: Element): { x: number; y: number } => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

describe("hidden dates in the instance", () => {
  it("draws the axis in shown time, pans by it with the wheel, and draws exactly", async () => {
    const { element, timeline } = await mount({ hiddenDates });
    expect(element.querySelector("svg")?.outerHTML).not.toMatch(/NaN|Infinity/);
    // Drawn exactly: no scene space with hidden dates.
    expect(element.querySelector(".tl-layer--items")?.getAttribute("transform") ?? null).toBeNull();
    const before = timeline.getSnapshot().domain;
    const svg = element.querySelector("svg") as SVGSVGElement;
    const at = centre(svg);
    svg.dispatchEvent(new WheelEvent("wheel", { clientX: at.x, clientY: at.y, deltaX: 200, deltaY: 0, bubbles: true, cancelable: true }));
    timeline.flush();
    const after = timeline.getSnapshot().domain;
    expect(after[0]).toBeGreaterThan(before[0]);
    timeline.update({ hiddenDates: undefined });
    timeline.flush();
    expect(element.querySelector("svg")?.outerHTML).not.toMatch(/NaN/);
    timeline.destroy();
  });
});

describe("time bars", () => {
  it("moves a bar by a drag and by a key, keeps it there, and says so once each", async () => {
    const moved = vi.fn();
    const { element, timeline } = await mount({ timeBars: [{ id: "cut", time: T0 + DAY + 12 * HOUR, label: "Cut-off" }, { id: "fixed", time: T0 + 2 * DAY + 12 * HOUR, movable: false }], timeBarOptions: { snapMs: HOUR } });
    timeline.on("timeBarMoved", moved);
    const grip = element.querySelector('[data-tl-timebar="cut"] .tl-timebar-grip') as HTMLElement;
    expect(grip.getAttribute("role")).toBe("slider");
    expect(grip.getAttribute("aria-valuetext")).toContain("2026");
    const from = centre(grip);
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x + 80, y: from.y, steps: 5 }, { type: "up" }]);
    await vi.waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const first = moved.mock.calls[0]?.[0] as { id: string; time: number; previous: number };
    expect(first.id).toBe("cut");
    expect(first.time % HOUR).toBe(0);
    expect(timeline.timeBars[0]?.time).toBe(first.time);
    grip.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(moved).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{End}");
    expect(moved).toHaveBeenCalledTimes(3);
    // The fixed bar does not move, and says it cannot.
    const fixed = element.querySelector('[data-tl-timebar="fixed"] .tl-timebar-grip') as HTMLElement;
    expect(fixed.getAttribute("aria-disabled")).toBe("true");
    fixed.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(moved).toHaveBeenCalledTimes(3);
    // New bars from the host replace the reader's.
    timeline.update({ timeBars: [] });
    timeline.flush();
    expect(element.querySelectorAll(".tl-timebar")).toHaveLength(0);
    timeline.destroy();
  });
});

describe("the overview strip", () => {
  it("draws the strip under the frame, and pans the view by a drag of its window, a press beside it and its keys", async () => {
    const viewport = vi.fn();
    const { element, timeline } = await mount({ minimap: { size: 40 } });
    timeline.on("viewportChanged", viewport);
    const svg = element.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("height")).toBe("360");
    expect(element.querySelector(".tl-surface")?.getAttribute("height")).toBe("320");
    const handle = element.querySelector(".tl-minimap-handle") as HTMLElement;
    const start = timeline.getSnapshot().domain;
    const at = centre(handle);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }, { type: "down" }, { type: "move", x: at.x + 60, y: at.y, steps: 4 }, { type: "up" }]);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain[0]).toBeGreaterThan(start[0]));
    const dragged = timeline.getSnapshot().domain;
    // The span is the view's: a drag pans, it does not zoom.
    expect(dragged[1] - dragged[0]).toBeCloseTo(start[1] - start[0], -2);
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    timeline.flush();
    expect(timeline.getSnapshot().domain[0]).toBeLessThan(dragged[0]);
    await userEvent.keyboard("{Home}");
    timeline.flush();
    const strip = element.querySelector(".tl-minimap-hit") as HTMLElement;
    const box = strip.getBoundingClientRect();
    await commands.mouse([{ type: "move", x: box.right - 4, y: box.top + box.height / 2 }, { type: "down" }, { type: "up" }]);
    timeline.flush();
    expect(viewport.mock.calls.some(([payload]) => (payload as { reason: string }).reason === "pan")).toBe(true);
    timeline.update({ minimap: false });
    timeline.flush();
    expect(element.querySelector("[data-tl-minimap]")).toBeNull();
    timeline.destroy();
  });

  it("runs down the right edge of a vertical timeline", async () => {
    const { element, timeline } = await mount({ minimap: true, orientation: "vertical" }, 500, 700);
    expect(element.querySelector(".tl-surface")?.getAttribute("width")).toBe(String(500 - 36));
    expect(element.querySelector(".tl-minimap-handle")?.getAttribute("aria-orientation")).toBe("vertical");
    timeline.destroy();
  });
});

describe("range selection", () => {
  it("selects a range by a drag along the axis band and by r, an arrow and Enter — and lets one go with Escape", async () => {
    const selected = vi.fn();
    const { element, timeline } = await mount({ rangeSelect: { snapMs: HOUR, stepMs: 2 * HOUR } });
    timeline.on("rangeSelected", selected);
    const band = (element.querySelector(".tl-range-hit") as HTMLElement).getBoundingClientRect();
    const y = band.top + band.height / 2;
    await commands.mouse([{ type: "move", x: band.left + 200, y }, { type: "down" }, { type: "move", x: band.left + 420, y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1));
    const range = selected.mock.calls[0]?.[0] as { start: number; end: number };
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.start % HOUR).toBe(0);
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("r{ArrowRight}{ArrowRight}{Enter}");
    expect(selected).toHaveBeenCalledTimes(2);
    const keyed = selected.mock.calls[1]?.[0] as { start: number; end: number };
    expect(keyed.end - keyed.start).toBe(4 * HOUR);
    // While a range is picked the arrows are its: the view does not pan.
    const domain = timeline.getSnapshot().domain;
    await userEvent.keyboard("r{PageDown}");
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual(domain);
    expect((element.querySelector(".tl-range") as HTMLElement).hidden).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(selected).toHaveBeenCalledTimes(2);
    timeline.update({ rangeSelect: false });
    timeline.flush();
    expect(element.querySelector(".tl-range-hit")).toBeNull();
    timeline.destroy();
  });
});

describe("zoom presets and lane headers", () => {
  it("zooms to a preset by a button and by zoomToPreset, and holds the lane names at the view's start", async () => {
    const { element, timeline } = await mount({ zoomPresets: true, laneHeaders: true });
    const buttons = [...element.querySelectorAll(".tl-presets button")].map((button) => button.textContent);
    expect(buttons).toEqual(["Day", "Week", "Month", "Year"]);
    await userEvent.click(element.querySelector('[data-tl-preset="day"]') as HTMLElement);
    timeline.flush();
    const day = timeline.getSnapshot().domain;
    expect(day[1] - day[0]).toBe(DAY);
    expect(timeline.zoomToPreset("week", T0 + 3 * DAY)).toBe(true);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0, T0 + 7 * DAY]);
    expect(timeline.zoomToPreset("nope")).toBe(false);
    const names = [...element.querySelectorAll(".tl-lane-header-text")].map((node) => node.textContent);
    expect(names).toEqual(["Ann", "Bob"]);
    timeline.update({ zoomPresets: [{ id: "q", label: "Quarter", unit: "month", count: 3 }] });
    timeline.flush();
    expect([...element.querySelectorAll(".tl-presets button")].map((button) => button.textContent)).toEqual(["Quarter"]);
    timeline.update({ zoomPresets: false, laneHeaders: false });
    timeline.flush();
    expect(element.querySelector(".tl-presets")).toBeNull();
    expect(element.querySelector(".tl-layer--lane-headers")).toBeNull();
    timeline.destroy();
  });
});

describe("the tooltip", () => {
  it("shows on hover with the host's text, on focus, and goes on Escape", async () => {
    const { element, timeline } = await mount({ tooltip: (item) => (item.id === "three" ? null : `Item ${item.label ?? ""}`) });
    const option = element.querySelector('[data-tl-id="one"]') as Element;
    const at = centre(option);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }]);
    const tip = element.querySelector(".tl-tooltip") as HTMLElement;
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    expect(tip.textContent).toBe("Item One");
    expect(tip.getAttribute("role")).toBe("tooltip");
    await userEvent.keyboard("{Escape}");
    expect(tip.hidden).toBe(true);
    // Away, and back: it shows again.
    await commands.mouse([{ type: "move", x: 2, y: 2 }]);
    await commands.mouse([{ type: "move", x: at.x, y: at.y + 1 }]);
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    await commands.mouse([{ type: "move", x: 2, y: 340 }]);
    await vi.waitFor(() => expect(tip.hidden).toBe(true));
    // The host's function says none for one item.
    const three = centre(element.querySelector('[data-tl-id="three"]') as Element);
    await commands.mouse([{ type: "move", x: three.x, y: three.y }]);
    await new Promise((done) => setTimeout(done, 250));
    expect(tip.hidden).toBe(true);
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Home}");
    timeline.flush();
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    timeline.update({ tooltip: false });
    timeline.flush();
    expect(element.querySelector(".tl-tools")).toBeNull();
    timeline.destroy();
  });

  it("writes the label and the dates by default", async () => {
    const { element, timeline } = await mount({ tooltip: true });
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Home}");
    timeline.flush();
    const tip = element.querySelector(".tl-tooltip") as HTMLElement;
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    expect(tip.textContent).toMatch(/^One\n.*2026/);
    timeline.destroy();
  });
});

describe("following the clock", () => {
  it("keeps now in the view, lets go when the reader pans, and follows again on follow()", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(T0 + 2 * DAY);
    const { element, timeline } = await mount({ rolling: { offset: 0.25, intervalMs: 1000 } });
    const span = (domain: readonly number[]): number => (domain[1] as number) - (domain[0] as number);
    let domain = timeline.getSnapshot().domain;
    expect(domain[0] + span(domain) * 0.25).toBeCloseTo(T0 + 2 * DAY, -2);
    vi.setSystemTime(T0 + 2 * DAY + HOUR);
    // To the clock's next step, and no further: now is when it read the clock.
    vi.advanceTimersToNextTimer();
    timeline.flush();
    domain = timeline.getSnapshot().domain;
    expect(Date.now() - (T0 + 2 * DAY + HOUR)).toBeLessThanOrEqual(1000);
    expect(domain[0] + span(domain) * 0.25).toBeCloseTo(Date.now(), -2);
    // The reader pans: the clock lets go.
    const svg = element.querySelector("svg") as SVGSVGElement;
    const at = centre(svg);
    svg.dispatchEvent(new WheelEvent("wheel", { clientX: at.x, clientY: at.y, deltaX: 150, deltaY: 0, bubbles: true, cancelable: true }));
    timeline.flush();
    // A wheel run is a gesture until 150 ms pass without a step (timed by the
    // events' own clock): the clock does not move the view under it. A press
    // ends a run at once — on empty time, where it is a tap on nothing.
    const box = svg.getBoundingClientRect();
    const corner = { clientX: box.right - 3, clientY: box.bottom - 3, bubbles: true, cancelable: true, composed: true, pointerId: 3, pointerType: "mouse" };
    svg.dispatchEvent(new PointerEvent("pointerdown", { ...corner, buttons: 1 }));
    svg.dispatchEvent(new PointerEvent("pointerup", { ...corner, buttons: 0 }));
    timeline.flush();
    const panned = timeline.getSnapshot().domain;
    vi.setSystemTime(T0 + 2 * DAY + 2 * HOUR);
    vi.advanceTimersByTime(1000);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual(panned);
    timeline.follow();
    timeline.flush();
    domain = timeline.getSnapshot().domain;
    // follow() reads the clock at once: the panned-past second included.
    expect(domain[0] + span(domain) * 0.25).toBeCloseTo(Date.now(), -2);
    expect(Date.now() - (T0 + 2 * DAY + 2 * HOUR)).toBeLessThanOrEqual(1000);
    timeline.update({ rolling: false });
    timeline.follow();
    timeline.destroy();
  });
});

describe("live data", () => {
  it("adds, changes and removes items, draws the frame a full reload draws, and refuses what it cannot do", async () => {
    const changed = vi.fn();
    const { element, timeline } = await mount();
    timeline.on("itemsChanged", changed);
    timeline.select(["three"]);
    timeline.addItems([{ id: "four", label: "Four", start: T0 + 9 * HOUR, end: T0 + 15 * HOUR, laneId: "a" }]);
    timeline.updateItems([{ id: "two", start: T0 + 2 * DAY, end: T0 + 2 * DAY + 4 * HOUR }]);
    timeline.removeItems(["three", "missing"]);
    timeline.changeItems({});
    timeline.flush();
    expect(changed).toHaveBeenCalledTimes(3);
    expect(timeline.getSnapshot().selectedIds).toEqual([]);
    expect(timeline.items.map((item) => item.id)).toEqual(["one", "two", "four"]);
    expect(element.querySelectorAll("svg [role=option]")).toHaveLength(3);
    const incremental = timeline.exportSvg();
    // A later frame with the same items keeps the live layout.
    const layout = timeline.layout;
    timeline.flush();
    expect(timeline.layout).toBe(layout);
    timeline.destroy();
    document.body.replaceChildren();
    // The scope too: a light-DOM timeline takes one of its own, and the markup would differ by it alone.
    const fresh = await mount({ items: [...timeline.items], instanceId: /data-tl-instance="([^"]+)"/.exec(incremental)?.[1] ?? "" });
    expect(fresh.timeline.exportSvg()).toBe(incremental);
    expect(() => fresh.timeline.addItems([{ id: "one", start: T0 }])).toThrow(/already there/);
    expect(() => fresh.timeline.updateItems([{ id: "zz", start: T0 }])).toThrow(/no item/);
    fresh.timeline.destroy();
    const fetched = await mount({ items: async () => items });
    expect(() => fetched.timeline.addItems([{ id: "x", start: T0 }])).toThrow(TypeError);
    fetched.timeline.destroy();
  });
});

describe("a server frame with the time tools", () => {
  it("is taken over node for node with hidden dates, the strip and the lane headers, and lists the new events", async () => {
    expect(TIMELINE_EVENTS).toEqual(expect.arrayContaining(["timeBarMoved", "rangeSelected"]));
    const config: TimelineConfig = { items, lanes, domain: [T0 + 8 * HOUR, T0 + 4 * DAY + 17 * HOUR], height: 360, timeZone: "UTC", hiddenDates, minimap: true, laneHeaders: true, instanceId: "p24" };
    const frame = renderTimelineSvg(config, { width: 1000 });
    const element = document.createElement("div");
    element.style.cssText = "width:1000px;height:360px;position:relative";
    element.innerHTML = frame.svg;
    document.body.append(element);
    const before = element.querySelector("svg") as SVGSVGElement;
    const markup = before.outerHTML;
    const nodes = [...before.querySelectorAll("*")];
    const timeline = createTimeline(element, config, { hydrate: true, measureLabels: false });
    await vi.waitFor(() => {
      if (timeline.result === undefined) throw new Error("not drawn yet");
    });
    timeline.flush();
    expect(element.querySelector("svg")).toBe(before);
    expect(nodes.every((node) => node.isConnected)).toBe(true);
    expect(before.outerHTML).toBe(markup);
    expect(before.querySelector("[data-tl-minimap]")).not.toBeNull();
    timeline.destroy();
  });

  it("mounts a tools layer that takes nothing it is not asked for", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const layer = mountToolsLayer(element, document, {
      element,
      orientation: () => "horizontal",
      frame: () => undefined,
      domain: () => [T0, T0 + DAY],
      scale: () => undefined,
      locale: () => "en",
      timeZone: () => "UTC",
      bars: () => [],
      barStep: () => HOUR,
      moveBar: () => undefined,
      geometry: () => undefined,
      setDomain: () => undefined,
      range: () => undefined,
      selectRange: () => undefined,
      presets: () => undefined,
      zoomToPreset: () => undefined,
      tooltips: () => false,
      tooltip: () => null,
      hitAt: () => undefined,
      focused: () => undefined,
      editing: () => false,
    });
    layer.update();
    expect(element.querySelector(".tl-tools")).not.toBeNull();
    layer.destroy();
    expect(element.querySelector(".tl-tools")).toBeNull();
  });
});
