import { createApp, defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { App } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";

registerPlugin(itemsPlugin);

/**
 * P35's `#item` slot, with the real Vue: each drawn item's content is a
 * Vue tree teleported into the box over the item, keeps its state while
 * the item is in view — through a zoom that builds new tiles — and is
 * unmounted when the item leaves.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Design", laneId: "l1" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Build", laneId: "l1" },
  { id: "c", start: T0 + 16 * DAY, end: T0 + 20 * DAY, label: "Ship", laneId: "l2" },
];
const domain: [number, number] = [T0, T0 + 24 * DAY];

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

const life = { mounts: new Map<string, number>(), unmounts: new Map<string, number>() };

const Card = defineComponent({
  props: { item: { type: Object as () => Item, required: true } },
  setup(props) {
    // State a remount would lose: set once, on mount.
    const born = ref(Math.random().toString(36).slice(2));
    onMounted(() => life.mounts.set(props.item.id, (life.mounts.get(props.item.id) ?? 0) + 1));
    onBeforeUnmount(() => life.unmounts.set(props.item.id, (life.unmounts.get(props.item.id) ?? 0) + 1));
    return () => h("span", { class: "card", "data-born": born.value }, [h("b", props.item.label), ` · ${props.item.id}`]);
  },
});

async function mount(): Promise<TimelineInstance> {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  const timeline = shallowRef<TimelineInstance | null>(null);
  app = createApp({
    setup: () => () =>
      h(
        Timeline,
        { items, defaultDomain: domain, height: 240, timeZone: "UTC", onReady: (instance: TimelineInstance | null) => (timeline.value = instance) },
        { item: ({ item }: { item: Item }) => h(Card, { item }) },
      ),
  });
  app.mount(element);
  await vi.waitFor(() => {
    if (timeline.value === null || document.querySelectorAll(".card").length !== 3) throw new Error("not rendered yet");
  });
  return timeline.value as TimelineInstance;
}

const card = (id: string): HTMLElement | null => document.querySelector(`[data-tl-slot="${id}"] .card`);

describe("the #item slot", () => {
  it("renders each drawn item's content in the box over it, the label stays the name", async () => {
    life.mounts.clear();
    await mount();
    expect(card("a")?.textContent).toBe("Design · a");
    expect(card("a")?.closest("foreignObject")?.getAttribute("class")).toBe("tl-label tl-slot");
    expect(document.querySelector('[data-tl-id="a"][role=option]')?.getAttribute("aria-label")).toContain("Design");
    expect([...life.mounts.values()]).toEqual([1, 1, 1]);
  });

  it("keeps each item's Vue state through zooms, and unmounts what leaves the view", async () => {
    life.mounts.clear();
    life.unmounts.clear();
    const warnings = vi.spyOn(console, "warn");
    const timeline = await mount();
    const born = card("b")?.dataset.born;
    for (const factor of [1.3, 0.8, 1.5]) {
      timeline.zoomBy(factor);
      timeline.flush();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await vi.waitFor(() => expect(card("b")?.isConnected).toBe(true));
    expect(card("b")?.dataset.born).toBe(born);
    expect(life.mounts.get("b")).toBe(1);
    timeline.zoomTo([T0 + 15 * DAY, T0 + 21 * DAY]);
    timeline.flush();
    await vi.waitFor(() => expect(life.unmounts.get("a")).toBe(1));
    expect(card("a")).toBeNull();
    expect(card("c")?.textContent).toBe("Ship · c");
    expect(warnings).not.toHaveBeenCalled();
    warnings.mockRestore();
  });

  it("re-renders an item's content when the item changes", async () => {
    const timeline = await mount();
    timeline.updateItems([{ id: "c", label: "Ship it" }]);
    timeline.flush();
    await vi.waitFor(() => expect(card("c")?.textContent).toBe("Ship it · c"));
  });
});
