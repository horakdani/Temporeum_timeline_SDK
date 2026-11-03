import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { renderTimelineSvg } from "@temporeum/timeline-element";

import { Timeline, useTimelineState } from "../src/index.js";
import type { TimelineProps } from "../src/index.js";

/**
 * The adapter on a server: Node, no DOM. Importing it, and rendering it with
 * React's own server renderer, must neither throw nor reach for `window`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Planning" },
  { id: "b", start: T0 + 6 * DAY, end: T0 + 9 * DAY, label: "Building" },
];

describe("the React adapter in Node", () => {
  it("imports without a browser", () => {
    for (const name of ["window", "document", "HTMLElement", "customElements"]) {
      expect(name in globalThis, name).toBe(false);
    }
    expect(typeof Timeline).toBe("function");
  });

  it("server-renders the drawing the instance would draw", () => {
    const html = renderToString(createElement(Timeline, { items, height: 240, ssrWidth: 720, instanceId: "plan", locale: "hu", timeZone: "UTC" }));
    expect(html).toMatch(/^<div style="position:relative;overflow:hidden;height:240px" data-tl-react="">/);
    const svg = renderTimelineSvg({ items, height: 240, instanceId: "plan", locale: "hu", timeZone: "UTC" }, { width: 720 }).svg;
    // React escapes nothing inside dangerouslySetInnerHTML: byte for byte.
    expect(html).toContain(svg);
    expect(html.match(/role="option"/g)).toHaveLength(2);
  });

  it("scopes the stylesheet by React's id when the host gave none", () => {
    const html = renderToString(createElement(Timeline, { items }));
    expect(html).toMatch(/data-tl-instance="tl[a-zA-Z0-9_-]+"/);
    expect(html).not.toMatch(/data-tl-instance="[^"]*[:«»]/);
  });

  it("server-renders a state hook as nothing yet", () => {
    let seen: unknown = "unset";
    function Probe(): null {
      seen = useTimelineState(null, (snapshot) => snapshot.selectedIds);
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen).toBeUndefined();
  });

  it("passes className and style through", () => {
    const html = renderToString(createElement(Timeline, { items, className: "plan", style: { height: 500, margin: 4 } }));
    expect(html).toContain('class="plan"');
    expect(html).toContain("height:500px;margin:4px");
  });
});

describe("props", () => {
  it("take an explicit undefined, as a conditional prop spells it (exactOptionalPropertyTypes)", () => {
    const narrow = false as boolean;
    const props: TimelineProps = { items: [], domain: narrow ? [0, 1] : undefined, height: undefined, editing: narrow ? { enabled: true } : undefined };
    expect(renderToString(createElement(Timeline, props))).toContain("<svg");
  });
});
