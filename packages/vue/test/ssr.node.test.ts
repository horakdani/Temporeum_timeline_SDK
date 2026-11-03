import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { renderTimelineSvg } from "@temporeum/timeline-element";

import { Timeline, useTimelineState } from "../src/index.js";

/**
 * The adapter on a server: Node, no DOM. Importing it, and rendering it with
 * Vue's own server renderer, must neither throw nor reach for `window`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Planning" },
  { id: "b", start: T0 + 6 * DAY, end: T0 + 9 * DAY, label: "Building" },
];

const render = (attrs: Record<string, unknown>): Promise<string> => renderToString(createSSRApp({ render: () => h(Timeline, attrs) }));

describe("the Vue adapter in Node", () => {
  it("imports without a browser", () => {
    for (const name of ["window", "document", "HTMLElement", "customElements"]) {
      expect(name in globalThis, name).toBe(false);
    }
    expect(typeof Timeline).toBe("object");
  });

  it("server-renders the drawing the instance would draw", async () => {
    const html = await render({ items, height: 240, ssrWidth: 720, instanceId: "plan", locale: "hu", "time-zone": "UTC" });
    expect(html).toMatch(/^<div style="position:relative;overflow:hidden;height:240px;" data-tl-vue(="")?>/);
    const svg = renderTimelineSvg({ items, height: 240, instanceId: "plan", locale: "hu", timeZone: "UTC" }, { width: 720 }).svg;
    // innerHTML is not escaped: byte for byte, the kebab-case attribute read as timeZone.
    expect(html).toContain(svg);
    expect(html.match(/role="option"/g)).toHaveLength(2);
  });

  it("scopes the stylesheet by Vue's id when the host gave none", async () => {
    const html = await render({ items });
    expect(html).toMatch(/data-tl-instance="tl[a-zA-Z0-9_-]+"/);
    expect(html).not.toMatch(/data-tl-instance="[^"]*[:]/);
  });

  it("server-renders a state composable as nothing yet", async () => {
    let seen: unknown = "unset";
    const Probe = defineComponent({
      setup() {
        const state = useTimelineState(null, (snapshot) => snapshot.selectedIds);
        return () => {
          seen = state.value;
          return h("output");
        };
      },
    });
    await renderToString(createSSRApp(Probe));
    expect(seen).toBeUndefined();
  });

  it("passes class and style through, and leaves the listeners out of the drawing", async () => {
    const html = await render({ items, class: "plan", style: { height: "500px", margin: "4px" }, onItemMoved: () => {} });
    expect(html).toContain('class="plan"');
    expect(html).toContain("height:500px;margin:4px;");
    expect(html).not.toContain("onItemMoved");
  });
});

describe("the plugin registry (W4)", () => {
  it("is the element's, handed on by the adapter", async () => {
    const adapter = await import("../src/index.js");
    const element = await import("@temporeum/timeline-element");
    expect(adapter.registerPlugin).toBe(element.registerPlugin);
    expect(adapter.hasPlugin).toBe(element.hasPlugin);
  });
});
