import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import type { Item } from "@temporeum/timeline-core";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";
import { reactiveProps } from "./props.svelte.js";

registerPlugin(itemsPlugin);

/**
 * The `item` snippet (W11 of the quality round): React has `renderItem`,
 * Vue the `#item` slot, and Svelte had neither — its content for an item was
 * a `template` string or nothing. Each drawn item's content is now the
 * snippet's, in the box over the item, and it stays mounted while the item
 * is drawn.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building" },
];

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted !== undefined) unmount(mounted);
  mounted = undefined;
  document.body.replaceChildren();
});

describe("<Timeline> item snippet (W11)", () => {
  it("renders each drawn item's content in the box over it, and keeps it mounted through a zoom", async () => {
    let mounts = 0;
    const item = createRawSnippet((get: () => Item) => ({
      render: () => `<b class="card">${String(get().label)}</b>`,
      setup: () => {
        mounts += 1;
      },
    }));
    const target = document.createElement("div");
    target.style.width = "800px";
    document.body.append(target);
    const props = reactiveProps<Record<string, unknown>>({ items, defaultDomain: [T0, T0 + 24 * DAY], height: 200, timeline: null, item });
    mounted = mount(Timeline, { target, props });
    await vi.waitFor(() => expect(document.querySelectorAll(".card")).toHaveLength(2));
    const card = document.querySelector(".card") as HTMLElement;
    // In the instance's box over the item, not beside the drawing.
    expect(card.closest("[data-tl-svelte]")).not.toBeNull();
    expect(mounts).toBe(2);
    const timeline = props.timeline as TimelineInstance;
    timeline.zoomBy(1.5);
    timeline.flush();
    flushSync();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelectorAll(".card")).toHaveLength(2);
    expect(mounts).toBe(2);
    // The label is still the item's accessible name.
    expect(document.querySelector("[data-tl-id='a']")?.getAttribute("aria-label")).toContain("Planning");
  });
});

describe("a client-only mount writes no HTML (W13)", () => {
  it("computes no server drawing and sets no innerHTML: the instance draws with the DOM", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML") as PropertyDescriptor;
    let writes = 0;
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...descriptor,
      set(this: Element, value: string) {
        if (value.includes("<svg")) writes += 1;
        (descriptor.set as (value: string) => void).call(this, value);
      },
    });
    try {
      const target = document.createElement("div");
      target.style.width = "800px";
      document.body.append(target);
      const props = reactiveProps<Record<string, unknown>>({ items, defaultDomain: [T0, T0 + 24 * DAY], height: 200, timeline: null });
      mounted = mount(Timeline, { target, props });
      await vi.waitFor(() => expect((props.timeline as TimelineInstance | null)?.result).toBeDefined());
      expect(writes).toBe(0);
      expect(target.querySelectorAll("svg")).toHaveLength(1);
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", descriptor);
    }
  });
});
