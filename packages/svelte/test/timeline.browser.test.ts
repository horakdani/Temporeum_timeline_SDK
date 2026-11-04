import { flushSync, hydrate, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { Timeline, timelineState } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";
import { reactiveProps } from "./props.svelte.js";

/**
 * The adapter in a real Chromium with the real Svelte.
 *
 * The claim is React's: the component subscribes to the instance as an
 * external store and does not re-render per event — in Svelte's terms, no
 * prop effect runs and no store emits for what a pan does not change.
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

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted !== undefined) unmount(mounted);
  mounted = undefined;
  document.body.replaceChildren();
});

function host(): HTMLElement {
  document.body.style.margin = "0";
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Frames the browser draws from now until `stop()`: what "a frame at a time" is measured against. */
function countFrames(): { stop: () => number } {
  let frames = 0;
  let counting = true;
  const tick = (): void => {
    frames += 1;
    if (counting) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      counting = false;
      return frames;
    },
  };
}
const node = (id: string): Element => document.querySelector(`[data-tl-id="${id}"]`) as Element;
function centre(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** Mount with props a test can change; `timeline` is bound back into them. */
async function place(extra: Record<string, unknown> = {}) {
  const props = reactiveProps<Record<string, unknown>>({ items, lanes, defaultDomain: domain, height: 260, timeline: null, ...extra });
  mounted = mount(Timeline, { target: host(), props });
  await vi.waitFor(() => {
    if ((props.timeline as TimelineInstance | null)?.result === undefined) throw new Error("not drawn yet");
  });
  await nextFrame();
  return { props, timeline: props.timeline as TimelineInstance };
}

describe("<Timeline> — Svelte renders from the store, not from events", () => {
  it("a pan of real pointer events emits the range a frame at a time, and the selection not at all", async () => {
    const { timeline } = await place();
    const ranges: unknown[] = [];
    const selections: unknown[] = [];
    const stops = [timelineState(timeline, (snapshot) => snapshot.domain).subscribe((value) => ranges.push(value)), timelineState(timeline, (snapshot) => snapshot.selectedIds).subscribe((value) => selections.push(value))];
    const update = vi.spyOn(timeline, "update");
    const svg = document.querySelector("svg") as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const y = box.top + 12;
    const frames = countFrames();
    await commands.mouse([{ type: "move", x: box.left + 600, y }, { type: "down" }, { type: "move", x: box.left + 200, y, steps: 30 }, { type: "up" }]);
    await vi.waitFor(() => expect(ranges.length).toBeGreaterThan(1));
    await nextFrame();
    const drawn = frames.stop();
    expect(selections).toHaveLength(1);
    // At most once per drawn frame. The browser may draw a frame per move:
    // sixty-two events in one frame are one notification (element.browser.test.ts).
    expect(ranges.length - 1).toBeLessThanOrEqual(drawn);
    // The pan is the instance's: no prop went in.
    expect(update).not.toHaveBeenCalled();
    for (const stop of stops) stop();
  });

  it("a click selects, and the selection store says it once", async () => {
    const { timeline } = await place();
    const selections: unknown[] = [];
    const stop = timelineState(timeline, (snapshot) => snapshot.selectedIds).subscribe((value) => selections.push(value));
    await userEvent.click(node("b"));
    await vi.waitFor(() => expect(selections.at(-1)).toEqual(["b"]));
    expect(selections).toHaveLength(2);
    stop();
  });
});

describe("<Timeline> — props and callbacks", () => {
  it("adds the host's style to its own, which the height still sets", async () => {
    await place({ style: "outline: 1px solid red", height: 200 });
    const box = document.querySelector("[data-tl-svelte]") as HTMLElement;
    expect(box.style.outlineWidth).toBe("1px");
    expect(box.style.outlineStyle).toBe("solid");
    expect([box.style.position, box.style.height]).toEqual(["relative", "200px"]);
  });

  it("hands the instance only what changed — the same items array is not new data", async () => {
    const { props, timeline } = await place({ class: "one" });
    const update = vi.spyOn(timeline, "update");
    props.class = "two";
    flushSync();
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-tl-svelte]")?.className).toBe("two");

    props.orientation = "vertical";
    props.items = [items[0] as Item];
    flushSync();
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["items", "orientation"]);
    expect(document.querySelectorAll("[role=option]")).toHaveLength(1);
    // A prop taken away goes back to its default.
    delete props.orientation;
    flushSync();
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("horizontal"));
  });

  it("calls the latest callback for an edit, and every other instance event", async () => {
    const first = vi.fn();
    const onItemMoved = vi.fn();
    const onCommand = vi.fn();
    const onItemsChanged = vi.fn();
    const { props, timeline } = await place({ editing: { enabled: true, snapMs: DAY }, onItemMoved: first, onCommand, onItemsChanged });
    props.onItemMoved = onItemMoved;
    flushSync();
    const from = centre(node("a"));
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x + 90, y: from.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(onItemMoved).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onItemMoved.mock.calls[0]?.[0].item.id).toBe("a");
    onItemsChanged.mockClear();
    timeline.setItems([items[0] as Item]);
    expect(onItemsChanged).toHaveBeenCalledTimes(1);
  });

  it("lets go of the instance on unmount, and clears the binding", async () => {
    const { props, timeline } = await place();
    const destroy = vi.spyOn(timeline, "destroy");
    unmount(mounted as Record<string, unknown>);
    mounted = undefined;
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(props.timeline).toBeNull();
  });

  it("keeps a selection the same when an isEqual says so", async () => {
    const { timeline } = await place();
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => b[index] === id);
    const seen: unknown[] = [];
    // A new array each time: without isEqual, every snapshot would emit.
    const stop = timelineState(timeline, (snapshot) => [...snapshot.selectedIds], same).subscribe((value) => seen.push(value));
    timeline.zoomBy(2);
    timeline.flush();
    await nextFrame();
    expect(seen).toHaveLength(1);
    timeline.select(["a"]);
    timeline.flush();
    await nextFrame();
    expect(seen.at(-1)).toEqual(["a"]);
    stop();
  });
});

describe("<Timeline> — props written anew on every view change", () => {
  /** What a page that writes `editing={{ … }}` and keeps the view in its state does: every view change hands a new `editing` object. */
  async function rerendering(): Promise<{ props: Record<string, unknown>; timeline: TimelineInstance; writes: () => number }> {
    let writes = 0;
    const placed = await place({ editing: { enabled: true, snapMs: DAY } });
    placed.props.onViewportChanged = () => {
      writes += 1;
      placed.props.editing = { enabled: true, snapMs: DAY };
    };
    return { ...placed, writes: () => writes };
  }

  it("a pan goes all the way, though every frame of it wrote the props again", async () => {
    const { timeline, writes } = await rerendering();
    const y = centre(node("c")).y;
    const left = (document.querySelector("[data-tl-svelte]") as HTMLElement).getBoundingClientRect().left;
    await commands.mouse([
      { type: "move", x: left + 60, y },
      { type: "down" },
      { type: "move", x: left + 260, y, steps: 30 },
      { type: "up" },
    ]);
    await nextFrame();
    expect(writes()).toBeGreaterThan(1);
    expect(Math.abs(timeline.getSnapshot().domain[0] - (domain[0] - 6 * DAY))).toBeLessThan(DAY / 4);
  });

  it("a drag goes through; defaultDomain and defaultSelectedIds are where it starts, and only that", async () => {
    const { props } = await rerendering();
    const moved = vi.fn();
    props.onItemMoved = moved;
    const from = centre(node("a"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0]?.[0].to.start).toBe(T0 + 5 * DAY);
    unmount(mounted as Record<string, unknown>);
    mounted = undefined;
    document.body.replaceChildren();
    const started = await place({ defaultDomain: [T0, T0 + 4 * DAY], defaultSelectedIds: ["b"] });
    expect(started.timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
    expect(started.timeline.getSnapshot().selectedIds).toEqual(["b"]);
    const update = vi.spyOn(started.timeline, "update");
    started.props.defaultDomain = [T0, T0 + 8 * DAY];
    await tick();
    await nextFrame();
    expect(update).not.toHaveBeenCalled();
    expect(started.timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
  });
});

describe("<Timeline> — hydration", () => {
  it("hydrates Svelte's own server output: the same nodes, no mismatch, and live", async () => {
    const warnings: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args));
    const errors: unknown[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    const base = { items, lanes, defaultDomain: domain, height: 260, ssrWidth: 800, locale: "hu", timeZone: "UTC" };
    const container = host();
    // The server's markup, as the parser builds it — as a page would deliver it.
    container.innerHTML = await commands.ssr(base);
    const svg = container.querySelector("svg");
    const options = [...container.querySelectorAll("[data-tl-id]")];
    expect(options).toHaveLength(3);
    const removed: Node[] = [];
    new MutationObserver((records) => {
      for (const each of records) removed.push(...each.removedNodes);
    }).observe(container, { childList: true, subtree: true });
    const props = reactiveProps<Record<string, unknown>>({ ...base, timeline: null });
    mounted = hydrate(Timeline, { target: container, props });
    await vi.waitFor(() => expect((props.timeline as TimelineInstance | null)?.result).toBeDefined());
    await nextFrame();

    expect(warnings.filter((each) => String(each).includes("hydrat"))).toEqual([]);
    expect(errors).toEqual([]);
    expect(container.querySelector("svg")).toBe(svg);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect([...container.querySelectorAll("[data-tl-id]")]).toEqual(options);
    expect(removed.filter((each) => each.nodeName === "svg" || (each instanceof Element && each.hasAttribute("data-tl-id")))).toEqual([]);
    warn.mockRestore();
    error.mockRestore();

    (svg as SVGSVGElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect((props.timeline as TimelineInstance).getSnapshot().selectedIds).toEqual(["a"]));
  });
});
