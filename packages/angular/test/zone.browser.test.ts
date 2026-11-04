import { createComponent, NgZone, provideZonelessChangeDetection, ɵNoopNgZone as NoopNgZone } from "@angular/core";
import type { ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

import { registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";
import type { Item } from "@temporeum/timeline-core";

import { TimelineComponent } from "../src/index.js";

registerPlugin(toolsPlugin);

/**
 * The instance runs outside Angular's zone. With
 * zone.js, every listener and timer is bound to the zone it was made in, and
 * each one that fires in Angular's zone checks the whole application: a
 * pointer move, a frame, a resize — and `rolling`'s interval, which kept the
 * application from ever being stable. The suite has no zone.js; this zone
 * does what zone.js does that matters here — it says, for each listener,
 * frame and timer the instance makes, which zone it was made in.
 */

class RecordingZone extends NoopNgZone {
  inside = false;
  readonly made: { readonly what: string; readonly inside: boolean }[] = [];
  readonly emitted: boolean[] = [];
  override run<R>(fn: (...args: unknown[]) => R): R {
    const was = this.inside;
    this.inside = true;
    try {
      return fn();
    } finally {
      this.inside = was;
    }
  }
  override runOutsideAngular<R>(fn: (...args: unknown[]) => R): R {
    const was = this.inside;
    this.inside = false;
    try {
      return fn();
    } finally {
      this.inside = was;
    }
  }
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building" },
];

let app: ApplicationRef | undefined;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  app?.destroy();
  app = undefined;
  document.body.replaceChildren();
});

/**
 * Note, for each listener, frame, timer and resize observer made from now on,
 * the zone it was made in — and run its callback in that zone, as zone.js
 * does, so what a callback makes is made where the callback runs.
 */
function record(zone: RecordingZone): void {
  const inZoneOf = <A extends unknown[], R>(callback: (...args: A) => R): ((...args: A) => R) => {
    const made = zone.inside;
    return (...args: A): R => {
      const was = zone.inside;
      zone.inside = made;
      try {
        return callback(...args);
      } finally {
        zone.inside = was;
      }
    };
  };
  const wrapped = new WeakMap<object, EventListener>();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const frame = window.requestAnimationFrame;
  const interval = window.setInterval;
  // The DOM's signature, not Node's: a handler and a delay, an id back.
  const every = interval.bind(window) as (handler: () => void, timeout?: number) => number;
  const Observer = window.ResizeObserver;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    zone.made.push({ what: `listener ${type}`, inside: zone.inside });
    if (typeof listener !== "function") return add.call(this, type, listener, options);
    const inZone = wrapped.get(listener) ?? (inZoneOf(listener) as EventListener);
    wrapped.set(listener, inZone);
    add.call(this, type, inZone, options);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    remove.call(this, type, (listener !== null && wrapped.get(listener)) || listener, options);
  };
  window.requestAnimationFrame = (callback) => {
    zone.made.push({ what: "frame", inside: zone.inside });
    return frame.call(window, inZoneOf(callback));
  };
  window.setInterval = ((handler: () => void, timeout?: number): number => {
    zone.made.push({ what: "interval", inside: zone.inside });
    return every(inZoneOf(handler), timeout);
  }) as never;
  window.ResizeObserver = class extends Observer {
    constructor(callback: ResizeObserverCallback) {
      zone.made.push({ what: "resize observer", inside: zone.inside });
      super(inZoneOf(callback));
    }
  };
  restores.push(() => {
    EventTarget.prototype.addEventListener = add;
    EventTarget.prototype.removeEventListener = remove;
    window.requestAnimationFrame = frame;
    window.setInterval = interval;
    window.ResizeObserver = Observer;
  });
}

describe("<tl-timeline> and Angular's zone", () => {
  it("makes its listeners, frames and timers outside the zone, and emits a listened-to output inside it", async () => {
    // Angular's own work runs in its zone.
    const zone = new RecordingZone();
    zone.inside = true;
    app = await createApplication({ providers: [provideZonelessChangeDetection(), { provide: NgZone, useValue: zone }] });
    const hostElement = document.createElement("tl-timeline");
    const box = document.createElement("div");
    box.style.width = "800px";
    box.append(hostElement);
    document.body.append(box);
    record(zone);
    const ref = createComponent(TimelineComponent, { environmentInjector: app.injector, hostElement });
    ref.setInput("config", { items, defaultDomain: [T0, T0 + 24 * DAY], height: 200, rolling: { intervalMs: 50 } });
    ref.instance.viewportChanged.subscribe(() => zone.emitted.push(zone.inside));
    app.attachView(ref.hostView);
    app.tick();
    await vi.waitFor(() => expect(ref.instance.timeline?.result).toBeDefined());
    const made = zone.made;
    expect(made.some((each) => each.what === "interval"), "the rolling clock was started").toBe(true);
    expect(made.some((each) => each.what === "listener pointerdown"), "the input was attached").toBe(true);
    expect(made.filter((each) => each.inside).map((each) => each.what)).toEqual([]);
    // A config change is the instance's work too.
    zone.made.length = 0;
    ref.setInput("config", { items, defaultDomain: [T0, T0 + 24 * DAY], height: 200, rolling: { intervalMs: 80 } });
    app.tick();
    expect(zone.made.filter((each) => each.inside).map((each) => each.what)).toEqual([]);
    // A pan: the output someone listens to is emitted in the zone.
    const svg = document.querySelector("svg") as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const y = bounds.top + 12;
    await commands.mouse([{ type: "move", x: bounds.left + 600, y }, { type: "down" }, { type: "move", x: bounds.left + 300, y, steps: 10 }, { type: "up" }]);
    await vi.waitFor(() => expect(zone.emitted.length).toBeGreaterThan(0));
    expect(zone.emitted.every(Boolean)).toBe(true);
  });
});
