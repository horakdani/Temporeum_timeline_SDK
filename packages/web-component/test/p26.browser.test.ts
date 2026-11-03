import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item, Lane } from "@temporeum/timeline-core";
import { calendarFields, DEFAULT_STRINGS, PSEUDO_CLOSE, PSEUDO_OPEN, pseudoStrings } from "@temporeum/timeline-core/intl";

import { createTimeline, registerPlugin } from "../src/index.js";
import { exportPlugin } from "../src/export.js";
import { ganttPlugin, mountTaskGrid } from "../src/gantt.js";
import { mountBacklog, resourcesPlugin } from "../src/resources.js";
import { groupsPlugin } from "../src/groups.js";
import { intlPlugin } from "../src/intl.js";
import { itemsPlugin } from "../src/items.js";
import { toolsPlugin } from "../src/tools.js";
import type { Timeline, TimelineConfig } from "../src/index.js";

// The parts on entry points of their own (P29, P30), as a page registers them.
registerPlugin(exportPlugin, ganttPlugin, resourcesPlugin, toolsPlugin, groupsPlugin, itemsPlugin, intlPlugin);

/**
 * P26 through the live instance, in a real Chromium: every word the element
 * says comes from the dictionary (a pseudo-translation leaves nothing
 * unmarked), right to left mirrors what is drawn and what the pointer, the
 * wheel and the arrows do, and a calendar's months are the axis's.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 5);
const lanes: Lane[] = [
  { id: "a", label: "設計班" },
  { id: "b", label: "開発班" },
];
const items: Item[] = [
  { id: "one", label: "企画", start: T0, end: T0 + 4 * DAY, laneId: "a", progress: 0.4, baseline: { start: T0, end: T0 + 3 * DAY } },
  { id: "two", label: "実装", start: T0 + 5 * DAY, end: T0 + 12 * DAY, laneId: "b" },
  { id: "three", label: "出荷", start: T0 + 14 * DAY, laneId: "a", kind: "milestone" },
  ...Array.from({ length: 30 }, (_, n) => ({ id: `dense${String(n)}`, label: `点${String(n)}`, start: T0 + 20 * DAY + n * 60_000, laneId: "b" })),
];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function mount(config: Partial<TimelineConfig> = {}, width = 1000, height = 360, parent: HTMLElement = document.body): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:${String(height)}px;position:relative`;
  parent.append(element);
  const timeline = createTimeline(element, { items, lanes, domain: [T0 - DAY, T0 + 24 * DAY], height, timeZone: "UTC", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [role=option]") === null) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const centre = (node: Element): { x: number; y: number } => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

/** Every string a reader can be given: text, and the attributes that are read out or shown. */
function spoken(root: ParentNode): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest("style, script") !== null) continue;
    const text = node.textContent?.trim() ?? "";
    if (text !== "") out.push(text);
  }
  for (const element of (root as Element).querySelectorAll("*")) {
    for (const name of ["aria-label", "aria-valuetext", "aria-roledescription", "aria-description", "title", "placeholder", "alt"]) {
      const value = element.getAttribute(name);
      if (value !== null && value.trim() !== "") out.push(value);
    }
  }
  return out;
}

/** What is left of a string once the dictionary's marked phrases and the host's own words are taken out. */
function unmarked(text: string, host: readonly string[]): string {
  let rest = text;
  // Innermost first: a phrase's value can hold another phrase.
  for (let guard = 0; guard < 10 && rest.includes(PSEUDO_OPEN); guard += 1) {
    rest = rest.replace(new RegExp(`${PSEUDO_OPEN}[^${PSEUDO_OPEN}${PSEUDO_CLOSE}]*${PSEUDO_CLOSE}`, "g"), " ");
  }
  for (const word of host) rest = rest.split(word).join(" ");
  return rest;
}

describe("the dictionary", () => {
  it("[claim:pseudo-element] leaves no word unmarked: names, tools, groups, the grid and the backlog, in Japanese dates", async () => {
    const strings = pseudoStrings();
    // A group's id is the lane its items are in; "team" holds both.
    const groups = [
      { id: "team", label: "第一部" },
      { id: "a", label: "設計班", parentId: "team" },
      { id: "b", label: "開発班", parentId: "team" },
    ];
    const { element, timeline } = await mount({
      locale: "ja",
      strings,
      calendar: "japanese",
      groups,
      gantt: { dependencies: [{ from: "one", to: "two", lagMs: DAY }] },
      cluster: true,
      timeBars: [{ id: "bar", time: T0 + 6 * DAY }],
      zoomPresets: true,
      minimap: true,
      rangeSelect: true,
      laneHeaders: true,
      tooltip: true,
      editing: { enabled: true, add: true, remove: true },
    });
    // The tooltip, on a hover; the range help, from the keyboard; a new item, from the keyboard.
    const one = element.querySelector('[data-tl-id="one"]') as Element;
    const at = centre(one);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }]);
    await vi.waitFor(() => expect((element.querySelector(".tl-tooltip") as HTMLElement).hidden).toBe(false));
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("r");
    await vi.waitFor(() => expect(element.querySelector(".tl-live")?.textContent).toContain(PSEUDO_OPEN));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("n");
    timeline.flush();
    expect(timeline.items.some((item) => item.label === `${PSEUDO_OPEN}${DEFAULT_STRINGS.newItem as string}${PSEUDO_CLOSE}`)).toBe(true);

    const grid = document.createElement("div");
    const backlog = document.createElement("div");
    document.body.append(grid, backlog);
    mountTaskGrid(grid, timeline, { strings, locale: "ja", timeZone: "UTC" });
    mountBacklog(backlog, timeline, { strings, locale: "ja", tasks: [{ id: "later", label: "後で", durationMs: 2 * DAY }] });

    const host = [...items.map((item) => item.label ?? ""), ...lanes.map((lane) => lane.label ?? ""), ...groups.map((group) => group.label), "後で"];
    const texts = [...spoken(element), ...spoken(grid), ...spoken(backlog)];
    const marked = texts.filter((text) => text.includes(PSEUDO_OPEN)).length;
    expect(marked).toBeGreaterThan(20);
    const leaks = texts.filter((text) => /[A-Za-z]/.test(unmarked(text, host)));
    expect(leaks).toEqual([]);
    timeline.destroy();
  });

  it("[claim:pseudo-element] says the defaults in English when no dictionary is given, and the tooltip's dash is the dictionary's", async () => {
    const { element, timeline } = await mount({ zoomPresets: true, minimap: true, tooltip: true, strings: { range: "{start} 〜 {end}" }, locale: "ja" });
    const at = centre(element.querySelector('[data-tl-id="two"]') as Element);
    await commands.mouse([{ type: "move", x: at.x, y: at.y }]);
    await vi.waitFor(() => expect(element.querySelector(".tl-tooltip")?.textContent).toContain("〜"));
    expect([...element.querySelectorAll(".tl-presets button")].map((button) => button.textContent)).toEqual(["Day", "Week", "Month", "Year"]);
    expect(element.querySelector(".tl-minimap-handle")?.getAttribute("aria-label")).toBe("Overview");
    timeline.destroy();
  });
});

describe("right to left", () => {
  it("[claim:rtl-element] mirrors the drawing, a drag, the wheel, the arrows, the time bar and the tooltip", async () => {
    const config: Partial<TimelineConfig> = { timeBars: [{ id: "bar", time: T0 + 6 * DAY, label: "印" }], tooltip: true, zoomPresets: true, sceneSpace: false };
    const ltr = await mount(config);
    const rtl = await mount({ ...config, direction: "rtl" });
    const box = (target: { element: HTMLDivElement }, id: string): DOMRect => (target.element.querySelector(`[data-tl-id="${id}"]`) as Element).getBoundingClientRect();
    const frame = rtl.element.getBoundingClientRect();
    const frameL = ltr.element.getBoundingClientRect();
    // The same item, mirrored across the frame.
    expect(box(rtl, "one").right - frame.left).toBeCloseTo(frameL.right - box(ltr, "one").left, 0);
    expect(box(rtl, "one").left).toBeGreaterThan(box(rtl, "two").left);
    expect(rtl.element.querySelector("svg")?.getAttribute("dir")).toBe("rtl");

    // A drag to the right: the left-to-right view goes earlier, the mirrored one later.
    const drag = async (target: { element: HTMLDivElement; timeline: Timeline }): Promise<number> => {
      const before = target.timeline.getSnapshot().domain[0];
      const r = target.element.getBoundingClientRect();
      const y = r.top + r.height - 40;
      await commands.mouse([{ type: "move", x: r.left + 300, y }, { type: "down" }, { type: "move", x: r.left + 400, y, steps: 6 }, { type: "up" }]);
      target.timeline.flush();
      return target.timeline.getSnapshot().domain[0] - before;
    };
    const left = await drag(ltr);
    const right = await drag(rtl);
    expect(left).toBeLessThan(0);
    expect(right).toBeCloseTo(-left, -3);

    // The wheel's deltaX the same way.
    const wheel = (target: { element: HTMLDivElement; timeline: Timeline }): number => {
      const before = target.timeline.getSnapshot().domain[0];
      const svg = target.element.querySelector("svg") as SVGSVGElement;
      const at = centre(svg);
      svg.dispatchEvent(new WheelEvent("wheel", { clientX: at.x, clientY: at.y, deltaX: 200, deltaY: 0, bubbles: true, cancelable: true }));
      target.timeline.flush();
      return target.timeline.getSnapshot().domain[0] - before;
    };
    const ahead = wheel(ltr);
    expect(ahead).toBeGreaterThan(0);
    expect(wheel(rtl)).toBeCloseTo(-ahead, -3);

    // The left arrow goes to the next item, later.
    (rtl.element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("{Home}");
    const first = rtl.timeline.getSnapshot().focusedId;
    await userEvent.keyboard("{ArrowLeft}");
    const next = rtl.timeline.getSnapshot().focusedId;
    expect(next).not.toBe(first);
    const startOf = (id: string | null): number => Number(items.find((item) => item.id === id)?.start ?? Number.NaN);
    expect(startOf(next)).toBeGreaterThanOrEqual(startOf(first));

    // The time bar: its grip on the left of its line, and the left arrow later.
    const grip = rtl.element.querySelector(".tl-timebar-grip") as HTMLElement;
    const line = grip.parentElement as HTMLElement;
    expect(grip.getBoundingClientRect().right).toBeLessThanOrEqual(line.getBoundingClientRect().left + 6);
    const was = Number(grip.getAttribute("aria-valuenow"));
    grip.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(Number(grip.getAttribute("aria-valuenow"))).toBeGreaterThan(was));

    // The presets in the frame's top left corner, the tooltip at the item's right edge.
    const presets = rtl.element.querySelector(".tl-presets") as HTMLElement;
    expect(presets.getBoundingClientRect().left - frame.left).toBeLessThan(4);
    const two = box(rtl, "two");
    await commands.mouse([{ type: "move", x: two.left + two.width / 2, y: two.top + two.height / 2 }]);
    const tip = rtl.element.querySelector(".tl-tooltip") as HTMLElement;
    await vi.waitFor(() => expect(tip.hidden).toBe(false));
    expect(tip.getBoundingClientRect().right).toBeCloseTo(two.right, -1);
    ltr.timeline.destroy();
    rtl.timeline.destroy();
  });

  it("[claim:rtl-element] reads `auto` from the page, turns the PDF's text back, and mirrors the group tree", async () => {
    const page = document.createElement("div");
    page.dir = "rtl";
    document.body.append(page);
    const { element, timeline } = await mount({ direction: "auto", groups: [{ id: "g", label: "グループ" }, { id: "a", parentId: "g" }, { id: "b", parentId: "g" }] }, 900, 320, page);
    expect(element.querySelector("svg")?.getAttribute("dir")).toBe("rtl");
    const tree = element.querySelector(".tl-groups") as HTMLElement;
    expect(tree.getAttribute("dir")).toBe("rtl");
    const header = element.querySelector("[data-tl-group]") as HTMLElement;
    expect(element.getBoundingClientRect().right - header.getBoundingClientRect().right).toBeLessThan(2);
    const pdf = new TextDecoder("latin1").decode(await timeline.exportPdf());
    expect(pdf.startsWith("%PDF-")).toBe(true);
    // Each text turned back about its own x: a mirroring matrix right before it.
    expect(pdf).toMatch(/-1 0 0 1 [\d.]+ 0 cm[^]*?BT/);
    timeline.destroy();
    page.remove();
  });
});

describe("a calendar", () => {
  it("[claim:calendar-element] puts the axis's months where the Persian calendar's begin, labelled in Persian", async () => {
    const { element, timeline } = await mount({ calendar: "persian", locale: "fa", domain: [Date.UTC(2025, 0, 1), Date.UTC(2026, 6, 1)] }, 1400);
    const ticks = timeline.result?.ticks ?? [];
    const months = ticks.filter((tick) => tick.granularity === "month");
    expect(months.length).toBeGreaterThan(5);
    for (const tick of months) expect(calendarFields(tick.time, "persian", "UTC").day).toBe(1);
    // Nowruz 1404 (21 March 2025) is a major tick: the year begins there.
    expect(months.some((tick) => tick.major && tick.time === Date.UTC(2025, 2, 21))).toBe(true);
    const labels = [...element.querySelectorAll(".tl-tick-label")].map((node) => node.textContent ?? "");
    expect(labels.some((label) => /[؀-ۿ]/.test(label))).toBe(true);
    timeline.destroy();
  });
});
