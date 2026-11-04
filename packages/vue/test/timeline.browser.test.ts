import { createApp, createSSRApp, defineComponent, h, nextTick, reactive, shallowRef } from "vue";
import type { App, ShallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { Timeline, useTimelineState } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";

/**
 * The adapter in a real Chromium with the real Vue.
 *
 * The claim is React's: Vue subscribes to the instance as an external store
 * and does not re-render per event. The count is the probes' own — every
 * render of the component that holds the timeline, and of the two that
 * read its store, is one increment.
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

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
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

/** A page: the timeline, a selection readout and a range readout, each counting its renders. */
function harness(extra: Record<string, unknown> = {}) {
  const counts = { page: 0, selection: 0, range: 0 };
  const timeline: ShallowRef<TimelineInstance | null> = shallowRef(null);
  const props = reactive<Record<string, unknown>>({ items, lanes, defaultDomain: domain, height: 260, ...extra });
  const Selection = defineComponent({
    setup() {
      const ids = useTimelineState(timeline, (snapshot) => snapshot.selectedIds);
      return () => {
        counts.selection += 1;
        return h("output", { id: "selection" }, (ids.value ?? []).join(","));
      };
    },
  });
  const Range = defineComponent({
    setup() {
      const range = useTimelineState(() => timeline.value, (snapshot) => snapshot.domain);
      return () => {
        counts.range += 1;
        return h("output", { id: "range" }, range.value === undefined ? "" : `${String(range.value[0])}-${String(range.value[1])}`);
      };
    },
  });
  const Page = defineComponent({
    setup() {
      return () => {
        counts.page += 1;
        return h("div", [
          h(Timeline, {
            ...props,
            onReady: (instance: TimelineInstance | null) => {
              timeline.value = instance;
            },
          }),
          h(Selection),
          h(Range),
        ]);
      };
    },
  });
  return { counts, Page, props, timeline };
}

async function ready(timeline: ShallowRef<TimelineInstance | null>): Promise<TimelineInstance> {
  await vi.waitFor(() => {
    if (timeline.value?.result === undefined) throw new Error("not drawn yet");
  });
  await nextFrame();
  return timeline.value as TimelineInstance;
}

describe("<Timeline> — Vue renders from the store, not from events", () => {
  it("a pan of real pointer events re-renders neither the page nor what does not read the view", async () => {
    const page = harness();
    app = createApp(page.Page);
    app.mount(host());
    await ready(page.timeline);
    const before = { ...page.counts };
    const svg = document.querySelector("svg") as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const y = box.top + 12;
    const frames = countFrames();
    await commands.mouse([{ type: "move", x: box.left + 600, y }, { type: "down" }, { type: "move", x: box.left + 200, y, steps: 30 }, { type: "up" }]);
    await vi.waitFor(() => expect(page.counts.range).toBeGreaterThan(before.range));
    await nextFrame();
    const drawn = frames.stop();
    expect(page.counts.page).toBe(before.page);
    expect(page.counts.selection).toBe(before.selection);
    // At most once per drawn frame. The browser may draw a frame per move:
    // sixty-two events in one frame are one notification (element.browser.test.ts).
    expect(page.counts.range - before.range).toBeLessThanOrEqual(drawn);
  });

  it("a click re-renders the selection readout once, and the page not at all", async () => {
    const page = harness();
    app = createApp(page.Page);
    app.mount(host());
    await ready(page.timeline);
    const before = { ...page.counts };
    await userEvent.click(node("b"));
    await vi.waitFor(() => expect(document.querySelector("#selection")?.textContent).toBe("b"));
    expect(page.counts.selection - before.selection).toBe(1);
    expect(page.counts.page).toBe(before.page);
  });
});

describe("<Timeline> — attributes and emits", () => {
  it("hands the instance only what changed — the same items array is not new data", async () => {
    const page = harness({ class: "one" });
    app = createApp(page.Page);
    app.mount(host());
    const timeline = await ready(page.timeline);
    const update = vi.spyOn(timeline, "update");
    page.props.class = "two";
    await nextTick();
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-tl-vue]")?.className).toBe("two");

    page.props.orientation = "vertical";
    page.props.items = [items[0] as Item];
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["items", "orientation"]);
    expect(document.querySelectorAll("[role=option]")).toHaveLength(1);
    // An attribute taken away goes back to its default.
    delete page.props.orientation;
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("horizontal"));
  });

  it("reads kebab-case attributes as the config's camelCase", async () => {
    const page = harness({ "default-selected-ids": ["c"] });
    app = createApp(page.Page);
    app.mount(host());
    const timeline = await ready(page.timeline);
    expect(timeline.getSnapshot().selectedIds).toEqual(["c"]);
  });

  it("emits an edit, and every other instance event, by its own name", async () => {
    const onItemMoved = vi.fn();
    const onCommand = vi.fn();
    const onItemsChanged = vi.fn();
    const page = harness({ editing: { enabled: true, snapMs: DAY }, onItemMoved, onCommand, onItemsChanged });
    app = createApp(page.Page);
    app.mount(host());
    const timeline = await ready(page.timeline);
    const from = centre(node("a"));
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x + 90, y: from.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(onItemMoved).toHaveBeenCalledTimes(1));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onItemMoved.mock.calls[0]?.[0].item.id).toBe("a");
    onItemsChanged.mockClear();
    timeline.setItems([items[0] as Item]);
    expect(onItemsChanged).toHaveBeenCalledTimes(1);
  });

  it("lets go of the instance on unmount, and says so with ready(null)", async () => {
    const page = harness();
    app = createApp(page.Page);
    app.mount(host());
    const timeline = await ready(page.timeline);
    const destroy = vi.spyOn(timeline, "destroy");
    app.unmount();
    app = undefined;
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(page.timeline.value).toBeNull();
  });

  it("exposes the instance on a template ref", async () => {
    const view = shallowRef<{ timeline: TimelineInstance | null } | null>(null);
    const Page = defineComponent({ setup: () => () => h(Timeline, { ref: view, items, defaultDomain: domain, height: 200 }) });
    app = createApp(Page);
    app.mount(host());
    await vi.waitFor(() => expect(view.value?.timeline?.result).toBeDefined());
    const state = useTimelineStateIn(() => view.value?.timeline);
    await vi.waitFor(() => expect(state.value).toEqual([]));
  });

  it("keeps a selection the same when an isEqual says so", async () => {
    const page = harness();
    app = createApp(page.Page);
    app.mount(host());
    const timeline = await ready(page.timeline);
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => b[index] === id);
    // A new array each time: without isEqual, every snapshot would be a new value.
    const state = useTimelineStateIn(() => page.timeline.value, (snapshot) => [...snapshot.selectedIds], same);
    const first = state.value;
    timeline.zoomBy(2);
    timeline.flush();
    await nextFrame();
    expect(state.value).toBe(first);
    timeline.select(["a"]);
    timeline.flush();
    await nextFrame();
    expect(state.value).toEqual(["a"]);
  });
});

/** The composable outside a component: in an effect scope of its own. */
function useTimelineStateIn<S = readonly string[]>(
  source: () => TimelineInstance | null | undefined,
  selector: (snapshot: ReturnType<TimelineInstance["getSnapshot"]>) => S = (snapshot) => snapshot.selectedIds as unknown as S,
  isEqual?: (a: S, b: S) => boolean,
) {
  return isEqual === undefined ? useTimelineState(source, selector) : useTimelineState(source, selector, isEqual);
}

describe("<Timeline> — a page that re-renders on every view change", () => {
  /** An inline `editing` in the render, and a state set from `@viewport-changed`: every frame of a pan is a render, every render a new object. */
  function page(): { Page: ReturnType<typeof defineComponent>; renders: () => number; timeline: ShallowRef<TimelineInstance | null>; moved: ReturnType<typeof vi.fn> } {
    const timeline: ShallowRef<TimelineInstance | null> = shallowRef(null);
    const view = shallowRef<readonly [number, number] | null>(null);
    const moved = vi.fn();
    let renders = 0;
    const Page = defineComponent({
      setup: () => () => {
        renders += 1;
        return h("div", { "data-view": String(view.value?.[0]) }, [
          h(Timeline, {
            items,
            lanes,
            defaultDomain: domain,
            height: 260,
            editing: { enabled: true, snapMs: DAY },
            onViewportChanged: ({ viewport }: { viewport: { domain: readonly [number, number] } }) => (view.value = viewport.domain),
            onItemMoved: moved,
            onReady: (instance: TimelineInstance | null) => (timeline.value = instance),
          }),
        ]);
      },
    });
    return { Page, renders: () => renders, timeline, moved };
  }

  it("a pan goes all the way, though every frame of it re-rendered the page", async () => {
    const view = page();
    const element = host();
    app = createApp(view.Page);
    app.mount(element);
    const timeline = await ready(view.timeline);
    const before = view.renders();
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
    expect(Math.abs(timeline.getSnapshot().domain[0] - (domain[0] - 6 * DAY))).toBeLessThan(DAY / 4);
  });

  it("a drag goes through; defaultDomain and defaultSelectedIds are where it starts, and only that", async () => {
    const view = page();
    app = createApp(view.Page);
    app.mount(host());
    await ready(view.timeline);
    const from = centre(node("a"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(view.moved).toHaveBeenCalledTimes(1));
    expect(view.moved.mock.calls[0]?.[0].to.start).toBe(T0 + 5 * DAY);
    app.unmount();
    document.body.replaceChildren();
    const started = harness({ defaultDomain: [T0, T0 + 4 * DAY], defaultSelectedIds: ["b"] });
    app = createApp(started.Page);
    app.mount(host());
    const timeline = await ready(started.timeline);
    expect(timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
    expect(timeline.getSnapshot().selectedIds).toEqual(["b"]);
    const update = vi.spyOn(timeline, "update");
    started.props.defaultDomain = [T0, T0 + 8 * DAY];
    await nextTick();
    await nextFrame();
    expect(update).not.toHaveBeenCalled();
    expect(timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
  });
});

describe("<Timeline> — hydration", () => {
  it("hydrates Vue's own server output: the same nodes, no mismatch, and live", async () => {
    const warnings: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args));
    const errors: unknown[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    const timeline = shallowRef<TimelineInstance | null>(null);
    const Page = defineComponent({
      setup: () => () =>
        h(Timeline, {
          items,
          lanes,
          defaultDomain: domain,
          height: 260,
          ssrWidth: 800,
          locale: "hu",
          timeZone: "UTC",
          onReady: (instance: TimelineInstance | null) => {
            timeline.value = instance;
          },
        }),
    });
    const container = host();
    // The server's markup, as the parser builds it — as a page would deliver it.
    container.innerHTML = await renderServer(Page);
    const svg = container.querySelector("svg");
    const options = [...container.querySelectorAll("[data-tl-id]")];
    expect(options).toHaveLength(3);
    const removed: Node[] = [];
    new MutationObserver((records) => {
      for (const each of records) removed.push(...each.removedNodes);
    }).observe(container, { childList: true, subtree: true });
    app = createSSRApp(Page);
    app.mount(container);
    await vi.waitFor(() => expect(timeline.value?.result).toBeDefined());
    await nextFrame();

    expect(warnings.filter((each) => String(each).includes("ydration"))).toEqual([]);
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
    await vi.waitFor(() => expect(timeline.value?.getSnapshot().selectedIds).toEqual(["a"]));
  });
});

/** Vue's server output, rendered here: the server renderer runs in the browser as in Node. */
function renderServer(component: ReturnType<typeof defineComponent>): Promise<string> {
  return renderToString(createSSRApp(component));
}
