import { describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { InputEffect, InputMachine, KeyboardInputOptions, ViewportEffect } from "../../src/input.js";
import { createNavigator, DEFAULT_KEY_BINDINGS, resolveKey, rowNeighbour } from "../../src/keyboard.js";
import type { KeySample } from "../../src/keyboard.js";
import { layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";
import type { Domain, Item, Orientation } from "../../src/types.js";
import { DAY, DOMAIN, LANES, MAIN_SIZE, START, demoItems, surfaceFor } from "../edit-fixture.js";

/**
 * What the keyboard does that a gesture has no counterpart for: the order it
 * walks, where the view goes so the focus can be seen, and how the view gets
 * there — in a short transition, or at once when motion is reduced.
 */

function key(name: string, modifiers: Partial<KeySample> = {}, time = 0): KeySample {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time, ...modifiers };
}

function machineWith(
  options: { items?: readonly Item[]; keyboard?: KeyboardInputOptions; orientation?: Orientation; crossSize?: number; contentCrossSize?: number } = {},
): InputMachine {
  const surface = surfaceFor(options.items ?? demoItems());
  return createInputMachine({
    domain: DOMAIN,
    mainSize: MAIN_SIZE,
    crossSize: options.crossSize ?? 300,
    contentCrossSize: options.contentCrossSize ?? 300,
    orientation: options.orientation ?? "horizontal",
    editing: { enabled: true, snapMs: DAY, hitTest: surface.tester.hitTest, lookup: surface.tester.lookup },
    keyboard: { navigator: createNavigator(surface.layout), ...options.keyboard },
  });
}

function viewports(effects: readonly InputEffect[]): ViewportEffect[] {
  return effects.filter((effect): effect is ViewportEffect => effect.type === "viewport");
}

/** Run a transition to its end, frame by frame, as a host's timer would. */
function settle(machine: InputMachine, effects: readonly InputEffect[]): { frames: Domain[]; wakeUps: number } {
  const frames: Domain[] = [];
  let wakeUps = 0;
  let next = [...effects].reverse().find((effect) => effect.type === "schedule");
  while (next?.type === "schedule" && next.at !== null && wakeUps < 100) {
    wakeUps += 1;
    const step = machine.elapse(next.at);
    frames.push(...viewports(step).map((effect) => effect.domain));
    next = step.find((effect) => effect.type === "schedule");
  }
  return { frames, wakeUps };
}

describe("resolveKey", () => {
  it("maps the arrows to the axes of the orientation", () => {
    expect(resolveKey(key("ArrowRight"), "horizontal")).toBe("next");
    expect(resolveKey(key("ArrowDown"), "horizontal")).toBe("rowNext");
    expect(resolveKey(key("ArrowDown"), "vertical")).toBe("next");
    expect(resolveKey(key("ArrowRight"), "vertical")).toBe("rowNext");
    expect(resolveKey(key("ArrowUp"), "vertical")).toBe("previous");
    expect(resolveKey(key("ArrowLeft"), "vertical")).toBe("rowPrevious");
  });

  it("tells the modifiers apart on named keys", () => {
    expect(resolveKey(key("ArrowRight", { altKey: true }), "horizontal")).toBe("moveLater");
    expect(resolveKey(key("ArrowRight", { shiftKey: true }), "horizontal")).toBe("endLater");
    expect(resolveKey(key("ArrowLeft", { shiftKey: true, altKey: true }), "horizontal")).toBe("startEarlier");
    expect(resolveKey(key("ArrowDown", { altKey: true }), "horizontal")).toBe("laneNext");
    expect(resolveKey(key("PageDown", { shiftKey: true }), "horizontal")).toBe("crossForward");
    expect(resolveKey(key("Home", { shiftKey: true }), "horizontal")).toBeUndefined();
  });

  it("ignores shift on printable keys, because + is shift-and-something", () => {
    expect(resolveKey(key("+", { shiftKey: true }), "horizontal")).toBe("zoomIn");
    expect(resolveKey(key("+", { altKey: true }), "horizontal")).toBeUndefined();
  });

  it("leaves ctrl and meta to the browser", () => {
    expect(resolveKey(key("+", { ctrlKey: true }), "horizontal")).toBeUndefined();
    expect(resolveKey(key("ArrowRight", { metaKey: true }), "horizontal")).toBeUndefined();
    expect(resolveKey(key("x"), "horizontal")).toBeUndefined();
  });

  it("takes a table of the host's own", () => {
    const bindings = [{ key: "j", action: "next" as const }];
    expect(resolveKey(key("j"), "horizontal", bindings)).toBe("next");
    expect(resolveKey(key("ArrowRight"), "horizontal", bindings)).toBeUndefined();
    expect(DEFAULT_KEY_BINDINGS.length).toBeGreaterThan(20);
    const machine = machineWith({ keyboard: { bindings } });
    expect(machine.key(key("j"))[0]).toEqual({ type: "key", action: "next" });
    expect(machine.key(key("ArrowRight"))).toEqual([]);
  });
});

describe("createNavigator", () => {
  it("orders by start, then row, and is built once per layout", () => {
    const layout = layoutItems(demoItems(), { lanes: LANES });
    const navigator = createNavigator(layout);
    expect(navigator.entries.map((entry) => entry.id)).toEqual(["a", "c", "b", "moment"]);
    expect(navigator.lanes).toEqual(["l1", "l2"]);
    expect(navigator.indexOf("b")).toBe(2);
    expect(navigator.indexOf("nope")).toBe(-1);
    expect(createNavigator(layout)).toBe(navigator);
    const inset = createNavigator(layout, { crossInset: 28 });
    expect(inset).not.toBe(navigator);
    expect(inset.crossInset).toBe(28);
  });

  it("keeps one per inset: the renderer's and a host's do not evict each other", () => {
    // Every interactive frame asks for one without an inset (the listbox's
    // positions), and a host for its own. Once the second evicted the
    // first, so each frame sorted every item twice.
    const layout = layoutItems(demoItems(), { lanes: LANES });
    const bare = createNavigator(layout);
    const host = createNavigator(layout, { crossInset: 28 });
    for (let frame = 0; frame < 3; frame += 1) {
      expect(createNavigator(layout)).toBe(bare);
      expect(createNavigator(layout, { crossInset: 28 })).toBe(host);
    }
    // The order is built once: the inset's navigator shares it.
    expect(host.entries).toBe(bare.entries);
  });

  it("breaks a tie in start and row by id, so the walk is stable", () => {
    const items: Item[] = [
      { id: "y", start: START, end: START + DAY, laneId: "l1" },
      { id: "x", start: START, end: START + DAY, laneId: "l1" },
    ];
    const navigator = createNavigator(layoutItems(items, { lanes: LANES, packMode: "overlap" }));
    expect(navigator.entries.map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("orders a tie in start by row, before the id", () => {
    const items: Item[] = [
      { id: "z-top", start: START, end: START + DAY, laneId: "l1" },
      { id: "a-below", start: START, end: START + DAY, laneId: "l2" },
    ];
    const navigator = createNavigator(layoutItems(items, { lanes: LANES }));
    expect(navigator.entries.map((entry) => entry.id)).toEqual(["z-top", "a-below"]);
  });

  it("gives a tie in distance across to the earlier item", () => {
    const items: Item[] = [
      { id: "from", start: START + 10 * DAY, end: START + 11 * DAY, laneId: "l1" },
      { id: "before", start: START + 7 * DAY, end: START + 8 * DAY, laneId: "l2" },
      { id: "after", start: START + 13 * DAY, end: START + 14 * DAY, laneId: "l2" },
    ];
    const navigator = createNavigator(layoutItems(items, { lanes: LANES }));
    const from = navigator.entries[navigator.indexOf("from")];
    expect(from && rowNeighbour(navigator, from, 1)?.id).toBe("before");
  });

  it("steps across to the nearest item in time in the next row that holds one", () => {
    const items: Item[] = [
      { id: "top", start: START + 10 * DAY, end: START + 11 * DAY, laneId: "l1" },
      { id: "far", start: START, end: START + DAY, laneId: "l2" },
      { id: "near", start: START + 9 * DAY, end: START + 12 * DAY, laneId: "l2" },
    ];
    const navigator = createNavigator(layoutItems(items, { lanes: [{ id: "l1" }, { id: "empty" }, { id: "l2" }] }));
    const top = navigator.entries[navigator.indexOf("top")];
    const near = navigator.entries[navigator.indexOf("near")];
    expect(top && rowNeighbour(navigator, top, 1)?.id).toBe("near");
    expect(near && rowNeighbour(navigator, near, -1)?.id).toBe("top");
    expect(top && rowNeighbour(navigator, top, -1)).toBeUndefined();
  });
});

describe("keyboard focus", () => {
  it("starts where the user is looking, and walks from there", () => {
    const items: Item[] = [
      { id: "before", start: START - 20 * DAY, end: START - 18 * DAY, laneId: "l1" },
      ...demoItems(),
    ];
    const machine = machineWith({ items, keyboard: { reducedMotion: true } });
    const first = machine.key(key("ArrowRight"));
    expect(first).toEqual([{ type: "key", action: "next" }, { type: "focus", id: "a" }]);
    machine.key(key("ArrowRight"));
    expect(machine.focusedId).toBe("c");
    // At the end of the walk the key is still ours, and nothing moves.
    machine.key(key("End"));
    expect(machine.key(key("ArrowRight"))).toEqual([{ type: "key", action: "next" }]);
    const backwards = machineWith({ items, keyboard: { reducedMotion: true } });
    backwards.key(key("ArrowLeft"));
    expect(backwards.focusedId).toBe("moment");
  });

  it("brings an off-screen item into view, keeping a margin", () => {
    const items: Item[] = [...demoItems(), { id: "late", start: START + 60 * DAY, end: START + 62 * DAY, laneId: "l1" }];
    const machine = machineWith({ items, keyboard: { reducedMotion: true } });
    const effects = machine.key(key("End"));
    const view = viewports(effects).at(-1);
    expect(machine.focusedId).toBe("late");
    expect(view?.reason).toBe("pan");
    const [from, to] = machine.domain;
    expect(to - from).toBe(DOMAIN[1] - DOMAIN[0]);
    expect(START + 62 * DAY).toBeLessThanOrEqual(to - (to - from) * 0.1 + 1);
    expect(START + 60 * DAY).toBeGreaterThan(from);
    // Already in view: no move at all.
    expect(viewports(machine.key(key("ArrowLeft")))).toHaveLength(1);
    expect(viewports(machine.key(key("ArrowRight")))).toHaveLength(1);
    expect(viewports(machine.key(key("ArrowRight")))).toHaveLength(0);
  });

  it("puts an item longer than the view at its start", () => {
    const items: Item[] = [{ id: "long", start: START + 40 * DAY, end: START + 140 * DAY, laneId: "l1" }];
    const machine = machineWith({ items, keyboard: { reducedMotion: true } });
    machine.key(key("Home"));
    const [from, to] = machine.domain;
    expect(START + 40 * DAY - from).toBeCloseTo((to - from) * 0.1, -3);
  });

  it("scrolls the lanes to an item across, both ways", () => {
    const lanes = Array.from({ length: 30 }, (_, index) => ({ id: `l${String(index)}` }));
    const items: Item[] = lanes.map((lane, index) => ({ id: `i${String(index)}`, start: START + DAY, end: START + 2 * DAY, laneId: lane.id }));
    const layout = layoutItems(items, { lanes });
    const scale = createTimeScale(DOMAIN, MAIN_SIZE);
    expect(scale.msPerPx).toBeGreaterThan(0);
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      crossSize: 200,
      contentCrossSize: layout.crossSize + 28,
      keyboard: { navigator: createNavigator(layout, { crossInset: 28 }), reducedMotion: true },
    });
    machine.key(key("ArrowRight"));
    for (let step = 0; step < 20; step += 1) {
      machine.key(key("ArrowDown"));
    }
    const placed = layout.items.find((item) => item.item.id === machine.focusedId);
    expect(machine.focusedId).toBe("i20");
    expect(placed && placed.cross + placed.crossSize).toBeLessThanOrEqual(machine.crossOffset + 200 - 28);
    expect(placed && placed.cross).toBeGreaterThanOrEqual(machine.crossOffset);
    for (let step = 0; step < 20; step += 1) {
      machine.key(key("ArrowUp"));
    }
    expect(machine.focusedId).toBe("i0");
    expect(machine.crossOffset).toBe(0);
  });

  it("does not leave the focus behind when a page key moves the view", () => {
    const items: Item[] = [...demoItems(), { id: "next page", start: START + 34 * DAY, end: START + 35 * DAY, laneId: "l1" }];
    const machine = machineWith({ items, keyboard: { reducedMotion: true } });
    machine.key(key("Home"));
    expect(machine.focusedId).toBe("a");
    const effects = machine.key(key("PageDown"));
    expect(effects).toContainEqual({ type: "focus", id: "moment" });
    machine.key(key("PageDown"));
    machine.key(key("PageDown"));
    // Nothing in view any more: off every item, never on an invisible one.
    machine.key(key("PageDown"));
    expect(machine.focusedId).toBeNull();
  });

  it("zooms about the focused item, which stays where it was", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    machine.key(key("ArrowRight"));
    machine.key(key("ArrowRight"));
    machine.key(key("ArrowRight"));
    expect(machine.focusedId).toBe("b");
    const centre = START + 12 * DAY;
    const before = createTimeScale(machine.domain, MAIN_SIZE).toMain(centre);
    machine.key(key("+"));
    const after = createTimeScale(machine.domain, MAIN_SIZE).toMain(centre);
    expect(after).toBeCloseTo(before, 6);
    expect(machine.domain[1] - machine.domain[0]).toBeCloseTo((DOMAIN[1] - DOMAIN[0]) / 2, -1);
  });

  it("activates the first item in view when nothing is focused yet", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    expect(machine.key(key("Enter"))).toEqual([{ type: "key", action: "activate" }, { type: "focus", id: "a" }]);
    expect(machine.key(key("Enter"))).toEqual([{ type: "key", action: "activate" }, { type: "activate", id: "a" }]);
  });

  it("lets Escape through when there is nothing to let go of", () => {
    const machine = machineWith();
    expect(machine.key(key("Escape"))).toEqual([]);
    machine.setSelection(["b"]);
    expect(machine.key(key("Escape"))).toEqual([{ type: "key", action: "dismiss" }, { type: "activate", id: null }]);
  });

  it("has nothing to focus without a navigator, but still pans and zooms", () => {
    const machine = createInputMachine({ domain: DOMAIN, mainSize: MAIN_SIZE, keyboard: { reducedMotion: true } });
    expect(machine.key(key("ArrowRight"))).toEqual([]);
    expect(machine.key(key("Enter"))).toEqual([]);
    expect(viewports(machine.key(key("PageDown")))).toHaveLength(1);
    expect(viewports(machine.key(key("-")))).toHaveLength(1);
    expect(machine.key(key("PageDown", { shiftKey: true }))).toEqual([]);
  });

  it("is off when the host says so, and while a pointer is down", () => {
    const off = machineWith({ keyboard: { enabled: false } });
    expect(off.key(key("ArrowRight"))).toEqual([]);
    const busy = machineWith();
    busy.handle({ pointerId: 1, phase: "down", x: 300, y: 250, time: 0, pointerType: "mouse" });
    expect(busy.key(key("PageDown"))).toEqual([]);
    busy.handle({ pointerId: 1, phase: "up", x: 300, y: 250, time: 50, pointerType: "mouse" });
    expect(busy.key(key("PageDown")).length).toBeGreaterThan(0);
  });

  it("follows setFocus from the host, and walks on from there", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    machine.setFocus("b");
    expect(machine.focusedId).toBe("b");
    machine.key(key("ArrowRight"));
    expect(machine.focusedId).toBe("moment");
    machine.setFocus("gone");
    // An id the frame no longer has: start again from what is in view.
    machine.key(key("ArrowRight"));
    expect(machine.focusedId).toBe("a");
  });

  it("brings an item it moved off-screen back into view", () => {
    const items: Item[] = [{ id: "edge", start: START + 29 * DAY, end: START + 30 * DAY, laneId: "l1" }];
    const machine = machineWith({ items, keyboard: { reducedMotion: true } });
    machine.key(key("Home"));
    const effects = machine.key(key("ArrowRight", { altKey: true }));
    expect(effects.some((effect) => effect.type === "editEnd" && effect.command !== undefined)).toBe(true);
    const view = viewports(effects).at(-1);
    expect(view).toBeDefined();
    expect(START + 30 * DAY).toBeLessThan(machine.domain[1]);
    expect(effects.find((effect) => effect.type === "editStart")).toMatchObject({ trigger: "keyboard" });
  });

  it("carries the selection only when the focused item is part of it, as a drag does", () => {
    const surface = surfaceFor();
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { enabled: true, snapMs: DAY, multiSelect: true, lookup: surface.tester.lookup },
      keyboard: { navigator: createNavigator(surface.layout), reducedMotion: true },
    });
    machine.setSelection(["a"]);
    machine.setFocus("b");
    const end = machine.key(key("ArrowRight", { altKey: true })).find((effect) => effect.type === "editEnd");
    expect(end?.type === "editEnd" && end.command?.after.map((patch) => patch.id)).toEqual(["b"]);
  });

  it("does not move a locked item to another lane either", () => {
    const items: Item[] = demoItems().map((item) => (item.id === "a" ? { ...item, movable: false } : item));
    const surface = surfaceFor(items);
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { enabled: true, crossLane: true, lookup: surface.tester.lookup },
      keyboard: { navigator: createNavigator(surface.layout), reducedMotion: true },
    });
    machine.setFocus("a");
    expect(machine.key(key("ArrowDown", { altKey: true }))).toEqual([]);
    machine.setFocus("c");
    expect(machine.key(key("ArrowUp", { altKey: true })).some((effect) => effect.type === "editEnd")).toBe(true);
  });

  it("resizes an instant into an interval, as dragging its drawn end does", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    machine.setFocus("moment");
    const effects = machine.key(key("ArrowRight", { shiftKey: true }));
    const end = effects.find((effect) => effect.type === "editEnd");
    expect(end?.type === "editEnd" && end.command?.after[0]?.end).toBeGreaterThan(START + 20 * DAY);
  });
});

describe("date jump", () => {
  it("asks the host for a date on g, and goTo centres it", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    expect(machine.key(key("g"))).toEqual([{ type: "key", action: "jump" }, { type: "jumpRequest" }]);
    const target = START + 400 * DAY;
    const effects = machine.goTo(new Date(target));
    expect(viewports(effects)).toHaveLength(1);
    const [from, to] = machine.domain;
    expect((from + to) / 2).toBeCloseTo(target, -1);
    expect(to - from).toBe(DOMAIN[1] - DOMAIN[0]);
  });

  it("centres a 1 ms view on an instant past 2^52 ms without losing its span (V26)", () => {
    const far = 2 ** 52 + 2;
    for (const at of [far, -far, 8.64e15]) {
      const machine = createInputMachine({ domain: [at - 10, at - 9], mainSize: MAIN_SIZE, keyboard: { reducedMotion: true } });
      expect(() => machine.goTo(at)).not.toThrow();
      expect(machine.domain[1] - machine.domain[0]).toBe(1);
      expect(machine.domain[0] <= at && at <= machine.domain[1]).toBe(true);
    }
  });

  it("drops a focus the jump left behind", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    machine.key(key("Home"));
    expect(machine.goTo(START + 400 * DAY)).toContainEqual({ type: "focus", id: null });
  });

  it("does nothing when panning is off", () => {
    const machine = createInputMachine({ domain: DOMAIN, mainSize: MAIN_SIZE, pan: false });
    expect(machine.goTo(START + 400 * DAY)).toEqual([]);
    expect(machine.goTo(START, 0)).toEqual([]);
  });
});

describe("transitions and reduced motion", () => {
  it("travels in a short eased transition, and lands exactly on the target", () => {
    const machine = machineWith();
    const effects = machine.key(key("PageDown", {}, 1000));
    // Nothing has moved yet; the machine asked to be woken.
    expect(viewports(effects)).toHaveLength(0);
    expect(effects).toContainEqual({ type: "schedule", at: 1016, reason: "transition" });
    const { frames, wakeUps } = settle(machine, effects);
    const target = DOMAIN[0] + (DOMAIN[1] - DOMAIN[0]) / 2;
    expect(wakeUps).toBeGreaterThan(8);
    expect(wakeUps).toBeLessThan(16);
    expect(frames.at(-1)?.[0]).toBe(target);
    // Monotonic, eased out: big steps first, small steps last.
    const starts = frames.map((frame) => frame[0]);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]).toBeGreaterThan(starts[index - 1] as number);
    }
    expect((starts[1] as number) - (starts[0] as number)).toBeGreaterThan((starts.at(-1) as number) - (starts.at(-2) as number));
    // Over, and the machine says nothing more.
    expect(machine.elapse(5000)).toEqual([]);
  });

  it("changes the view in one step when motion is reduced", () => {
    const machine = machineWith({ keyboard: { reducedMotion: true } });
    const effects = machine.key(key("PageDown", {}, 1000));
    expect(viewports(effects)).toHaveLength(1);
    expect(effects.some((effect) => effect.type === "schedule")).toBe(false);
  });

  it("follows a change of the setting, as the browser binding passes it on", () => {
    const machine = machineWith();
    machine.setKeyboard({ reducedMotion: true });
    expect(viewports(machine.key(key("PageDown", {}, 0)))).toHaveLength(1);
    machine.setKeyboard({ reducedMotion: false });
    expect(viewports(machine.key(key("PageDown", {}, 100)))).toHaveLength(0);
  });

  it("jumps rather than travels across more than two views", () => {
    const machine = machineWith();
    expect(viewports(machine.goTo(START + 400 * DAY, 0))).toHaveLength(1);
    const near = machineWith();
    expect(viewports(near.goTo(START + 40 * DAY, 0))).toHaveLength(0);
  });

  it("heads on from where the previous key was going, not from where the view is", () => {
    const machine = machineWith();
    const first = machine.key(key("PageDown", {}, 0));
    expect(first.some((effect) => effect.type === "schedule")).toBe(true);
    machine.elapse(16);
    const second = machine.key(key("PageDown", {}, 32));
    const { frames } = settle(machine, second);
    expect(frames.at(-1)?.[0]).toBe(DOMAIN[0] + (DOMAIN[1] - DOMAIN[0]));
  });

  it("gives the view to a finger that lands mid-transition", () => {
    const machine = machineWith();
    machine.key(key("PageDown", {}, 0));
    machine.elapse(16);
    machine.elapse(48);
    const where = machine.domain;
    const effects = machine.handle({ pointerId: 1, phase: "down", x: 300, y: 250, time: 60, pointerType: "touch" });
    expect(effects[0]).toEqual({ type: "schedule", at: null, reason: "transition" });
    expect(machine.elapse(80)).toEqual([]);
    expect(machine.domain).toEqual(where);
  });

  it("stops for a wheel, a programmatic pan, and the host's own domain", () => {
    const wheel = machineWith();
    wheel.key(key("PageDown", {}, 0));
    const wheeled = wheel.wheel({ x: 300, y: 250, deltaX: 0, deltaY: 10, ctrlKey: true, shiftKey: false, time: 10 });
    expect(wheeled[0]).toEqual({ type: "schedule", at: null, reason: "transition" });
    const panned = machineWith();
    panned.key(key("PageDown", {}, 0));
    expect(panned.pan(10)[0]).toEqual({ type: "schedule", at: null, reason: "transition" });
    const zoomed = machineWith();
    zoomed.key(key("PageDown", {}, 0));
    expect(zoomed.zoom(2, 300)[0]).toEqual({ type: "schedule", at: null, reason: "transition" });
    const set = machineWith();
    set.key(key("PageDown", {}, 0));
    set.setDomain(DOMAIN);
    expect(set.elapse(16)).toEqual([]);
    expect(set.domain).toEqual(DOMAIN);
    const reset = machineWith();
    reset.key(key("PageDown", {}, 0));
    expect(reset.reset()).toContainEqual({ type: "schedule", at: null, reason: "transition" });
  });

  it("keeps a zoom's anchor still through the whole transition", () => {
    const machine = machineWith();
    machine.setFocus("b");
    const centre = START + 12 * DAY;
    const before = createTimeScale(machine.domain, MAIN_SIZE).toMain(centre);
    const effects = machine.key(key("+", {}, 0));
    const { frames } = settle(machine, effects);
    expect(frames.length).toBeGreaterThan(5);
    for (const frame of frames) {
      expect(createTimeScale(frame, MAIN_SIZE).toMain(centre)).toBeCloseTo(before, 4);
    }
  });

  it("stops quietly when the target is where the view already is", () => {
    const machine = machineWith({ items: [{ id: "only", start: START + 5 * DAY, end: START + 6 * DAY, laneId: "l1" }] });
    machine.key(key("PageDown", {}, 0));
    // PageUp heads straight back to where the view still is: the running
    // transition ends, and nothing moves.
    const back = machine.key(key("PageUp", {}, 10));
    expect(viewports(back)).toHaveLength(0);
    expect(back).toContainEqual({ type: "schedule", at: null, reason: "transition" });
    expect(machine.elapse(26)).toEqual([]);
  });
});
