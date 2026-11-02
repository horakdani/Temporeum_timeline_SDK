import { describe, expect, it } from "vitest";

import type { Item } from "@temporeum/timeline-core";
import { renderTimelineSvg } from "@temporeum/timeline-element";

/**
 * The adapter on a server: Node, no DOM. Importing it must not reach for
 * `window`; rendering it with Angular's own server renderer prints the
 * drawing the instance would draw.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Planning" },
  { id: "b", start: T0 + 6 * DAY, end: T0 + 9 * DAY, label: "Building" },
];

describe("the Angular adapter in Node", () => {
  it("imports without a browser", async () => {
    for (const name of ["window", "document", "HTMLElement", "customElements"]) {
      expect(name in globalThis, name).toBe(false);
    }
    const module = await import("../src/index.js");
    expect(typeof module.TimelineComponent).toBe("function");
    for (const name of ["window", "document"]) expect(name in globalThis, name).toBe(false);
  });

  it("server-renders the drawing the instance would draw, with its scope, its class and its height", async () => {
    const { Component, provideZonelessChangeDetection } = await import("@angular/core");
    const { bootstrapApplication } = await import("@angular/platform-browser");
    const { renderApplication } = await import("@angular/platform-server");
    const { TimelineComponent } = await import("../src/index.js");
    const config = { items, height: 240, instanceId: "plan", locale: "hu", timeZone: "UTC" };
    @Component({
      selector: "app-root",
      imports: [TimelineComponent],
      template: '<tl-timeline class="plan" [config]="config" [ssrWidth]="720" /><tl-timeline [config]="other" />',
    })
    class App {
      config = config;
      other = { items };
    }
    const html = await renderApplication((context) => bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }, context), {
      document: "<!doctype html><html><head></head><body><app-root></app-root></body></html>",
      url: "/",
    });
    // Angular's server DOM writes an empty element out in full, `<rect …></rect>`
    // for `<rect …/>`: the same nodes, as a browser parses either.
    const svg = renderTimelineSvg(config, { width: 720 }).svg.replace(/<([a-zA-Z]+)((?:\s[^<>]*?)?)\/>/g, "<$1$2></$1>");
    expect(html).toContain(svg);
    expect(html).toContain('class="plan"');
    expect(html).toMatch(/data-tl-angular=""[^>]*height: 240px|height: 240px[^>]*data-tl-angular=""/);
    // The second takes the next scope of the application.
    expect(html).toContain('data-tl-instance="tl-ng1"');
    expect(html.match(/role="option"/g)).toHaveLength(4);
  });
});
