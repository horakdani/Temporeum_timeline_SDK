import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

import type { Item, Lane } from "@temporeum/timeline-core";

import { exportTheme } from "../src/config.js";
import { createTimeline, registerPlugin } from "../src/index.js";
import { exportPlugin } from "../src/export.js";
import { toolsPlugin } from "../src/tools.js";
import type { Timeline, TimelineConfig } from "../src/index.js";

// The parts on entry points of their own, as a page registers them.
registerPlugin(exportPlugin, toolsPlugin);

/**
 * The time tools and the export through the live instance, where the
 * `time-tools` and `export` suites do not go: the tooltip under a real mouse, a pen and a
 * finger; time bars turned with the orientation, renamed and taken away;
 * the presets of a vertical timeline; an export's theme, and a vertical
 * timeline's pages.
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
  { id: "two", label: "Two", start: T0 + 2 * DAY, end: T0 + 3 * DAY, laneId: "b" },
  { id: "dot", label: "Dot", start: T0 + 3 * DAY + 12 * HOUR, laneId: "a" },
];

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(config: Partial<TimelineConfig> = {}, width = 1000, height = 360): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:${String(height)}px;position:relative`;
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + 4 * DAY + 12 * HOUR], height, timeZone: "UTC", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [role=option]") === null) throw new Error("not drawn yet");
  });
  fakeClock();
  return { element, timeline };
}

const centre = (node: Element): { x: number; y: number } => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};
/**
 * The tools' waits (a resting pointer, the grace, a finger's hold, the clock
 * the view follows) on a fake clock: a test that says "nothing shows after
 * the wait" moves the clock past the wait instead of sleeping, so it neither
 * passes because the machine was slow nor costs real seconds. The frames
 * (requestAnimationFrame) stay real: drawing is not what is timed here.
 */
function fakeClock(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
}
const wait = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const tipOf = (element: Element): HTMLElement => element.querySelector(".tl-tooltip") as HTMLElement;
const item = (element: Element, id: string): Element => element.querySelector(`[data-tl-id="${id}"]`) as Element;

function pointer(target: Element, type: string, at: { x: number; y: number }, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true, composed: true, pointerId: 7, ...init }));
}

describe("the tooltip under a pointer", () => {
  it("shows for a resting mouse, stays on the way to it, and goes when the mouse leaves for nothing", async () => {
    const { element } = await mount({ tooltip: true });
    const at = centre(item(element, "one"));
    await commands.mouse([{ type: "move", x: at.x, y: at.y, steps: 2 }]);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    expect(tipOf(element).textContent).toMatch(/^One\n/);
    // Again over the same item: nothing restarts.
    await commands.mouse([{ type: "move", x: at.x + 2, y: at.y }]);
    expect(tipOf(element).hidden).toBe(false);
    // Onto the tooltip: it stays past the grace.
    const tip = centre(tipOf(element));
    await commands.mouse([{ type: "move", x: tip.x, y: tip.y, steps: 4 }]);
    await wait(450);
    expect(tipOf(element).hidden).toBe(false);
    // Off to empty time: it goes after the grace.
    const frame = element.getBoundingClientRect();
    await commands.mouse([{ type: "move", x: frame.left + frame.width - 5, y: frame.top + frame.height - 5, steps: 3 }]);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(true));
  });

  it("goes when the pointer leaves the timeline, and a dismissal lasts only until then", async () => {
    const { element } = await mount({ tooltip: true });
    const at = centre(item(element, "two"));
    await commands.mouse([{ type: "move", x: at.x, y: at.y, steps: 2 }]);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(tipOf(element).hidden).toBe(true);
    // Still over it: dismissed, it does not come back.
    await commands.mouse([{ type: "move", x: at.x + 3, y: at.y }]);
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
    // Out of the timeline and back: a new hover.
    await commands.mouse([{ type: "move", x: 2, y: element.getBoundingClientRect().bottom + 40, steps: 2 }]);
    await commands.mouse([{ type: "move", x: at.x, y: at.y, steps: 2 }]);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    element.querySelector("svg")?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    element.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(tipOf(element).hidden).toBe(true);
  });

  it("shows for a pen too, not while a button is held, and not where the host says there is nothing to say", async () => {
    const { element, timeline } = await mount({ tooltip: (each) => (each.id === "two" ? null : `About ${each.label ?? ""}`) });
    const svg = element.querySelector("svg") as SVGSVGElement;
    pointer(svg, "pointermove", centre(item(element, "one")), { pointerType: "pen" });
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    expect(tipOf(element).textContent).toBe("About One");
    // The host has nothing to say about "two".
    pointer(svg, "pointermove", centre(item(element, "two")), { pointerType: "pen" });
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
    // A held button is a drag, not a rest.
    pointer(svg, "pointermove", centre(item(element, "one")), { pointerType: "mouse", buttons: 1 });
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
    // Switched off: what showed goes.
    pointer(svg, "pointermove", centre(item(element, "one")), { pointerType: "mouse" });
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    timeline.update({ tooltip: false });
    timeline.flush();
    // With no other tool, the layer goes with it.
    expect(element.querySelector(".tl-tooltip:not([hidden])")).toBeNull();
  });

  it("shows for a finger held still, not for one that moves or lifts first", async () => {
    const { element } = await mount({ tooltip: true });
    const svg = element.querySelector("svg") as SVGSVGElement;
    const at = centre(item(element, "one"));
    // Moved past the slop: no tooltip.
    pointer(svg, "pointerdown", at, { pointerType: "touch" });
    pointer(svg, "pointermove", { x: at.x + 20, y: at.y }, { pointerType: "touch" });
    pointer(svg, "pointerup", { x: at.x + 20, y: at.y }, { pointerType: "touch" });
    await wait(650);
    expect(tipOf(element).hidden).toBe(true);
    // Lifted first: none either.
    pointer(svg, "pointerdown", at, { pointerType: "touch" });
    pointer(svg, "pointerup", at, { pointerType: "touch" });
    await wait(650);
    expect(tipOf(element).hidden).toBe(true);
    // Held over empty time: nothing to show.
    const frame = element.getBoundingClientRect();
    pointer(svg, "pointerdown", { x: frame.right - 5, y: frame.bottom - 5 }, { pointerType: "touch" });
    await wait(650);
    expect(tipOf(element).hidden).toBe(true);
    pointer(svg, "pointercancel", { x: frame.right - 5, y: frame.bottom - 5 }, { pointerType: "touch" });
    // Held still: it shows, and a press elsewhere lets it go. The hold is a
    // wait on the fake clock (so the waits above proved what they say).
    pointer(svg, "pointerdown", at, { pointerType: "touch" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(tipOf(element).hidden).toBe(true);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false), { timeout: 2000 });
    pointer(svg, "pointerup", at, { pointerType: "touch" });
    pointer(svg, "pointerdown", { x: frame.right - 5, y: frame.bottom - 5 }, { pointerType: "mouse" });
    expect(tipOf(element).hidden).toBe(true);
  });
});

describe("time bars and presets, turned and changed", () => {
  it("stands a vertical timeline's bar across, names it, restyles it, and takes it away", async () => {
    const { element, timeline } = await mount({ orientation: "vertical", timeBars: [{ id: "cut", time: T0 + 2 * DAY, label: "Cut", className: "mine" }] }, 500, 700);
    const line = element.querySelector('[data-tl-timebar="cut"]') as HTMLElement;
    expect(line.dataset.axis).toBe("v");
    expect(line.className).toBe("tl-timebar mine");
    const grip = line.querySelector(".tl-timebar-grip") as HTMLElement;
    expect([grip.style.left, grip.style.top, grip.getAttribute("aria-orientation")]).toEqual(["0px", "12px", "vertical"]);
    timeline.update({ timeBars: [{ id: "cut", time: T0 + 2 * DAY }, { id: "late", time: T0 + 3 * DAY, movable: false }] });
    timeline.flush();
    expect(line.className).toBe("tl-timebar");
    expect(grip.getAttribute("aria-label")).toBe("Time bar");
    const late = element.querySelector('[data-tl-timebar="late"] .tl-timebar-grip') as HTMLElement;
    expect(late.getAttribute("aria-disabled")).toBe("true");
    // A bar that does not move does not, by key or by pointer.
    late.focus();
    late.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, composed: true }));
    pointer(late, "pointerdown", centre(late), { pointerType: "mouse" });
    pointer(late, "pointerup", centre(late), { pointerType: "mouse" });
    timeline.flush();
    expect(late.getAttribute("aria-valuenow")).toBe(String(T0 + 3 * DAY));
    // A key that is no step: nothing moves, nothing is held back.
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, composed: true }));
    timeline.update({ timeBars: [] });
    timeline.flush();
    expect(element.querySelector("[data-tl-timebar]")).toBeNull();
  });

  it("puts the presets of a vertical timeline clear of the overview strip, and zooms on a click", async () => {
    const { element, timeline } = await mount({ orientation: "vertical", zoomPresets: true, minimap: true }, 500, 700);
    const presets = element.querySelector(".tl-presets") as HTMLElement;
    const strip = element.querySelector("[data-tl-minimap]")?.getBoundingClientRect();
    expect(presets.style.right).not.toBe("0px");
    expect(presets.getBoundingClientRect().right).toBeLessThanOrEqual((strip?.left ?? 0) + 0.5);
    const week = presets.querySelector('[data-tl-preset="week"]') as HTMLElement;
    week.click();
    timeline.flush();
    const [from, to] = timeline.getSnapshot().domain;
    expect(to - from).toBe(7 * DAY);
    // A click on the bar between the buttons is no preset.
    presets.click();
    expect(timeline.getSnapshot().domain).toEqual([from, to]);
  });
});

describe("export at its edges", () => {
  it("draws auto as the screen shows it now, and keeps a configured theme", () => {
    const dark = { matchMedia: (query: string) => ({ matches: query.includes("dark") }) as MediaQueryList };
    const light = { matchMedia: () => ({ matches: false }) as unknown as MediaQueryList };
    expect(exportTheme("auto", dark)).toBe("dark");
    expect(exportTheme(undefined, light)).toBe("light");
    expect(exportTheme(undefined, null)).toBe("light");
    expect(exportTheme("dark", light)).toBe("dark");
  });

  it("prints a vertical timeline with every item on exactly one page, and a configured theme on paper", async () => {
    const { timeline } = await mount({ orientation: "vertical", theme: "dark" }, 500, 700);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const printed = timeline.print({ size: [300, 200] });
    expect(print).toHaveBeenCalledOnce();
    const sections = [...document.querySelectorAll("body > [data-tl-print] > section")];
    expect(sections.length).toBeGreaterThan(0);
    const where = new Map<string, number>();
    sections.forEach((section, at) => {
      expect(section.querySelector("svg")?.getAttribute("data-tl-theme")).toBe("dark");
      for (const id of new Set([...section.querySelectorAll("[data-tl-id]")].map((node) => node.getAttribute("data-tl-id") ?? ""))) {
        expect(where.has(id), `${id} on two pages`).toBe(false);
        where.set(id, at);
      }
    });
    expect([...where.keys()].sort()).toEqual(items.map((each) => each.id).sort());
    window.dispatchEvent(new Event("afterprint"));
    await printed;
    const pdf = new TextDecoder("latin1").decode(await timeline.exportPdf({ size: [300, 200] }));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  });
});

describe("the tool paths the time-tools suite leaves out", () => {
  it("places a vertical timeline's focus tooltip beside its item, and lets it go with the focus or the setting", async () => {
    const { element, timeline } = await mount({ orientation: "vertical", tooltip: true, locale: "hu" }, 500, 700);
    (element.querySelector("svg") as SVGSVGElement).focus();
    expect(timeline.focusItem("dot")).toBe(true);
    timeline.flush();
    const tip = tipOf(element);
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    // An instant: one date, in the locale's words.
    expect(tip.textContent).toMatch(/^Dot\n2026\. jan/);
    expect(tip.textContent).not.toContain("–");
    const box = item(element, "dot").getBoundingClientRect();
    expect(tip.getBoundingClientRect().left).toBeGreaterThanOrEqual(box.right);
    // The focus leaves the drawing: the tooltip goes with it.
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    timeline.flush();
    expect(tip.hidden).toBe(true);
    // Back on an item, then the setting off.
    (element.querySelector("svg") as SVGSVGElement).focus();
    expect(timeline.focusItem("one")).toBe(true);
    timeline.flush();
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    timeline.update({ tooltip: false, timeBars: [{ id: "keep", time: T0 + DAY }] });
    timeline.flush();
    expect(tipOf(element).hidden).toBe(true);
  });

  it("names an item without a label by its id", async () => {
    const { element, timeline } = await mount({ items: [{ id: "bare", start: T0 + DAY, end: T0 + 2 * DAY, laneId: "a" }], tooltip: true });
    (element.querySelector("svg") as SVGSVGElement).focus();
    expect(timeline.focusItem("bare")).toBe(true);
    timeline.flush();
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    expect(tipOf(element).textContent).toMatch(/^bare\n.* – /);
  });

  it("picks a range from the keyboard in hundredths of the view, on the editing grid when there is one, and holds other keys while picking", async () => {
    const picked: { start: number; end: number }[] = [];
    const { element, timeline } = await mount({ rangeSelect: true });
    timeline.on("rangeSelected", (range) => picked.push({ start: Number(range.start), end: Number(range.end) }));
    const svg = element.querySelector("svg") as SVGSVGElement;
    svg.focus();
    const key = (name: string): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, composed: true });
      svg.dispatchEvent(event);
      return event;
    };
    // Not picking: an unknown key is nobody's business here.
    expect(key("q").defaultPrevented).toBe(false);
    key("r");
    // Picking: a key that is no step is held back, but not taken.
    const held = key("q");
    expect(held.defaultPrevented).toBe(false);
    key("ArrowRight");
    key("ArrowRight");
    key("Enter");
    const [from, to] = timeline.getSnapshot().domain;
    expect(picked).toHaveLength(1);
    expect((picked[0]?.end ?? 0) - (picked[0]?.start ?? 0)).toBeCloseTo((2 * (to - from)) / 100, -1);
    timeline.destroy();
    document.body.replaceChildren();
    // With an editing grid, the range is on it.
    const snapped: { start: number; end: number }[] = [];
    const grid = await mount({ rangeSelect: true, editing: { enabled: true, snapMs: HOUR } });
    grid.timeline.on("rangeSelected", (range) => snapped.push({ start: Number(range.start), end: Number(range.end) }));
    const svg2 = grid.element.querySelector("svg") as SVGSVGElement;
    svg2.focus();
    for (const name of ["r", "ArrowRight", "ArrowRight", "ArrowRight", "Enter"]) svg2.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, composed: true }));
    expect(snapped).toHaveLength(1);
    expect((snapped[0]?.start ?? 1) % HOUR).toBe(0);
    expect((snapped[0]?.end ?? 1) % HOUR).toBe(0);
  });

  it("moves a bar on the bars' grid and within the limits, and not for a drag that goes nowhere or is cancelled", async () => {
    const moved: number[] = [];
    const { element, timeline } = await mount({
      timeBars: [{ id: "cut", time: T0 + 2 * DAY, label: "Cut" }],
      timeBarOptions: { snapMs: HOUR },
      limits: { min: T0, max: T0 + 4 * DAY },
    });
    timeline.on("timeBarMoved", (bar) => moved.push(Number(bar.time)));
    const grip = element.querySelector('[data-tl-timebar="cut"] .tl-timebar-grip') as HTMLElement;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true, composed: true }));
    expect(moved.at(-1)).toBe(T0 + 4 * DAY);
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true, composed: true }));
    expect((moved.at(-1) ?? 1) % HOUR).toBe(0);
    const count = moved.length;
    timeline.flush();
    const at = centre(grip);
    // Down and up on the spot: no move.
    pointer(grip, "pointerdown", at, { pointerType: "mouse" });
    pointer(grip, "pointerup", at, { pointerType: "mouse" });
    // Dragged, then cancelled: no move either.
    pointer(grip, "pointerdown", at, { pointerType: "mouse" });
    pointer(grip, "pointermove", { x: at.x - 80, y: at.y }, { pointerType: "mouse" });
    pointer(grip, "pointercancel", { x: at.x - 80, y: at.y }, { pointerType: "mouse" });
    expect(moved).toHaveLength(count);
    // Without bars the layer lets them go.
    timeline.update({ timeBars: undefined });
    timeline.flush();
    expect(element.querySelector("[data-tl-timebar]")).toBeNull();
  });

  it("zooms to a preset around an instant it is given, and the clock, followed, lets go", async () => {
    const element = document.createElement("div");
    element.style.cssText = "width:1000px;height:360px;position:relative";
    document.body.append(element);
    // Following the clock by default: now, at the middle, every second.
    fakeClock();
    const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + 4 * DAY], height: 360, timeZone: "UTC", zoomPresets: true, rolling: true });
    await vi.waitFor(() => {
      if (timeline.result === undefined) throw new Error("not drawn yet");
    });
    const [from, to] = timeline.getSnapshot().domain;
    expect((from + to) / 2).toBeCloseTo(Date.now(), -4);
    expect(timeline.zoomToPreset("day", T0 + 3 * DAY + 5 * HOUR)).toBe(true);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 3 * DAY, T0 + 4 * DAY]);
    await wait(1100);
    timeline.flush();
    expect(timeline.getSnapshot().domain).toEqual([T0 + 3 * DAY, T0 + 4 * DAY]);
    expect(timeline.zoomToPreset("fortnight")).toBe(false);
    timeline.destroy();
  });

  it("lets go of the focus and the selection of an item a live change removes", async () => {
    const { timeline } = await mount();
    timeline.select(["two"]);
    expect(timeline.focusItem("one")).toBe(true);
    timeline.removeItems(["one"]);
    timeline.flush();
    expect(timeline.getSnapshot().focusedId).toBeNull();
    expect(timeline.getSnapshot().selectedIds).toEqual(["two"]);
    // A later change in the same lanes builds on the last frame.
    timeline.addItems([{ id: "late", label: "Late", start: T0 + 3 * DAY, end: T0 + 4 * DAY, laneId: "b" }]);
    timeline.flush();
    const layout = timeline.layout;
    expect(layout?.items.map((placed) => placed.item.id).sort()).toEqual(["dot", "late", "two"]);
    timeline.flush();
    expect(timeline.layout).toBe(layout);
  });
});

describe("the tooltip's timing, and the layer's own keys and presses", () => {
  it("restarts its wait for a new item, forgets it on empty time or a leave, and keeps the tooltip for a pointer on its way to it", async () => {
    const { element } = await mount({ tooltip: true });
    const svg = element.querySelector("svg") as SVGSVGElement;
    const frame = element.getBoundingClientRect();
    const empty = { x: frame.right - 5, y: frame.bottom - 5 };
    const mouse = { pointerType: "mouse" } as const;
    // One, then two before the wait is out: two's tooltip.
    pointer(svg, "pointermove", centre(item(element, "one")), mouse);
    pointer(svg, "pointermove", centre(item(element, "two")), mouse);
    await vi.waitFor(() => expect(tipOf(element).hidden).toBe(false));
    expect(tipOf(element).textContent).toMatch(/^Two\n/);
    // To empty time, and onto the tooltip within the grace: it stays.
    pointer(svg, "pointermove", empty, mouse);
    pointer(tipOf(element), "pointermove", centre(tipOf(element)), mouse);
    await wait(450);
    expect(tipOf(element).hidden).toBe(false);
    // Over a tool's own control: not the drawing's business.
    element.querySelector("svg")?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    element.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(tipOf(element).hidden).toBe(true);
    // A wait begun, then empty time: nothing shows.
    pointer(svg, "pointermove", centre(item(element, "one")), mouse);
    pointer(svg, "pointermove", empty, mouse);
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
    // A wait begun, then a leave: nothing shows.
    pointer(svg, "pointermove", centre(item(element, "one")), mouse);
    element.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
  });

  it("ignores a pointer over its own controls, and keeps a press on them from the drawing", async () => {
    const { element, timeline } = await mount({ tooltip: true, zoomPresets: true });
    const button = element.querySelector('[data-tl-preset="day"]') as HTMLElement;
    pointer(button, "pointermove", centre(button), { pointerType: "mouse" });
    await wait(250);
    expect(tipOf(element).hidden).toBe(true);
    const heard = vi.fn();
    element.querySelector("svg")?.addEventListener("pointerdown", heard);
    element.addEventListener("pointerdown", heard);
    const before = timeline.getSnapshot().domain;
    pointer(button, "pointerdown", centre(button), { pointerType: "mouse" });
    pointer(button, "pointerup", centre(button), { pointerType: "mouse" });
    expect(heard).not.toHaveBeenCalled();
    expect(timeline.getSnapshot().domain).toEqual(before);
    // Keys on a preset button are the button's; a key someone else took is nobody's here.
    const onButton = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true, composed: true });
    const keyHeard = vi.fn();
    element.addEventListener("keydown", keyHeard);
    button.dispatchEvent(onButton);
    expect(keyHeard).not.toHaveBeenCalled();
    const taken = new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true, composed: true });
    taken.preventDefault();
    element.querySelector("svg")?.dispatchEvent(taken);
    expect(timeline.getSnapshot().domain).toEqual(before);
  });

  it("lets go of every wait on destroy: a finger's press, a mouse's rest", async () => {
    const { element, timeline } = await mount({ tooltip: true });
    const svg = element.querySelector("svg") as SVGSVGElement;
    pointer(svg, "pointerdown", centre(item(element, "one")), { pointerType: "touch" });
    pointer(svg, "pointermove", centre(item(element, "dot")), { pointerType: "mouse", pointerId: 9 });
    const tip = tipOf(element);
    timeline.destroy();
    await wait(650);
    expect(tip.isConnected).toBe(false);
    expect(tip.hidden).toBe(true);
  });

  it("takes a bar away and keeps the rest while another tool stays, and leaves the strip's keys that are no step", async () => {
    const { element, timeline } = await mount({ zoomPresets: true, minimap: true, timeBars: [{ id: "a1", time: T0 + DAY }, { id: "a2", time: T0 + 2 * DAY }] });
    const first = element.querySelector('[data-tl-timebar="a1"]');
    timeline.update({ timeBars: [{ id: "a2", time: T0 + 2 * DAY }] });
    timeline.flush();
    expect(first?.isConnected).toBe(false);
    expect(element.querySelector('[data-tl-timebar="a2"]')).not.toBeNull();
    const handle = element.querySelector(".tl-minimap-handle") as HTMLElement;
    const before = timeline.getSnapshot().domain;
    const key = new KeyboardEvent("keydown", { key: "q", bubbles: true, cancelable: true, composed: true });
    handle.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(timeline.getSnapshot().domain).toEqual(before);
  });
});

describe("a host the page has not positioned", () => {
  it("is positioned by the timeline, so the tools layer lands on the drawing, and let go of at destroy", async () => {
    // The plain div of a page: not positioned, a few pixels off its ancestor's corner.
    const outer = document.createElement("div");
    outer.style.cssText = "position:relative;padding:40px 30px";
    const element = document.createElement("div");
    element.style.cssText = "width:800px;height:300px";
    outer.append(element);
    document.body.append(outer);
    const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + 4 * DAY + 12 * HOUR], height: 300, timeZone: "UTC", tooltip: true });
    await vi.waitFor(() => {
      if (timeline.result === undefined || element.querySelector(".tl-tools") === null) throw new Error("not drawn yet");
    });
    expect(getComputedStyle(element).position).toBe("relative");
    const layer = element.querySelector(".tl-tools")!.getBoundingClientRect();
    const host = element.getBoundingClientRect();
    expect([layer.left, layer.top, layer.width, layer.height]).toEqual([host.left, host.top, host.width, host.height]);
    timeline.destroy();
    expect(element.style.position).toBe("");
  });

  it("leaves a host that is positioned alone", async () => {
    const { element, timeline } = await mount();
    expect(element.style.position).toBe("relative");
    timeline.destroy();
    expect(element.style.position).toBe("relative");
  });
});
