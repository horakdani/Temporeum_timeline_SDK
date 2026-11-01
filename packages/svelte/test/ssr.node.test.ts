import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { renderTimelineSvg } from "@temporeum/timeline-element";

import { Timeline, timelineState } from "../src/index.js";

/**
 * The adapter on a server: Node, no DOM. Importing it, and rendering it with
 * Svelte's own server renderer, must neither throw nor reach for `window`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Tervezés" },
  { id: "b", start: T0 + 6 * DAY, end: T0 + 9 * DAY, label: "Építés" },
];

describe("the Svelte adapter in Node", () => {
  it("imports without a browser", () => {
    for (const name of ["window", "document", "HTMLElement", "customElements"]) {
      expect(name in globalThis, name).toBe(false);
    }
    expect(typeof Timeline).toBe("function");
  });

  it("server-renders the drawing the instance would draw", () => {
    const { body } = render(Timeline, { props: { items, height: 240, ssrWidth: 720, instanceId: "plan", locale: "hu", timeZone: "UTC" } });
    expect(body).toContain('<div style="position:relative;overflow:hidden;height:240px;" data-tl-svelte="">');
    const svg = renderTimelineSvg({ items, height: 240, instanceId: "plan", locale: "hu", timeZone: "UTC" }, { width: 720 }).svg;
    // {@html} is not escaped: byte for byte.
    expect(body).toContain(svg);
    expect(body.match(/role="option"/g)).toHaveLength(2);
  });

  it("scopes the stylesheet by Svelte's id when the host gave none", () => {
    const { body } = render(Timeline, { props: { items } });
    expect(body).toMatch(/data-tl-instance="tl[a-zA-Z0-9_-]+"/);
  });

  it("gives a store of nothing while there is no instance", () => {
    const seen: unknown[] = [];
    const stop = timelineState(null, (snapshot) => snapshot.selectedIds).subscribe((value) => seen.push(value));
    stop();
    expect(seen).toEqual([undefined]);
  });

  it("passes class and style through, and leaves the callbacks out of the drawing", () => {
    const { body } = render(Timeline, { props: { items, class: "plan", style: "margin:4px", onItemMoved: () => {} } });
    expect(body).toContain('class="plan"');
    expect(body).toContain("height:300px;margin:4px");
    expect(body).not.toContain("onItemMoved");
  });
});
