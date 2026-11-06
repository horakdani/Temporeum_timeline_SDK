import { createComponent, provideZonelessChangeDetection } from "@angular/core";
import type { ApplicationRef, ComponentRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { TimelineComponent, timelineState } from "../src/index.js";
import { renderTimelineSvg } from "@temporeum/timeline-element";
import type { TimelineComponentConfig, TimelineInstance } from "../src/index.js";

/**
 * The adapter in a real Chromium with the real Angular (JIT, zoneless).
 *
 * The claim is React's: the component subscribes to the instance as an
 * external store and does not run change detection per event — no input
 * reaches the instance and no signal changes for what a pan does not
 * change.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning", laneId: "l1" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building", laneId: "l1" },
  { id: "c", start: T0 + 16 * DAY, end: T0 + 20 * DAY, label: "Handover", laneId: "l2" },
];
const lanes = [
  { id: "l1", label: "Work" },
  { id: "l2", label: "Delivery" },
];
const domain: [number, number] = [T0, T0 + 24 * DAY];
const base: TimelineComponentConfig = { items, lanes, defaultDomain: domain, height: 260 };

let app: ApplicationRef | undefined;
afterEach(() => {
  app?.destroy();
  app = undefined;
  document.body.replaceChildren();
});

function host(): HTMLElement {
  document.body.style.margin = "0";
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Frames the browser draws from now until `stop()`: what "a frame at a time" is measured against. */
function countFrames(): { stop: () => number } {
  let frames = 0;
  let counting = true;
  const tick = (): void => {
    frames += 1;
    if (counting) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      counting = false;
      return frames;
    },
  };
}
const node = (id: string): Element => document.querySelector(`[data-tl-id="${id}"]`) as Element;
function centre(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** The component in an application of its own, its inputs set as a template would. */
async function place(config: TimelineComponentConfig = base): Promise<{ ref: ComponentRef<TimelineComponent>; timeline: TimelineInstance }> {
  app = await createApplication({ providers: [provideZonelessChangeDetection()] });
  const hostElement = document.createElement("tl-timeline");
  host().append(hostElement);
  const ref = createComponent(TimelineComponent, { environmentInjector: app.injector, hostElement });
  ref.setInput("config", config);
  app.attachView(ref.hostView);
  app.tick();
  await vi.waitFor(() => {
    if (ref.instance.timeline?.result === undefined) throw new Error("not drawn yet");
  });
  await nextFrame();
  return { ref, timeline: ref.instance.timeline as TimelineInstance };
}

describe("<tl-timeline> — Angular renders from the store, not from events", () => {
  it("a pan of real pointer events changes the range signal a frame at a time, and the selection not at all", async () => {
    const { ref, timeline } = await place();
    const injector = ref.injector;
    const { runInInjectionContext, signal } = await import("@angular/core");
    const source = signal<TimelineInstance | null>(timeline);
    const ranges: unknown[] = [];
    const selections: unknown[] = [];
    const range = runInInjectionContext(injector, () => timelineState(source, (snapshot) => snapshot.domain));
    const selection = runInInjectionContext(injector, () => timelineState(source, (snapshot) => snapshot.selectedIds));
    const { effect } = await import("@angular/core");
    runInInjectionContext(injector, () => {
      effect(() => ranges.push(range()));
      effect(() => selections.push(selection()));
    });
    app?.tick();
    const update = vi.spyOn(timeline, "update");
    const svg = document.querySelector("svg") as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const y = box.top + 12;
    const frames = countFrames();
    await commands.mouse([{ type: "move", x: box.left + 600, y }, { type: "down" }, { type: "move", x: box.left + 200, y, steps: 30 }, { type: "up" }]);
    await vi.waitFor(() => expect(ranges.length).toBeGreaterThan(1));
    await nextFrame();
    const drawn = frames.stop();
    expect(selections).toHaveLength(1);
    // At most once per drawn frame. The browser may draw a frame per move:
    // sixty-two events in one frame are one notification (element.browser.test.ts).
    expect(ranges.length - 1).toBeLessThanOrEqual(drawn);
    // The pan is the instance's: no input went in.
    expect(update).not.toHaveBeenCalled();
  });
});

describe("<tl-timeline> — a config written anew on every view change", () => {
  /** What a template with `[config]="{ …, editing: { enabled: true } }"` and the view in a signal does: every view change, a new config object. */
  async function rewriting(): Promise<{ ref: ComponentRef<TimelineComponent>; timeline: TimelineInstance; writes: () => number }> {
    let writes = 0;
    const placed = await place({ ...base, editing: { enabled: true, snapMs: DAY } });
    placed.ref.instance.viewportChanged.subscribe(() => {
      writes += 1;
      placed.ref.setInput("config", { ...base, editing: { enabled: true, snapMs: DAY } });
      app?.tick();
    });
    return { ...placed, writes: () => writes };
  }

  it("a pan goes all the way, though every frame of it set the config again", async () => {
    const { timeline, writes } = await rewriting();
    const y = centre(node("c")).y;
    const left = (document.querySelector("[data-tl-angular]") as HTMLElement).getBoundingClientRect().left;
    await commands.mouse([
      { type: "move", x: left + 60, y },
      { type: "down" },
      { type: "move", x: left + 260, y, steps: 30 },
      { type: "up" },
    ]);
    await nextFrame();
    expect(writes()).toBeGreaterThan(1);
    expect(Math.abs(timeline.getSnapshot().domain[0] - (domain[0] - 6 * DAY))).toBeLessThan(DAY / 4);
  });

  it("a drag goes through; defaultDomain and defaultSelectedIds are where it starts, and only that", async () => {
    const { ref } = await rewriting();
    const moved = vi.fn();
    ref.instance.itemMoved.subscribe(moved);
    const from = centre(node("a"));
    await commands.mouse([
      { type: "move", x: from.x, y: from.y },
      { type: "down" },
      { type: "move", x: from.x + 100, y: from.y, steps: 8 },
      { type: "up" },
    ]);
    await vi.waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0]?.[0].to.start).toBe(T0 + 5 * DAY);
    app?.destroy();
    app = undefined;
    document.body.replaceChildren();
    const started = await place({ ...base, defaultDomain: [T0, T0 + 4 * DAY], defaultSelectedIds: ["b"] });
    expect(started.timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
    expect(started.timeline.getSnapshot().selectedIds).toEqual(["b"]);
    const update = vi.spyOn(started.timeline, "update");
    started.ref.setInput("config", { ...base, defaultDomain: [T0, T0 + 8 * DAY], defaultSelectedIds: ["b"] });
    (app as ApplicationRef | undefined)?.tick();
    await nextFrame();
    expect(update).not.toHaveBeenCalled();
    expect(started.timeline.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]);
  });
});

describe("<tl-timeline> — inputs and outputs", () => {
  it("hands the instance only what changed — the same items array is not new data", async () => {
    const { ref, timeline } = await place();
    const update = vi.spyOn(timeline, "update");
    ref.setInput("config", { ...base });
    app?.tick();
    expect(update).not.toHaveBeenCalled();

    ref.setInput("config", { ...base, orientation: "vertical", items: [items[0] as Item] });
    app?.tick();
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("vertical"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["items", "orientation"]);
    expect(document.querySelectorAll("[role=option]")).toHaveLength(1);
    // A field taken away goes back to its default.
    ref.setInput("config", { ...base, items: [items[0] as Item] });
    app?.tick();
    await vi.waitFor(() => expect(document.querySelector("svg")?.getAttribute("data-tl-orientation")).toBe("horizontal"));
    expect(ref.location.nativeElement.querySelector("[data-tl-angular]")?.style.height).toBe("260px");
  });

  it("emits an edit, and every other instance event, as an output by its own name", async () => {
    const { ref, timeline } = await place({ ...base, editing: { enabled: true, snapMs: DAY } });
    const moved = vi.fn();
    const command = vi.fn();
    const changed = vi.fn();
    ref.instance.itemMoved.subscribe(moved);
    ref.instance.command.subscribe(command);
    ref.instance.itemsChanged.subscribe(changed);
    const from = centre(node("a"));
    await commands.mouse([{ type: "move", x: from.x, y: from.y }, { type: "down" }, { type: "move", x: from.x + 90, y: from.y, steps: 6 }, { type: "up" }]);
    await vi.waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledTimes(1);
    expect(moved.mock.calls[0]?.[0].item.id).toBe("a");
    changed.mockClear();
    timeline.setItems([items[0] as Item]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("a click selects through the instance, and the selection signal says it once", async () => {
    const { ref, timeline } = await place();
    const { runInInjectionContext, signal, effect } = await import("@angular/core");
    const seen: unknown[] = [];
    const selection = runInInjectionContext(ref.injector, () => timelineState(signal(timeline), (snapshot) => snapshot.selectedIds));
    runInInjectionContext(ref.injector, () => effect(() => seen.push(selection())));
    app?.tick();
    await userEvent.click(node("b"));
    await vi.waitFor(() => {
      app?.tick();
      expect(seen.at(-1)).toEqual(["b"]);
    });
    expect(seen.filter((value) => Array.isArray(value) && value.length === 1)).toHaveLength(1);
  });

  it("lets go of the instance on destroy, and says so with ready(null)", async () => {
    const { ref, timeline } = await place();
    const destroy = vi.spyOn(timeline, "destroy");
    const ready = vi.fn();
    ref.instance.ready.subscribe(ready);
    ref.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith(null);
    expect(ref.instance.timeline).toBeNull();
  });

  it("keeps a selection the same when an isEqual says so, and holds nothing without an instance", async () => {
    const { ref, timeline } = await place();
    const { runInInjectionContext, signal } = await import("@angular/core");
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => b[index] === id);
    const source = signal<TimelineInstance | null>(null);
    // A new array each time: without isEqual, every snapshot would be a new value.
    const state = runInInjectionContext(ref.injector, () => timelineState(source, (snapshot) => [...snapshot.selectedIds], same));
    app?.tick();
    expect(state()).toBeUndefined();
    source.set(timeline);
    app?.tick();
    const first = state();
    expect(first).toEqual([]);
    timeline.zoomBy(2);
    timeline.flush();
    await nextFrame();
    expect(state()).toBe(first);
    timeline.select(["a"]);
    timeline.flush();
    await nextFrame();
    expect(state()).toEqual(["a"]);
  });

  it("reads a config back as it was given, and takes null as no config at all", async () => {
    const { ref, timeline } = await place();
    expect(ref.instance.config).toEqual(base);
    const update = vi.spyOn(timeline, "update");
    ref.setInput("config", null);
    app?.tick();
    expect(ref.instance.config).toEqual({});
    // Every field the host set goes back to its default; the scope stays,
    // and so does the view, whose start the config only said.
    const changed = update.mock.calls.at(-1)?.[0] ?? {};
    expect(Object.keys(changed).sort()).toEqual(Object.keys(base).filter((key) => key !== "defaultDomain").sort());
    expect(Object.values(changed).every((value) => value === undefined)).toBe(true);
  });

  it("numbers the timelines of one application for their stylesheet scopes", async () => {
    const { ref } = await place();
    expect(ref.location.nativeElement.querySelector("svg")?.getAttribute("data-tl-instance")).toMatch(/^tl-ng\d+$/);
  });

  it("keeps the scope its server markup carries, whatever order the client creates it in (Y16)", async () => {
    // Incremental hydration creates the timelines in another order than the
    // server drew them: the counter gave a hydrating timeline another one's scope.
    app = await createApplication({ providers: [provideZonelessChangeDetection()] });
    const hostElement = document.createElement("tl-timeline");
    host().append(hostElement);
    const ref = createComponent(TimelineComponent, { environmentInjector: app.injector, hostElement });
    ref.setInput("config", base);
    const container = hostElement.querySelector("div") as HTMLDivElement;
    container.innerHTML = renderTimelineSvg({ ...base, domain, instanceId: "tl-ng7" }, { width: 800 }).svg;
    app.attachView(ref.hostView);
    app.tick();
    await vi.waitFor(() => {
      if (ref.instance.timeline?.result === undefined) throw new Error("not drawn yet");
    });
    expect(hostElement.querySelectorAll("svg")).toHaveLength(1);
    expect(hostElement.querySelector("svg")?.getAttribute("data-tl-instance")).toBe("tl-ng7");
  });

  it("passes over a scope a drawing on the page already carries (Y16)", async () => {
    // A server-drawn timeline still waiting to hydrate (or never: `hydrate never`) holds tl-ng0.
    const waiting = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    waiting.setAttribute("data-tl-instance", "tl-ng0");
    host().append(waiting);
    const { ref } = await place();
    expect(ref.location.nativeElement.querySelector("svg")?.getAttribute("data-tl-instance")).toBe("tl-ng1");
  });
});
