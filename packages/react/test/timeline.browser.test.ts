import { createElement, Profiler, StrictMode, useState } from "react";
import type { ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { Timeline, useTimelineState } from "../src/index.js";
import type { TimelineInstance, TimelineProps, TimelineSnapshot } from "../src/index.js";

/**
 * The adapter in a real Chromium with the real React DOM.
 *
 * The claim is that React subscribes to the instance as an
 * external store and does not re-render per event. The count is React's
 * own: a `<Profiler>` reports every commit of the subtree, and a probe
 * component counts its own renders.
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

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  root = undefined;
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
const node = (id: string): Element => document.querySelector(`[data-tl-id="${id}"]`) as Element;
function centre(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** A page: the timeline, a selection readout and a range readout, each counting its renders. */
function harness(extra: Partial<TimelineProps> = {}) {
  const counts = { timelineCommits: 0, selection: 0, range: 0, app: 0 };
  let instance: TimelineInstance | null = null;
  function Selection({ timeline }: { timeline: TimelineInstance | null }): ReactElement {
    counts.selection += 1;
    const ids = useTimelineState(timeline, (snapshot) => snapshot.selectedIds);
    return createElement("output", { id: "selection" }, (ids ?? []).join(","));
  }
  function Range({ timeline }: { timeline: TimelineInstance | null }): ReactElement {
    counts.range += 1;
    const range = useTimelineState(timeline, (snapshot) => snapshot.domain);
    return createElement("output", { id: "range" }, range === undefined ? "" : `${String(range[0])}-${String(range[1])}`);
  }
  function App(props: Partial<TimelineProps>): ReactElement {
    counts.app += 1;
    const [timeline, setTimeline] = useState<TimelineInstance | null>(null);
    instance = timeline;
    return createElement(
      "div",
      null,
      createElement(
        Profiler,
        { id: "timeline", onRender: () => (counts.timelineCommits += 1) },
        createElement(Timeline, { items, lanes, defaultDomain: domain, height: 260, timelineRef: setTimeline, ...extra, ...props }),
      ),
      createElement(Selection, { timeline }),
      createElement(Range, { timeline }),
    );
  }
  return { counts, App, instance: () => instance as TimelineInstance | null };
}

async function ready(get: () => TimelineInstance | null): Promise<TimelineInstance> {
  await vi.waitFor(() => {
    if (get()?.result === undefined) throw new Error("not drawn yet");
  });
  await nextFrame();
  return get() as TimelineInstance;
}

describe("<Timeline> — React renders from the store, not from events", () => {
  it("a pan of real pointer events re-renders neither the timeline nor what does not read the view", async () => {
    const page = harness();
    root = createRoot(host());
    root.render(createElement(page.App));
    const timeline = await ready(page.instance);
    const before = { ...page.counts };
    // The counters count: the mount itself was a commit and a render.
    expect(before.timelineCommits).toBeGreaterThanOrEqual(1);
    expect(before.selection).toBeGreaterThanOrEqual(1);
    let moves = 0;
    document.addEventListener("pointermove", () => (moves += 1));
    const from = centre(node("b"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 200, y: from.y, steps: 30 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(timeline.getSnapshot().domain[0]).toBeLessThan(domain[0]));
    await nextFrame();
    expect(moves).toBeGreaterThanOrEqual(30);
    // The timeline's subtree did not commit once; the selection readout did
    // not render once. Only the range readout, which reads the view, did.
    expect(page.counts.timelineCommits - before.timelineCommits).toBe(0);
    expect(page.counts.selection - before.selection).toBe(0);
    expect(page.counts.app - before.app).toBe(0);
    expect(page.counts.range - before.range).toBeGreaterThan(0);
    expect(page.counts.range - before.range).toBeLessThanOrEqual(moves);
    expect(document.querySelector("#range")?.textContent).toBe(`${String(timeline.getSnapshot().domain[0])}-${String(timeline.getSnapshot().domain[1])}`);
  });

  it("sixty events in one frame are one render of what reads the view", async () => {
    const page = harness();
    const element = host();
    root = createRoot(element);
    root.render(createElement(page.App));
    await ready(page.instance);
    const before = page.counts.range;
    const container = element.querySelector("[data-tl-react]") as HTMLElement;
    const box = container.getBoundingClientRect();
    const pointer = (type: string, x: number): void => {
      container.dispatchEvent(
        new PointerEvent(type, { pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: box.left + x, clientY: box.top + 200, bubbles: true }),
      );
    };
    pointer("pointerdown", 300);
    for (let step = 1; step <= 60; step += 1) pointer("pointermove", 300 + step * 3);
    pointer("pointerup", 480);
    await nextFrame();
    await nextFrame();
    await vi.waitFor(() => expect(page.counts.range - before).toBe(1));
    await nextFrame();
    expect(page.counts.range - before).toBe(1);
  });

  it("a click re-renders the selection readout once, and the timeline not at all", async () => {
    const page = harness();
    root = createRoot(host());
    root.render(createElement(page.App));
    await ready(page.instance);
    const before = { ...page.counts };
    await userEvent.click(node("c"));
    await vi.waitFor(() => expect(document.querySelector("#selection")?.textContent).toBe("c"));
    await nextFrame();
    expect(page.counts.selection - before.selection).toBe(1);
    expect(page.counts.timelineCommits - before.timelineCommits).toBe(0);
  });
});

describe("<Timeline> — props and callbacks", () => {
  it("calls the latest callback, without resubscribing", async () => {
    const page = harness();
    const first = vi.fn();
    const second = vi.fn();
    root = createRoot(host());
    root.render(createElement(page.App, { onSelectionChanged: first }));
    const timeline = await ready(page.instance);
    const on = vi.spyOn(timeline, "on");
    root.render(createElement(page.App, { onSelectionChanged: second }));
    await nextFrame();
    await userEvent.click(node("a"));
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(second.mock.calls[0]?.[0]).toMatchObject({ ids: ["a"], previousIds: [] });
    expect(first).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  it("hands the instance only what changed — the same items array is not new data", async () => {
    const page = harness();
    root = createRoot(host());
    root.render(createElement(page.App, { className: "one" }));
    const timeline = await ready(page.instance);
    const update = vi.spyOn(timeline, "update");
    root.render(createElement(page.App, { className: "two" }));
    await nextFrame();
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-tl-react]")?.className).toBe("two");

    root.render(createElement(page.App, { className: "two", orientation: "vertical", items: [items[0] as Item] }));
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["items", "orientation"]);
    expect(document.querySelectorAll("[role=option]")).toHaveLength(1);
    // A prop taken away goes back to its default.
    root.render(createElement(page.App, { className: "two", items: [items[0] as Item] }));
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("horizontal"));
  });

  it("reports an edit through its callback prop", async () => {
    const page = harness({ editing: { enabled: true, snapMs: DAY } });
    const onItemMoved = vi.fn();
    const onCommand = vi.fn();
    root = createRoot(host());
    root.render(createElement(page.App, { onItemMoved, onCommand }));
    await ready(page.instance);
    const from = centre(node("a"));
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x + 90, y: from.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(onItemMoved).toHaveBeenCalledTimes(1));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onItemMoved.mock.calls[0]?.[0].item.id).toBe("a");
  });

  it("forwards every instance event as an on… prop, the items changing included", async () => {
    const page = harness({ editing: { enabled: true, snapMs: DAY } });
    const onItemsChanged = vi.fn();
    root = createRoot(host());
    root.render(createElement(page.App, { onItemsChanged }));
    const timeline = await ready(page.instance);
    onItemsChanged.mockClear();
    timeline.setItems([items[0] as Item]);
    expect(onItemsChanged).toHaveBeenCalledTimes(1);
    expect(onItemsChanged.mock.calls[0]?.[0].items).toHaveLength(1);
  });

  it("lets go of the instance on unmount, and clears an object ref", async () => {
    const ref: { current: TimelineInstance | null } = { current: null };
    root = createRoot(host());
    root.render(createElement(Timeline, { items, defaultDomain: domain, timelineRef: ref }));
    await vi.waitFor(() => expect(ref.current?.result).toBeDefined());
    const timeline = ref.current as TimelineInstance;
    root.unmount();
    root = undefined;
    expect(timeline.destroyed).toBe(true);
    expect(ref.current).toBeNull();
  });

  it("survives StrictMode's double effects with one live drawing", async () => {
    const ref: { current: TimelineInstance | null } = { current: null };
    root = createRoot(host());
    root.render(createElement(StrictMode, null, createElement(Timeline, { items, lanes, defaultDomain: domain, timelineRef: ref })));
    await vi.waitFor(() => expect(ref.current?.result).toBeDefined());
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    await userEvent.click(node("b"));
    await vi.waitFor(() => expect(ref.current?.getSnapshot().selectedIds).toEqual(["b"]));
  });

  it("keeps a selection the same when an isEqual says so", async () => {
    let renders = 0;
    let instance: TimelineInstance | null = null;
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => b[index] === id);
    function Probe({ timeline }: { timeline: TimelineInstance | null }): null {
      renders += 1;
      // A new array each time: without isEqual, every snapshot would render.
      useTimelineState(timeline, (snapshot: TimelineSnapshot) => [...snapshot.selectedIds], same);
      return null;
    }
    function App(): ReactElement {
      const [timeline, setTimeline] = useState<TimelineInstance | null>(null);
      instance = timeline;
      return createElement("div", null, createElement(Timeline, { items, defaultDomain: domain, timelineRef: setTimeline }), createElement(Probe, { timeline }));
    }
    root = createRoot(host());
    root.render(createElement(App));
    const timeline = await ready(() => instance);
    const before = renders;
    timeline.zoomBy(2);
    timeline.flush();
    await nextFrame();
    expect(renders).toBe(before);
  });
});

describe("<Timeline> — a page that re-renders on every view change", () => {
  /** The README's timeline, with a state set from `onViewportChanged`: every frame of a pan is a render, every render a new `editing` object. */
  function page(): { App: () => ReactElement; moved: ReturnType<typeof vi.fn>; renders: () => number; instance: () => TimelineInstance | null } {
    let instance: TimelineInstance | null = null;
    let renders = 0;
    const moved = vi.fn();
    function App(): ReactElement {
      const [, setView] = useState<readonly [number, number] | null>(null);
      renders += 1;
      return createElement(Timeline, {
        items,
        lanes,
        defaultDomain: domain,
        height: 260,
        editing: { enabled: true, snapMs: DAY },
        onViewportChanged: ({ viewport }) => setView(viewport.domain),
        onItemMoved: moved,
        timelineRef: (timeline: TimelineInstance | null) => {
          instance = timeline;
        },
      });
    }
    return { App, moved, renders: () => renders, instance: () => instance };
  }

  it("a pan goes all the way, though every frame of it re-rendered the page", async () => {
    const view = page();
    const element = host();
    root = createRoot(element);
    root.render(createElement(view.App));
    const timeline = await ready(view.instance);
    const before = view.renders();
    // An empty stretch of the second lane: a press there pans.
    const y = centre(node("c")).y;
    const left = element.getBoundingClientRect().left;
    await commands.mouse([
      { type: "move", x: left + 60, y },
      { type: "down" },
      { type: "move", x: left + 260, y, steps: 30 },
      { type: "up" },
    ]);
    await nextFrame();
    expect(view.renders() - before).toBeGreaterThan(1);
    // 200 px of 800 over 24 days: six days earlier.
    expect(Math.abs(timeline.getSnapshot().domain[0] - (domain[0] - 6 * DAY))).toBeLessThan(DAY / 4);
  });

  it("a drag goes through, and a new defaultDomain on a later render does not move the view", async () => {
    const view = page();
    root = createRoot(host());
    root.render(createElement(view.App));
    const timeline = await ready(view.instance);
    const from = centre(node("a"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(view.moved).toHaveBeenCalledTimes(1));
    // 100 px of 800 over 24 days: three days.
    expect(view.moved.mock.calls[0]?.[0].to.start).toBe(T0 + 5 * DAY);
    const update = vi.spyOn(timeline, "update");
    root.render(createElement(Timeline, { items, lanes, defaultDomain: [T0, T0 + 4 * DAY], defaultSelectedIds: ["b"], height: 260 }));
    await nextFrame();
    expect(update.mock.calls.flatMap((call) => Object.keys(call[0]))).not.toContain("domain");
    expect(timeline.getSnapshot().domain).toEqual(domain);
    expect(timeline.getSnapshot().selectedIds).toEqual([]);
  });
});

describe("<Timeline> — hydration", () => {
  it("hydrates React's own server output: the same nodes, no mismatch, and live", async () => {
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    const ref: { current: TimelineInstance | null } = { current: null };
    const element = (): ReactElement => createElement(Timeline, { items, lanes, defaultDomain: domain, height: 260, ssrWidth: 800, locale: "hu", timeZone: "UTC", timelineRef: ref });
    const container = host();
    container.innerHTML = renderToString(element());
    // The server's render runs here in a page, where `document` exists: the
    // component takes useLayoutEffect, and React 18 (not 19) warns that it does
    // nothing on a server. A real server has no document and takes useEffect.
    errors.splice(0, errors.length, ...errors.filter((args) => !String((args as unknown[])[0]).startsWith("Warning: useLayoutEffect does nothing on the server")));
    const svg = container.querySelector("svg");
    const options = [...container.querySelectorAll("[data-tl-id]")];
    expect(options).toHaveLength(3);
    const removed: Node[] = [];
    new MutationObserver((records) => {
      for (const each of records) removed.push(...each.removedNodes);
    }).observe(container, { childList: true, subtree: true });
    const recoverable: unknown[] = [];
    root = hydrateRoot(container, element(), { onRecoverableError: (error) => recoverable.push(error) });
    await vi.waitFor(() => expect(ref.current?.result).toBeDefined());
    await nextFrame();

    expect(recoverable).toEqual([]);
    expect(errors).toEqual([]);
    expect(container.querySelector("svg")).toBe(svg);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect([...container.querySelectorAll("[data-tl-id]")]).toEqual(options);
    expect(removed.filter((each) => each.nodeName === "svg" || (each instanceof Element && each.hasAttribute("data-tl-id")))).toEqual([]);
    consoleError.mockRestore();

    (svg as SVGSVGElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(ref.current?.getSnapshot().selectedIds).toEqual(["a"]));
  });
});
