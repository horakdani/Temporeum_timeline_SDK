import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";

registerPlugin(itemsPlugin);

/**
 * P35's `renderItem`, with the real React DOM: each drawn item's content is
 * a React tree in the box over the item, keeps its state while the item is
 * in view — through a zoom that builds new tiles — and is unmounted when
 * the item leaves.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Design", laneId: "l1" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Build", laneId: "l1" },
  { id: "c", start: T0 + 16 * DAY, end: T0 + 20 * DAY, label: "Ship", laneId: "l2" },
];
const domain: [number, number] = [T0, T0 + 24 * DAY];

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.replaceChildren();
});

const life = { mounts: new Map<string, number>(), unmounts: new Map<string, number>() };

function Card({ item }: { item: Item }): ReactElement {
  // State a remount would lose: set once, on mount.
  const [born] = useState(() => Math.random().toString(36).slice(2));
  useEffect(() => {
    life.mounts.set(item.id, (life.mounts.get(item.id) ?? 0) + 1);
    return () => {
      life.unmounts.set(item.id, (life.unmounts.get(item.id) ?? 0) + 1);
    };
  }, [item.id]);
  return createElement("span", { className: "card", "data-born": born }, createElement("b", null, item.label), " · ", item.id);
}

async function mount(): Promise<TimelineInstance> {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  let timeline: TimelineInstance | null = null;
  root = createRoot(element);
  root.render(
    createElement(Timeline, {
      items,
      domain,
      height: 240,
      timeZone: "UTC",
      renderItem: (item: Item) => createElement(Card, { item }),
      timelineRef: (instance: TimelineInstance | null) => {
        timeline = instance;
      },
    }),
  );
  await vi.waitFor(() => {
    if (timeline === null || document.querySelectorAll(".card").length !== 3) throw new Error("not rendered yet");
  });
  return timeline as unknown as TimelineInstance;
}

const card = (id: string): HTMLElement | null => document.querySelector(`[data-tl-slot="${id}"] .card`);

describe("renderItem", () => {
  it("renders each drawn item's content in the box over it, the label stays the name", async () => {
    life.mounts.clear();
    await mount();
    expect(card("a")?.textContent).toBe("Design · a");
    expect(card("c")?.textContent).toBe("Ship · c");
    expect(card("a")?.closest("foreignObject")?.getAttribute("class")).toBe("tl-label tl-slot");
    expect(document.querySelector('[data-tl-id="a"][role=option]')?.getAttribute("aria-label")).toContain("Design");
    expect([...life.mounts.values()]).toEqual([1, 1, 1]);
  });

  it("keeps each item's React state through zooms and pans, and unmounts what leaves the view", async () => {
    life.mounts.clear();
    life.unmounts.clear();
    const errors = vi.spyOn(console, "error");
    const timeline = await mount();
    const born = card("b")?.dataset.born;
    for (const factor of [1.3, 0.8, 1.5]) {
      timeline.zoomBy(factor);
      timeline.flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // The content is in the box drawn for the item now, not in one let go of.
    await vi.waitFor(() => expect(card("b")?.isConnected).toBe(true));
    expect(card("b")?.dataset.born).toBe(born);
    expect(life.mounts.get("b")).toBe(1);
    expect(life.unmounts.get("b")).toBeUndefined();

    timeline.zoomTo([T0 + 15 * DAY, T0 + 21 * DAY]);
    timeline.flush();
    await vi.waitFor(() => expect(life.unmounts.get("a")).toBe(1));
    expect(card("a")).toBeNull();
    expect(card("c")?.textContent).toBe("Ship · c");
    // Not one warning from React: the portals of a frame are rendered at once, outside its effects.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("re-renders an item's content when the item changes", async () => {
    const timeline = await mount();
    timeline.updateItems([{ id: "c", label: "Ship it" }]);
    timeline.flush();
    await vi.waitFor(() => expect(card("c")?.textContent).toBe("Ship it · c"));
  });
});
