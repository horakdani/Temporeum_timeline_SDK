import { afterEach, describe, expect, it, vi } from "vitest";

import { createHitTester } from "../../src/editing.js";
import { createInputMachine } from "../../src/input.js";
import type { InputEffect } from "../../src/input.js";
import { attachInput } from "../../src/dom/attach.js";
import { layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";

/**
 * The browser binding, tested without a browser.
 *
 * The binding takes the element as an argument and never reaches for a global,
 * so a plain object with the four methods it calls is a complete stand-in —
 * which is also the reason the package's DOM ban is still enforced over this
 * file. What is checked here is the *wiring*: which events are listened for,
 * what coordinates come out, when `preventDefault` is called, and that
 * `destroy` really lets go.
 *
 * The same binding is driven by a real finger in the docs package's Playwright
 * suite. Two levels, two different claims: that one is about the browser, this
 * one is about the code.
 */

interface Listener {
  readonly type: string;
  readonly handler: (event: Event) => void;
  readonly options: AddEventListenerOptions | undefined;
}

interface FakeElement {
  readonly listeners: Listener[];
  readonly attrs: Map<string, string>;
  readonly captured: number[];
  captureThrows: boolean;
  dispatch(type: string, event: Record<string, unknown>): void;
}

function fakeElement(box = { left: 20, top: 10 }): FakeElement {
  const listeners: Listener[] = [];
  const attrs = new Map<string, string>();
  const captured: number[] = [];
  const element = {
    // The page's window: what the stubbed globals are on.
    ownerDocument: { defaultView: globalThis },
    listeners,
    attrs,
    captured,
    captureThrows: false,
    addEventListener(type: string, handler: (event: Event) => void, options?: AddEventListenerOptions) {
      listeners.push({ type, handler, options });
    },
    removeEventListener(type: string, handler: (event: Event) => void) {
      const index = listeners.findIndex(
        (listener) => listener.type === type && listener.handler === handler,
      );
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    getBoundingClientRect() {
      return { left: box.left, top: box.top, width: 900, height: 200 };
    },
    setPointerCapture(pointerId: number) {
      if (element.captureThrows) {
        throw new Error("the pointer is already gone");
      }
      captured.push(pointerId);
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      for (const listener of [...listeners]) {
        if (listener.type === type) {
          listener.handler(event as unknown as Event);
        }
      }
    },
  };
  return element;
}

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function setup(options: { reflectGesture?: boolean; keyboard?: boolean; followReducedMotion?: boolean } = {}): {
  element: FakeElement;
  effects: InputEffect[];
  binding: { destroy(): void };
  machine: ReturnType<typeof createInputMachine>;
} {
  const element = fakeElement();
  const machine = createInputMachine({ domain: [START, START + 30 * DAY], mainSize: 900 });
  const effects: InputEffect[] = [];
  const binding = attachInput(element as unknown as Element, {
    machine,
    onEffects: (batch) => effects.push(...batch),
    ...options,
  });
  return { element, effects, binding, machine };
}

function pointer(pointerId: number, clientX: number, clientY = 60): Record<string, unknown> {
  return { pointerId, clientX, clientY, timeStamp: 0, pointerType: "touch" };
}

describe("the browser binding", () => {
  it("listens for exactly the events a gesture needs, and lets them go again", () => {
    const { element, binding } = setup();
    expect(element.listeners.map((listener) => listener.type)).toEqual([
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      // The browser taking the pointer away is a cancel from here.
      "lostpointercapture",
      "wheel",
      // Since P8: the keyboard comes in through the same binding.
      "keydown",
    ]);
    // The wheel listener must not be passive, or it cannot stop the page
    // scrolling while the timeline zooms.
    const wheel = element.listeners.find((listener) => listener.type === "wheel");
    expect(wheel?.options).toEqual({ passive: false });
    binding.destroy();
    expect(element.listeners).toEqual([]);
    const pointerOnly = setup({ keyboard: false });
    expect(pointerOnly.element.listeners.map((listener) => listener.type)).not.toContain("keydown");
  });

  it("makes coordinates relative to the element, not the page", () => {
    const { element, machine } = setup();
    const grabbed = machine.domain;
    element.dispatch("pointerdown", pointer(1, 320));
    // The element starts 20 px from the left, so clientX 320 is main 300.
    element.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 16 });
    expect(machine.domain).not.toEqual(grabbed);
    expect(machine.phase).toBe("panning");
    expect(element.captured).toEqual([1]);
  });

  it("captures the pointer, and survives a pointer that has already gone", () => {
    const { element, machine } = setup();
    element.captureThrows = true;
    // The capture call can throw; a host's event handler must not.
    expect(() => {
      element.dispatch("pointerdown", pointer(1, 320));
    }).not.toThrow();
    expect(element.captured).toEqual([]);
    expect(machine.pointerCount).toBe(1);
  });

  it("treats a lost capture as a cancel", () => {
    const { element, effects, machine } = setup();
    element.dispatch("pointerdown", pointer(1, 320));
    element.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 16 });
    element.dispatch("lostpointercapture", { ...pointer(1, 520), timeStamp: 20 });
    expect(machine.pointerCount).toBe(0);
    expect(effects.at(-1)).toEqual({ type: "gestureEnd", kind: "pan", cancelled: true });
  });

  it("reflects the gesture on the element, and only when asked", () => {
    const { element, binding } = setup();
    element.dispatch("pointerdown", pointer(1, 320));
    expect(element.attrs.get("data-tl-gesture")).toBeUndefined();
    element.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 16 });
    expect(element.attrs.get("data-tl-gesture")).toBe("pan");
    element.dispatch("pointerup", { ...pointer(1, 520), timeStamp: 20 });
    expect(element.attrs.has("data-tl-gesture")).toBe(false);
    element.dispatch("pointerdown", pointer(1, 320));
    element.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 30 });
    expect(element.attrs.get("data-tl-gesture")).toBe("pan");
    // Destroying mid-gesture must not leave the cursor stuck in grab.
    binding.destroy();
    expect(element.attrs.has("data-tl-gesture")).toBe(false);

    const quiet = fakeElement();
    const machine = createInputMachine({ domain: [START, START + 30 * DAY], mainSize: 900 });
    const silent = attachInput(quiet as unknown as Element, { machine, reflectGesture: false });
    quiet.dispatch("pointerdown", pointer(1, 320));
    quiet.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 16 });
    expect(quiet.attrs.size).toBe(0);
    expect(machine.phase).toBe("panning");
    silent.destroy();
    expect(quiet.attrs.size).toBe(0);
    expect(quiet.listeners).toEqual([]);
  });

  it("stops the page scrolling only when the timeline used the wheel", () => {
    const { element, machine } = setup();
    let prevented = 0;
    const wheel = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      clientX: 320,
      clientY: 60,
      deltaX: 0,
      deltaY: 100,
      ctrlKey: false,
      shiftKey: false,
      timeStamp: 0,
      preventDefault: () => {
        prevented += 1;
      },
      ...overrides,
    });
    element.dispatch("wheel", wheel({}));
    expect(prevented).toBe(1);
    expect(machine.domain[0]).toBeGreaterThan(START);

    // A wheel the timeline ignores belongs to the page.
    const locked = fakeElement();
    const still = createInputMachine({
      domain: [START, START + 30 * DAY],
      mainSize: 900,
      pan: false,
      zoom: false,
    });
    attachInput(locked as unknown as Element, { machine: still });
    locked.dispatch("wheel", wheel({}));
    expect(prevented).toBe(1);
  });

  it("works without an effects callback at all", () => {
    const element = fakeElement();
    const machine = createInputMachine({ domain: [START, START + 30 * DAY], mainSize: 900 });
    attachInput(element as unknown as Element, { machine });
    element.dispatch("pointerdown", pointer(1, 320));
    element.dispatch("pointermove", { ...pointer(1, 520), timeStamp: 16 });
    expect(machine.phase).toBe("panning");
  });

  it("drops a pointer that was still down when the binding was destroyed", () => {
    const { element, binding, machine } = setup();
    element.dispatch("pointerdown", pointer(1, 320));
    expect(machine.pointerCount).toBe(1);
    binding.destroy();
    expect(machine.pointerCount).toBe(0);
    expect(machine.phase).toBe("idle");
  });

  it("passes the pointer kind through, mouse and pen included", () => {
    const { element, machine } = setup();
    // A mouse has a tighter threshold than a finger: 4 px must already drag.
    element.dispatch("pointerdown", { ...pointer(1, 320), pointerType: "mouse" });
    element.dispatch("pointermove", {
      ...pointer(1, 325),
      pointerType: "mouse",
      timeStamp: 16,
    });
    expect(machine.phase).toBe("panning");
    machine.reset();
    // An unknown pointerType is treated as the precise kind, not ignored.
    element.dispatch("pointerdown", { ...pointer(2, 320), pointerType: "" });
    element.dispatch("pointermove", { ...pointer(2, 325), pointerType: "", timeStamp: 32 });
    expect(machine.phase).toBe("panning");
  });

  it("pans with the primary mouse button only (E11)", () => {
    const { element, machine } = setup();
    const mouse = (id: number, x: number, extra: Record<string, unknown>) => ({ ...pointer(id, x), pointerType: "mouse", ...extra });
    // The middle and the right button press nothing, and capture nothing.
    for (const button of [1, 2]) {
      element.dispatch("pointerdown", mouse(button, 320, { button, buttons: 1 << button }));
      element.dispatch("pointermove", mouse(button, 360, { buttons: 1 << button, timeStamp: 16 }));
      expect(machine.pointerCount).toBe(0);
      expect(machine.phase).toBe("idle");
    }
    expect(element.captured).toEqual([]);
    // A left drag that ends with only the right button still held is over,
    // although no pointerup came.
    element.dispatch("pointerdown", mouse(3, 320, { button: 0, buttons: 1 }));
    element.dispatch("pointermove", mouse(3, 340, { buttons: 1, timeStamp: 16 }));
    expect(machine.phase).toBe("panning");
    element.dispatch("pointermove", mouse(3, 360, { buttons: 2, timeStamp: 32 }));
    expect(machine.phase).toBe("idle");
    expect(machine.pointerCount).toBe(0);
  });
});

/**
 * The one timer in the library.
 *
 * The machine decides *when* it wants to be woken and the binding does the
 * waiting, so what is checked here is only that: the wake-up is scheduled,
 * cancelled when it stops being wanted, and never left behind on a destroyed
 * binding. The threshold itself is the machine's, and the suite above proves
 * this file does not know it.
 */
describe("the long press", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function editable(longPressMs = 400): {
    element: FakeElement;
    effects: InputEffect[];
    binding: { destroy(): void };
    machine: ReturnType<typeof createInputMachine>;
  } {
    const element = fakeElement();
    const domain: [number, number] = [START, START + 30 * DAY];
    // One item filling days 2 to 10: 900 px over 30 days is 30 px to the day.
    const layout = layoutItems([{ id: "a", start: START + 2 * DAY, end: START + 10 * DAY }]);
    const tester = createHitTester({ layout, scale: createTimeScale(domain, 900) });
    const machine = createInputMachine({
      domain,
      mainSize: 900,
      editing: { enabled: true, ...tester, longPressMs },
    });
    const effects: InputEffect[] = [];
    const binding = attachInput(element as unknown as Element, {
      machine,
      onEffects: (batch) => effects.push(...batch),
    });
    return { element, effects, binding, machine };
  }

  /** clientX of a day, with the element 20 px from the left edge. */
  function dayX(day: number): number {
    return 20 + day * 30;
  }

  /**
   * clientY inside the item's row.
   *
   * The element starts 10 px from the top and the first sublane is 24 px
   * tall, so this lands in the middle of it. A pointer that is over the item
   * along time but not across the lanes hits nothing — which is the right
   * answer, and was this test's first failure.
   */
  const ROW_Y = 22;

  it("turns a held finger into a drag, with the timer on this side", () => {
    vi.useFakeTimers();
    const { element, effects, machine } = editable();
    const base = performance.now();
    element.dispatch("pointerdown", { ...pointer(1, dayX(5), ROW_Y), timeStamp: base });
    expect(effects.filter((effect) => effect.type === "schedule")).toHaveLength(1);
    expect(effects.filter((effect) => effect.type === "editStart")).toHaveLength(0);

    vi.advanceTimersByTime(399);
    expect(effects.filter((effect) => effect.type === "editStart")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(effects.filter((effect) => effect.type === "editStart")).toHaveLength(1);
    expect(element.attrs.get("data-tl-edit")).toBe("move");
    expect(machine.phase).toBe("editing");

    const grabbed = machine.domain;
    element.dispatch("pointermove", { ...pointer(1, dayX(7), ROW_Y), timeStamp: performance.now() });
    const proposed = effects.filter((effect) => effect.type === "editMove");
    expect(proposed).toHaveLength(1);
    // Dragging an item must not also pan the view.
    expect(machine.domain).toEqual(grabbed);

    element.dispatch("pointerup", { ...pointer(1, dayX(7), ROW_Y), timeStamp: performance.now() });
    const ended = effects.filter((effect) => effect.type === "editEnd");
    expect(ended).toHaveLength(1);
    expect(element.attrs.has("data-tl-edit")).toBe(false);
  });

  it("cancels the wake-up when the finger leaves instead", () => {
    vi.useFakeTimers();
    const { element, effects, machine } = editable();
    const base = performance.now();
    element.dispatch("pointerdown", { ...pointer(1, dayX(5), ROW_Y), timeStamp: base });
    element.dispatch("pointermove", { ...pointer(1, dayX(1), ROW_Y), timeStamp: base + 50 });
    expect(machine.phase).toBe("panning");
    vi.advanceTimersByTime(5000);
    expect(effects.filter((effect) => effect.type === "editStart")).toHaveLength(0);
  });

  it("leaves no timer behind on a destroyed binding", () => {
    vi.useFakeTimers();
    const { element, effects, binding } = editable();
    element.dispatch("pointerdown", { ...pointer(1, dayX(5), ROW_Y), timeStamp: performance.now() });
    const before = effects.length;
    binding.destroy();
    vi.advanceTimersByTime(5000);
    expect(effects).toHaveLength(before);
    expect(element.attrs.has("data-tl-edit")).toBe(false);
  });

  it("reflects a resize, not a move, when a handle is held", () => {
    vi.useFakeTimers();
    const { element } = editable();
    // Two pixels inside the right edge of the item: the end handle.
    element.dispatch("pointerdown", { ...pointer(1, dayX(10) - 2, ROW_Y), timeStamp: performance.now() });
    // A handle is explicit intent: no hold needed, so the drag starts on the
    // first move past the threshold.
    element.dispatch("pointermove", { ...pointer(1, dayX(12), ROW_Y), timeStamp: performance.now() });
    expect(element.attrs.get("data-tl-edit")).toBe("resize-end");
  });
});

describe("the keyboard and motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function keydown(key: string, extra: Record<string, unknown> = {}): Record<string, unknown> & { prevented: boolean } {
    const event = {
      key,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      timeStamp: 0,
      prevented: false,
      preventDefault() {
        event.prevented = true;
      },
      ...extra,
    };
    return event;
  }

  it("hands a key pressed on the timeline to the machine, and keeps it from the page", () => {
    const { element, effects, machine } = setup({ followReducedMotion: false });
    machine.setKeyboard({ reducedMotion: true });
    const before = machine.domain;
    const press = keydown("PageDown", { target: element });
    element.dispatch("keydown", press);
    expect(press.prevented).toBe(true);
    expect(machine.domain).not.toEqual(before);
    expect(effects[0]).toEqual({ type: "key", action: "panLater" });
  });

  it("also takes a key whose target is inside the SVG", () => {
    const { element, machine } = setup({ followReducedMotion: false });
    machine.setKeyboard({ reducedMotion: true });
    const press = keydown("-", { target: { namespaceURI: "http://www.w3.org/2000/svg" } });
    element.dispatch("keydown", press);
    expect(press.prevented).toBe(true);
  });

  it("leaves a key it does not take alone, so the page keeps it", () => {
    const { element, effects } = setup({ followReducedMotion: false });
    const press = keydown("x", { target: element });
    element.dispatch("keydown", press);
    expect(press.prevented).toBe(false);
    expect(effects).toEqual([]);
  });

  it("leaves the host's own control alone, and a key still being composed", () => {
    const { element, effects } = setup({ followReducedMotion: false });
    const input = { namespaceURI: "http://www.w3.org/1999/xhtml" };
    const typed = keydown("PageDown", { target: input });
    element.dispatch("keydown", typed);
    const composing = keydown("PageDown", { target: element, isComposing: true });
    element.dispatch("keydown", composing);
    expect(typed.prevented || composing.prevented).toBe(false);
    expect(effects).toEqual([]);
  });

  it("runs a transition on the machine's wake-ups, frame by frame, to the end", () => {
    vi.useFakeTimers();
    const { element, effects, machine } = setup({ followReducedMotion: false });
    const before = machine.domain;
    element.dispatch("keydown", keydown("PageDown", { target: element, timeStamp: performance.now() }));
    expect(machine.domain).toEqual(before);
    vi.advanceTimersByTime(400);
    const frames = effects.filter((effect) => effect.type === "viewport");
    expect(frames.length).toBeGreaterThan(5);
    expect(machine.domain[0]).toBe(before[0] + (before[1] - before[0]) / 2);
  });

  it("follows prefers-reduced-motion, and a change of it, and lets go on destroy", () => {
    let listener: (() => void) | undefined;
    const query = {
      matches: true,
      addEventListener: (_type: string, handler: () => void) => {
        listener = handler;
      },
      removeEventListener: (_type: string, handler: () => void) => {
        if (listener === handler) {
          listener = undefined;
        }
      },
    };
    const asked: string[] = [];
    vi.stubGlobal("matchMedia", (text: string) => {
      asked.push(text);
      return query;
    });
    const { element, machine, binding } = setup();
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
    const before = machine.domain;
    element.dispatch("keydown", keydown("PageDown", { target: element, timeStamp: 0 }));
    // Reduced: there at once, no frames.
    expect(machine.domain).not.toEqual(before);
    query.matches = false;
    listener?.();
    const moved = machine.domain;
    element.dispatch("keydown", keydown("PageDown", { target: element, timeStamp: 100 }));
    expect(machine.domain).toEqual(moved);
    binding.destroy();
    expect(listener).toBeUndefined();
  });

  it("asks the element's own window, not the one the script runs in — an iframe's preference is the frame's (S12)", () => {
    const page: string[] = [];
    vi.stubGlobal("matchMedia", (text: string) => {
      page.push(text);
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    });
    const frame: string[] = [];
    const element = fakeElement();
    (element as unknown as { ownerDocument: unknown }).ownerDocument = {
      defaultView: {
        matchMedia: (text: string) => {
          frame.push(text);
          return { matches: true, addEventListener() {}, removeEventListener() {} };
        },
      },
    };
    const machine = createInputMachine({ domain: [START, START + 30 * DAY], mainSize: 900 });
    attachInput(element as unknown as Element, { machine, onEffects: () => {} });
    expect(frame).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(page).toEqual([]);
  });

  it("leaves motion to a host that decides it itself", () => {
    const asked: string[] = [];
    vi.stubGlobal("matchMedia", (text: string) => {
      asked.push(text);
      return { matches: true, addEventListener() {}, removeEventListener() {} };
    });
    setup({ followReducedMotion: false });
    expect(asked).toEqual([]);
  });
});
