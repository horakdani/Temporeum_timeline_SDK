import { Component, createComponent, provideZonelessChangeDetection, signal } from "@angular/core";
import type { ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import type { Item } from "@temporeum/timeline-core";

import * as adapter from "../src/index.js";
import { TimelineComponent, TimelineItemDirective } from "../src/index.js";
import type { TimelineComponentConfig, TimelineInstance } from "../src/index.js";

registerPlugin(itemsPlugin);

/**
 * Parity with the other adapters: React has
 * `renderItem` and Vue the `#item` slot, and the Angular component had no
 * item template; its outputs lacked `slotsChanged`; and it exported
 * `TimelineIds`, an injectable of its own internals.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building" },
];

@Component({
  selector: "tl-host",
  imports: [TimelineComponent, TimelineItemDirective],
  template: `<tl-timeline [config]="config()" (ready)="ready($event)" (slotsChanged)="slotsSeen = slotsSeen + 1">
    <ng-template tlItem let-item><b class="card">{{ item.label }}</b></ng-template>
  </tl-timeline>`,
})
class Host {
  readonly config = signal<TimelineComponentConfig>({ items, defaultDomain: [T0, T0 + 24 * DAY], height: 200 });
  timeline: TimelineInstance | null = null;
  slotsSeen = 0;
  ready(instance: TimelineInstance | null): void {
    this.timeline = instance;
  }
}

let app: ApplicationRef | undefined;
afterEach(() => {
  app?.destroy();
  app = undefined;
  document.body.replaceChildren();
});

describe("<tl-timeline> item template and outputs", () => {
  it("renders each drawn item's content from the tlItem template, in the box over it", async () => {
    app = await createApplication({ providers: [provideZonelessChangeDetection()] });
    const hostElement = document.createElement("tl-host");
    hostElement.style.display = "block";
    hostElement.style.width = "800px";
    document.body.append(hostElement);
    const ref = createComponent(Host, { environmentInjector: app.injector, hostElement });
    app.attachView(ref.hostView);
    app.tick();
    await vi.waitFor(() => expect(document.querySelectorAll(".card")).toHaveLength(2));
    const card = document.querySelector(".card") as HTMLElement;
    expect(card.textContent).toBe("Planning");
    expect(card.closest("[data-tl-angular]")).not.toBeNull();
    // A changed item is the template's new context; the view stays.
    const timeline = ref.instance.timeline as TimelineInstance;
    timeline.updateItems([{ id: "a", label: "Plan" }]);
    timeline.flush();
    await vi.waitFor(() => expect(document.querySelector(".card")?.textContent).toBe("Plan"));
    expect(document.querySelector(".card")).toBe(card);
    expect(ref.instance.slotsSeen).toBeGreaterThan(0);
    // An item that leaves the view takes its view with it.
    timeline.zoomTo([T0, T0 + 7 * DAY]);
    timeline.flush();
    await vi.waitFor(() => expect(document.querySelectorAll(".card")).toHaveLength(1));
    expect(document.querySelector(".card")?.textContent).toBe("Plan");
  });

  it("keeps the template's boxes when the config changes after mount (R17)", async () => {
    // The first render added `slots: true` for the template, the config effect
    // did not, so the first change sent `slots: undefined` and the cards went.
    app = await createApplication({ providers: [provideZonelessChangeDetection()] });
    const hostElement = document.createElement("tl-host");
    hostElement.style.display = "block";
    hostElement.style.width = "800px";
    document.body.append(hostElement);
    const ref = createComponent(Host, { environmentInjector: app.injector, hostElement });
    app.attachView(ref.hostView);
    app.tick();
    await vi.waitFor(() => expect(document.querySelectorAll(".card")).toHaveLength(2));
    ref.instance.config.set({ items, defaultDomain: [T0, T0 + 24 * DAY], height: 240 });
    app.tick();
    const timeline = ref.instance.timeline as TimelineInstance;
    timeline.flush();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    timeline.flush();
    expect(document.querySelectorAll(".card")).toHaveLength(2);
    expect(timeline.slots.size).toBe(2);
  });

  it("types let-item through its context guard", () => {
    const directive = Object.create(TimelineItemDirective.prototype) as TimelineItemDirective;
    expect(TimelineItemDirective.ngTemplateContextGuard(directive, { $implicit: items[0], item: items[0] })).toBe(true);
    expect(TimelineItemDirective.ngTemplateContextGuard(directive, null)).toBe(false);
  });

  it("does not export its internals", () => {
    expect(adapter).not.toHaveProperty("TimelineIds");
  });
});
