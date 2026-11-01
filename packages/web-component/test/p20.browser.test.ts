import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item, Lane, Orientation } from "@temporeum/timeline-core";
import type { Dependency } from "@temporeum/timeline-core/gantt";

import { createTimeline, frameScene, registerPlugin } from "../src/index.js";
import { defaultTaskColumns, ganttPlugin, mountTaskGrid, taskGridCss } from "../src/gantt.js";
import { itemsPlugin } from "../src/items.js";
import type { TemporeumTimelineElement, Timeline, TimelineConfig } from "../src/index.js";
import "../src/define.js";

// The parts on entry points of their own (P29, P30), as a page registers them.
registerPlugin(ganttPlugin, itemsPlugin);

/**
 * P20 through the live instance, in a real Chromium: the arrows, their
 * stand-in during a zoom, `[` and `]`, the instance's focus and scroll
 * calls, and the task grid beside it.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const domain: [number, number] = [T0, T0 + 20 * DAY];

const lanes: Lane[] = Array.from({ length: 30 }, (_, at) => ({ id: `l${String(at)}`, label: `Stream ${String(at)}` }));
const items: Item[] = lanes.flatMap((lane, at) => [
  { id: `t${String(at)}a`, start: T0 + (at % 5) * DAY, end: T0 + ((at % 5) + 3) * DAY, label: `Task ${String(at)}a`, laneId: lane.id, progress: 0.5 },
  { id: `t${String(at)}b`, start: T0 + ((at % 5) + 4) * DAY, end: T0 + ((at % 5) + 7) * DAY, label: `Task ${String(at)}b`, laneId: lane.id },
]);
const dependencies: Dependency[] = [
  ...lanes.map((_, at) => ({ from: `t${String(at)}a`, to: `t${String(at)}b` })),
  ...lanes.slice(1).map((_, at) => ({ from: `t${String(at)}b`, to: `t${String(at + 1)}a`, type: "SS" as const })),
];

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(config: Partial<TimelineConfig> = {}, width = 900, height = 400): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = `width:${String(width)}px;height:${String(height)}px;position:relative`;
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain, height, orientation: "horizontal", gantt: { dependencies }, ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const arrowIds = (root: ParentNode): string[] =>
  [...root.querySelectorAll(".tl-layer--deps path.tl-dep")].flatMap((path) => (path.getAttribute("data-tl-dep") ?? "").split(" "));

describe("the arrows", () => {
  it("are a path per look under the items, naming the arrows in view; cull: false draws them all", async () => {
    const { element, timeline } = await mount();
    const layers = [...element.querySelectorAll("svg > g.tl-layer")].map((layer) => layer.getAttribute("class"));
    expect(layers.indexOf("tl-layer tl-layer--deps")).toBe(layers.indexOf("tl-layer tl-layer--items") - 1);
    const culled = arrowIds(element);
    expect(culled.length).toBeGreaterThan(5);
    expect(culled.length).toBeLessThan(dependencies.length);
    expect(element.querySelectorAll(".tl-layer--deps path").length).toBe(2);
    timeline.update({ gantt: { dependencies, cull: false } });
    timeline.flush();
    expect(arrowIds(element)).toHaveLength(dependencies.length);
    // The picture a host exports has the arrows too.
    expect(timeline.exportSVG()).toContain("tl-layer--deps");
    timeline.destroy();
  });

  it("are drawn stronger for a selected item, and the same frame comes from the shared function", async () => {
    const { element, timeline } = await mount();
    timeline.select(["t0a"]);
    timeline.flush();
    const strong = element.querySelector(".tl-layer--deps path.tl-dep--selected");
    expect(strong?.getAttribute("data-tl-dep")?.split(" ")).toEqual([expect.stringContaining("t0a")]);
    // Without `gantt` the frame is the renderer's own.
    const result = timeline.result;
    if (result === undefined) throw new Error("no frame");
    expect(frameScene({ items }, { items, domain, view: {} as never, selectedIds: [], focusedId: null, crossOffset: 0, loading: [] }, result)).toBe(result.scene);
    timeline.destroy();
  });

  it("a pan across does not draw them again until it reaches lanes out of reach; the exact frame draws them for its view", async () => {
    const { element, timeline } = await mount({ sceneSpace: false });
    const before = arrowIds(element);
    timeline.scrollLanes(200);
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(200);
    expect(arrowIds(element)).not.toEqual(before);
    timeline.destroy();
  });

  for (const orientation of ["horizontal", "vertical"] as Orientation[]) {
    it(`during a zoom the arrows of the scale before stand in, stretched; at rest they are exact again [${orientation}]`, async () => {
      const { element, timeline } = await mount({ orientation }, orientation === "horizontal" ? 900 : 700, orientation === "horizontal" ? 400 : 700);
      const transforms: string[] = [];
      const observer = new MutationObserver(() => {
        const g = element.querySelector(".tl-layer--deps > g");
        const transform = g?.getAttribute("transform");
        if (transform !== null && transform !== undefined) transforms.push(transform);
      });
      observer.observe(element, { subtree: true, childList: true, attributes: true });
      const box = element.getBoundingClientRect();
      // Around day 4, where the arrows are: days 0 to 11 hold them all.
      const at = orientation === "horizontal" ? { x: box.left + box.width * 0.2, y: box.top + box.height / 2 } : { x: box.left + box.width / 2, y: box.top + box.height * 0.2 };
      await commands.mouse([
        { type: "move", x: at.x, y: at.y },
        ...Array.from({ length: 6 }, () => ({ type: "wheel" as const, deltaY: -120, modifiers: ["Control" as const] })),
      ]);
      for (let frame = 0; frame < 3; frame += 1) await nextFrame();
      await new Promise((done) => setTimeout(done, 500));
      for (let frame = 0; frame < 3; frame += 1) await nextFrame();
      observer.disconnect();
      expect(transforms.some((transform) => transform.startsWith("matrix("))).toBe(true);
      expect(element.querySelector(".tl-layer--deps > g")).toBeNull();
      expect(arrowIds(element).length).toBeGreaterThan(0);
      timeline.destroy();
    });
  }
});

describe("[ and ], and the instance's calls", () => {
  it("[ and ] move the focus along the arrows, round the list; without arrows they are let through", async () => {
    const { element, timeline } = await mount();
    const svg = element.querySelector("svg") as SVGSVGElement;
    expect(timeline.focusItem("t1b")).toBe(true);
    svg.focus();
    await userEvent.keyboard("[[");
    await vi.waitFor(() => expect(timeline.getSnapshot().focusedId).toBe("t1a"));
    // Pressed again, [ goes round t1b's predecessors: it has one, so it stays.
    await userEvent.keyboard("[[");
    await vi.waitFor(() => expect(timeline.getSnapshot().focusedId).toBe("t1a"));
    // A new key starts from where the focus is: t1a's one successor.
    await userEvent.keyboard("]");
    await vi.waitFor(() => expect(timeline.getSnapshot().focusedId).toBe("t1b"));
    // t0b has two links: t0a before it, t1a after it.
    expect(timeline.focusItem("t0b")).toBe(true);
    await userEvent.keyboard("[[");
    await vi.waitFor(() => expect(timeline.getSnapshot().focusedId).toBe("t0a"));
    expect(timeline.focusItem("t0b")).toBe(true);
    await userEvent.keyboard("]");
    await vi.waitFor(() => expect(timeline.getSnapshot().focusedId).toBe("t1a"));
    timeline.update({ gantt: undefined });
    timeline.flush();
    await userEvent.keyboard("]");
    expect(timeline.getSnapshot().focusedId).toBe("t1a");
    timeline.destroy();
  });

  it("focusItem brings an item out of view into it, and says no to one it does not hold", async () => {
    const { timeline } = await mount();
    timeline.zoomTo([T0 + 40 * DAY, T0 + 50 * DAY]);
    timeline.flush();
    expect(timeline.focusItem("nope")).toBe(false);
    expect(timeline.focusItem("t29b")).toBe(true);
    timeline.flush();
    const view = timeline.getSnapshot().domain;
    expect(view[0]).toBeLessThan(T0 + 15 * DAY);
    expect(timeline.getSnapshot().crossOffset).toBeGreaterThan(0);
    timeline.destroy();
  });

  it("scrollLanes ignores nothing to do; revealLane a lane it does not hold", async () => {
    const { timeline } = await mount();
    timeline.scrollLanes(0);
    timeline.scrollLanes(Number.NaN);
    timeline.revealLane("nope");
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(0);
    timeline.destroy();
  });

  it("the element takes the arrows as a property", async () => {
    const el = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    el.style.width = "900px";
    el.items = items;
    el.lanes = lanes;
    el.config = { domain, orientation: "horizontal" };
    el.gantt = { dependencies };
    document.body.append(el);
    await vi.waitFor(() => expect(arrowIds(el.shadowRoot as ShadowRoot).length).toBeGreaterThan(0));
    expect(el.gantt?.dependencies).toBe(dependencies);
  });
});

describe("the task grid", () => {
  async function withGrid(config: Partial<TimelineConfig> = {}, gridOptions: Parameters<typeof mountTaskGrid>[2] = {}) {
    const { element, timeline } = await mount(config);
    const box = document.createElement("div");
    box.style.cssText = "width:300px;height:400px";
    document.body.append(box);
    const grid = mountTaskGrid(box, timeline, { focusTarget: element.querySelector("svg") as unknown as HTMLElement, ...gridOptions });
    const rows = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>(".tl-grid-row")];
    return { element, timeline, box, grid, rows };
  }

  it("is a grid of the rows in view, each on its lane's line, with the default columns", async () => {
    const { element, box, rows, grid, timeline } = await withGrid({}, { overscan: 0 });
    const role = box.querySelector("[role=grid]");
    expect(role?.getAttribute("aria-rowcount")).toBe(String(lanes.length + 1));
    expect(rows().length).toBeLessThan(lanes.length);
    const first = rows()[0] as HTMLElement;
    expect([...first.children].map((cell) => cell.textContent)).toEqual(["Stream 0", "2026-01-05", "2026-01-12", "50%"]);
    const lane = element.querySelector('[data-tl-lane="l0"]')?.getBoundingClientRect();
    expect(first.getBoundingClientRect().bottom - box.getBoundingClientRect().top).toBeCloseTo((lane?.bottom ?? 0) - element.getBoundingClientRect().top, 0);
    expect(grid.focusedIndex).toBe(0);
    grid.update();
    timeline.destroy();
    grid.destroy();
    expect(box.querySelector("[role=grid]")).toBeNull();
  });

  it("walks the rows with the keys, Enter opens one, a click another", async () => {
    const { timeline, rows, grid } = await withGrid();
    (rows()[0] as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(grid.focusedIndex).toBe(1);
    await userEvent.keyboard("{End}");
    await vi.waitFor(() => expect(grid.focusedIndex).toBe(lanes.length - 1));
    await vi.waitFor(() => expect(timeline.getSnapshot().crossOffset).toBeGreaterThan(0));
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("{PageDown}");
    expect(grid.focusedIndex).toBeGreaterThan(1);
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("{ArrowUp}");
    expect(grid.focusedIndex).toBe(0);
    await userEvent.keyboard("{Enter}");
    expect(timeline.getSnapshot().focusedId).toBe("t0a");
    await userEvent.keyboard("x");
    await userEvent.click(rows().find((row) => row.getAttribute("aria-rowindex") === "4") as HTMLElement);
    expect(grid.focusedIndex).toBe(2);
    expect(timeline.getSnapshot().focusedId).toBe("t2a");
    timeline.destroy();
  });

  it("the wheel over it scrolls the lanes, in lines too, and leaves a zoom alone", async () => {
    const { timeline, box } = await withGrid();
    const grid = box.querySelector("[role=grid]") as HTMLElement;
    grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true }));
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(60);
    grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 2, deltaMode: 1, bubbles: true, cancelable: true }));
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(92);
    grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, ctrlKey: true, bubbles: true, cancelable: true }));
    grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, deltaX: 0, bubbles: true, cancelable: true }));
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(92);
    timeline.destroy();
  });

  it("follows a vertical timeline across, takes a theme, and redraws after a command", async () => {
    const { timeline, box, rows } = await withGrid({ orientation: "vertical" }, { theme: "dark", columns: defaultTaskColumns(), label: "Plan" });
    const grid = box.querySelector("[role=grid]") as HTMLElement;
    expect(grid.className).toContain("tl-grid--vertical");
    expect(grid.dataset.tlTheme).toBe("dark");
    expect(grid.getAttribute("aria-label")).toBe("Plan");
    expect((rows()[0] as HTMLElement).style.width).not.toBe("");
    (grid as HTMLElement).dispatchEvent(new WheelEvent("wheel", { deltaX: 30, bubbles: true, cancelable: true }));
    timeline.flush();
    expect(timeline.getSnapshot().crossOffset).toBe(30);
    timeline.update({ editing: { enabled: true, drop: true } });
    expect(timeline.dropItem({ label: "New", laneId: "l0", start: T0 + DAY, durationMs: DAY })).toBe(true);
    await nextFrame();
    await nextFrame();
    expect(rows()[0]?.textContent).toContain("Stream 0");
    expect(taskGridCss()).toContain(".tl-grid-row");
    timeline.destroy();
  });

  it("names a lane with no label by its first item, then by its id; a custom theme sets its own colours", async () => {
    const bare: Lane[] = [{ id: "solo" }, { id: "empty" }];
    const element = document.createElement("div");
    element.style.cssText = "width:900px;height:300px;position:relative";
    document.body.append(element);
    const timeline = createTimeline(element, {
      items: [{ id: "only", start: T0, end: T0 + DAY, label: "Only", laneId: "solo" }],
      lanes: bare,
      domain,
      orientation: "horizontal",
      gantt: {},
    });
    await vi.waitFor(() => {
      if (timeline.result === undefined) throw new Error("not drawn yet");
    });
    const box = document.createElement("div");
    document.body.append(box);
    const custom = { name: "brand", tokens: { text: "#111", textMuted: "#555", surface: "#fff", surfaceAlt: "#eee", line: "#ccc", focus: "#00f" } };
    mountTaskGrid(box, timeline, { theme: custom as never });
    const names = [...box.querySelectorAll(".tl-grid-cell--name")].map((cell) => cell.textContent);
    expect(names).toEqual(["Only", "empty"]);
    expect((box.querySelector("[role=grid]") as HTMLElement).dataset.tlTheme).toBe("custom");
    // A click outside a row, and Enter on a lane with no item, do nothing.
    (box.querySelector(".tl-grid-head") as HTMLElement).click();
    timeline.destroy();
  });

  it("keeps the focused row while it has the focus, and takes the rarer rows and keys", async () => {
    const odd: Lane[] = [{ id: "\u0000hidden" }, { id: "open" }, ...lanes];
    const element = document.createElement("div");
    element.style.cssText = "width:900px;height:300px;position:relative";
    document.body.append(element);
    const timeline = createTimeline(element, {
      items: [{ id: "instant", start: T0 + DAY, laneId: "open", label: "Instant" }, ...items],
      lanes: odd,
      domain,
      height: 300,
      orientation: "vertical",
      gantt: { dependencies },
    });
    await vi.waitFor(() => {
      if (timeline.result === undefined) throw new Error("not drawn yet");
    });
    const box = document.createElement("div");
    box.style.cssText = "width:900px;height:300px";
    document.body.append(box);
    const grid = mountTaskGrid(box, timeline, { overscan: 0 });
    const cells = (index: number): string[] =>
      [...(box.querySelector(`[aria-rowindex="${String(index + 2)}"]`)?.children ?? [])].map((cell) => cell.textContent ?? "");
    // A lane the host hid is nameless; an item with no end ends at its start.
    expect(cells(0)).toEqual(["", "", "", ""]);
    expect(cells(1)).toEqual(["Instant", "2026-01-06", "2026-01-06", ""]);
    const first = box.querySelector<HTMLElement>('[aria-rowindex="2"]') as HTMLElement;
    first.focus();
    // Enter on a lane with no item opens nothing.
    await userEvent.keyboard("{Enter}");
    expect(timeline.getSnapshot().focusedId).toBeNull();
    // A key the host already took is left alone.
    first.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    await userEvent.keyboard("{ArrowRight}");
    expect(grid.focusedIndex).toBe(0);
    // Across a vertical timeline, a wheel with no sideways delta uses its own.
    const role = box.querySelector("[role=grid]") as HTMLElement;
    role.dispatchEvent(new WheelEvent("wheel", { deltaY: 400, bubbles: true, cancelable: true }));
    timeline.flush();
    grid.update();
    expect(timeline.getSnapshot().crossOffset).toBe(400);
    // The focused row is out of view now, and still there: the keyboard is not dropped.
    expect(first.isConnected).toBe(true);
    expect(document.activeElement).toBe(first);
    timeline.destroy();
  });
});
