import { createElement, createRef, startTransition, Suspense, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import { Timeline, useTimelineState } from "../src/index.js";
import type { TimelineInstance, TimelineSnapshot } from "../src/index.js";

/**
 * The React component's props and refs: the
 * latest props were taken during render, so a render React threw away left
 * its callbacks behind; a new `timelineRef` after mount was never called,
 * nor the old one cleared; `useTimelineState` cached by the snapshot alone,
 * so a selector over new state answered for the old; and `id`, `data-*`,
 * `aria-*` and React 19's `ref` became configuration keys instead of the
 * box's attributes.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building" },
];
const defaultDomain: [number, number] = [T0, T0 + 24 * DAY];

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.replaceChildren();
});

function host(): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe("<Timeline> props and refs", () => {
  it("a render React throws away does not leave its callback behind", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const never = new Promise<never>(() => {});
    let instance: TimelineInstance | null = null;
    function Suspends(): never {
      throw never;
    }
    function App({ handler, suspend }: { handler: (payload: unknown) => void; suspend: boolean }): ReactElement {
      return createElement(Suspense, { fallback: null }, createElement(Timeline, { items, defaultDomain, onSelectionChanged: handler, timelineRef: (timeline: TimelineInstance | null) => void (instance = timeline) }), suspend ? createElement(Suspends) : null);
    }
    root = createRoot(host());
    root.render(createElement(App, { handler: first, suspend: false }));
    await vi.waitFor(() => expect(instance?.result).toBeDefined());
    // A transition whose tree suspends: React keeps what is on screen and throws the render away.
    startTransition(() => root?.render(createElement(App, { handler: second, suspend: true })));
    await nextFrame();
    await nextFrame();
    (instance as TimelineInstance | null)?.select(["a"]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("a new timelineRef gets the instance, and the old one is cleared", async () => {
    const one = createRef<TimelineInstance | null>();
    const two = createRef<TimelineInstance | null>();
    root = createRoot(host());
    root.render(createElement(Timeline, { items, defaultDomain, timelineRef: one }));
    await vi.waitFor(() => expect(one.current?.result).toBeDefined());
    const timeline = one.current;
    root.render(createElement(Timeline, { items, defaultDomain, timelineRef: two }));
    await vi.waitFor(() => expect(two.current).toBe(timeline));
    expect(one.current).toBeNull();
  });

  it("useTimelineState reads the snapshot again for a new selector", async () => {
    let instance: TimelineInstance | null = null;
    let seen: boolean | undefined;
    function Probe({ timeline, id }: { timeline: TimelineInstance | null; id: string }): null {
      seen = useTimelineState(timeline, (snapshot: TimelineSnapshot) => snapshot.selectedIds.includes(id));
      return null;
    }
    function App({ id }: { id: string }): ReactElement {
      const [timeline, setTimeline] = useState<TimelineInstance | null>(null);
      instance = timeline;
      return createElement("div", null, createElement(Timeline, { items, defaultDomain, defaultSelectedIds: ["a"], timelineRef: setTimeline }), createElement(Probe, { timeline, id }));
    }
    root = createRoot(host());
    root.render(createElement(App, { id: "a" }));
    await vi.waitFor(() => expect(seen).toBe(true));
    const snapshot = (instance as TimelineInstance | null)?.getSnapshot();
    root.render(createElement(App, { id: "b" }));
    await vi.waitFor(() => expect(seen).toBe(false));
    expect((instance as TimelineInstance | null)?.getSnapshot()).toBe(snapshot);
  });

  it("puts id, data-*, aria-* and ref on the box, and keeps them out of the configuration", async () => {
    const box = createRef<HTMLDivElement>();
    let instance: TimelineInstance | null = null;
    root = createRoot(host());
    const props = { items, defaultDomain, id: "plan", "data-testid": "tl", "aria-describedby": "help", ref: box, timelineRef: (timeline: TimelineInstance | null) => void (instance = timeline) };
    root.render(createElement(Timeline, props));
    await vi.waitFor(() => expect((instance as TimelineInstance | null)?.result).toBeDefined());
    const element = document.querySelector("[data-tl-react]") as HTMLElement;
    expect(element.id).toBe("plan");
    expect(element.getAttribute("data-testid")).toBe("tl");
    expect(element.getAttribute("aria-describedby")).toBe("help");
    expect(box.current).toBe(element);
    const update = vi.spyOn(instance as unknown as TimelineInstance, "update");
    root.render(createElement(Timeline, { ...props, id: "plan-2", "data-testid": "tl-2" }));
    await vi.waitFor(() => expect(element.id).toBe("plan-2"));
    expect(element.getAttribute("data-testid")).toBe("tl-2");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("a client-only render writes no HTML", () => {
  it("sets no innerHTML on the box: the instance draws with the DOM", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML") as PropertyDescriptor;
    const writes: Element[] = [];
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...descriptor,
      set(this: Element, value: string) {
        writes.push(this);
        (descriptor.set as (value: string) => void).call(this, value);
      },
    });
    try {
      let instance: TimelineInstance | null = null;
      root = createRoot(host());
      root.render(createElement(Timeline, { items, defaultDomain, timelineRef: (timeline: TimelineInstance | null) => void (instance = timeline) }));
      await vi.waitFor(() => expect((instance as TimelineInstance | null)?.result).toBeDefined());
      expect(writes.filter((element) => element.hasAttribute("data-tl-react"))).toEqual([]);
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", descriptor);
    }
  });
});
