import { writeFileSync } from "node:fs";

import { afterAll, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type {
  EditEndEffect,
  InputEffect,
  InputMachine,
  InputOptions,
  KeyboardInputOptions,
  PointerKind,
  ViewportEffect,
} from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import type { KeySample } from "../../src/keyboard.js";
import { panDomainBy } from "../../src/scale.js";
import type { Item, Orientation } from "../../src/types.js";
import { DAY, DOMAIN, MAIN_SIZE, START, demoItems, surfaceFor } from "../edit-fixture.js";
import type { Surface } from "../edit-fixture.js";
import { describeBothOrientations } from "../orientation.js";

/**
 * G-KEYBOARD: every capability a gesture reaches, the keyboard reaches too.
 *
 * Each test drives ONE capability twice through the same machine type — once
 * with pointer samples, once with key presses — and compares what came out.
 * Where the two paths can be compared exactly they are: a key move and a drag
 * of the same distance must produce the same command, a `+` and a double tap
 * at the same point the same domain. That is only possible because the key
 * runs the gesture's own programmatic twins, and it is the point: a parity
 * that is merely similar is a second implementation waiting to drift.
 *
 * The capability ids in the titles (`[cap:…]`) are the ones
 * `scripts/sdk_gesture_vocabulary.mjs` derives from the machine's own types.
 * `scripts/sdk_check_keyboard.mjs` demands a green test for each, in both
 * orientations, and reads the parity log this file writes: a title can drift
 * from the behaviour, the log cannot.
 */

const CROSS_SIZE = 300;
/** Below every row: a press here hits nothing and pans. */
const EMPTY_CROSS = 250;

interface Rig {
  readonly machine: InputMachine;
  readonly surface: Surface;
  readonly orientation: Orientation;
  /** Feed a pointer sample in `(main, cross)`, mapped to the screen. */
  pointer(
    id: number,
    phase: "down" | "move" | "up",
    main: number,
    cross: number,
    time: number,
    type?: PointerKind,
  ): readonly InputEffect[];
  /** Press a key named relative to the axes (`main+`, `cross-`) or literally. */
  press(key: string, modifiers?: { shift?: boolean; alt?: boolean }, time?: number): readonly InputEffect[];
}

const ARROW: Record<Orientation, Record<string, string>> = {
  horizontal: { "main+": "ArrowRight", "main-": "ArrowLeft", "cross+": "ArrowDown", "cross-": "ArrowUp" },
  vertical: { "main+": "ArrowDown", "main-": "ArrowUp", "cross+": "ArrowRight", "cross-": "ArrowLeft" },
};

function rig(
  orientation: Orientation,
  options: {
    readonly items?: readonly Item[];
    readonly editing?: InputOptions["editing"];
    readonly keyboard?: KeyboardInputOptions;
    readonly contentCrossSize?: number;
    readonly pan?: boolean;
    readonly zoom?: boolean;
  } = {},
): Rig {
  const surface = surfaceFor(options.items ?? demoItems());
  const machine = createInputMachine({
    domain: DOMAIN,
    mainSize: MAIN_SIZE,
    crossSize: CROSS_SIZE,
    contentCrossSize: options.contentCrossSize ?? CROSS_SIZE,
    orientation,
    ...(options.pan === undefined ? {} : { pan: options.pan }),
    ...(options.zoom === undefined ? {} : { zoom: options.zoom }),
    editing: {
      enabled: true,
      snapMs: DAY,
      hitTest: surface.tester.hitTest,
      lookup: surface.tester.lookup,
      laneAt: surface.tester.laneAt,
      ...options.editing,
    },
    keyboard: {
      // Exact comparisons need the view to be there at once; the
      // transition has its own tests.
      reducedMotion: true,
      navigator: createNavigator(surface.layout),
      ...options.keyboard,
    },
  });
  return {
    machine,
    surface,
    orientation,
    pointer(id, phase, main, cross, time, type = "mouse") {
      const [x, y] = orientation === "horizontal" ? [main, cross] : [cross, main];
      return machine.handle({ pointerId: id, phase, x, y, time, pointerType: type });
    },
    press(key, modifiers = {}, time = 0) {
      const sample: KeySample = {
        key: ARROW[orientation][key] ?? key,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false,
        ctrlKey: false,
        metaKey: false,
        time,
      };
      return machine.key(sample);
    },
  };
}

function viewportOf(effects: readonly InputEffect[]): ViewportEffect | undefined {
  return effects.filter((effect): effect is ViewportEffect => effect.type === "viewport").at(-1);
}

function endOf(effects: readonly InputEffect[]): EditEndEffect | undefined {
  return effects.find((effect): effect is EditEndEffect => effect.type === "editEnd");
}

/** A mouse drag in `(main, cross)`, in small steps. */
function drag(
  r: Rig,
  from: readonly [number, number],
  to: readonly [number, number],
  type: PointerKind = "mouse",
): InputEffect[] {
  const effects: InputEffect[] = [...r.pointer(1, "down", from[0], from[1], 0, type)];
  for (let step = 1; step <= 10; step += 1) {
    const main = from[0] + ((to[0] - from[0]) * step) / 10;
    const cross = from[1] + ((to[1] - from[1]) * step) / 10;
    effects.push(...r.pointer(1, "move", main, cross, step * 16, type));
  }
  effects.push(...r.pointer(1, "up", to[0], to[1], 200, type));
  return effects;
}

/** Walk the keyboard focus onto an item. */
function focus(r: Rig, id: string): void {
  r.press("Home");
  for (let guard = 0; guard < 20 && r.machine.focusedId !== id; guard += 1) {
    r.press("main+");
  }
  expect(r.machine.focusedId).toBe(id);
}

/** What each capability produced, by path — the evidence the gate reads. */
const log: { capability: string; orientation: Orientation; gesture: unknown; keyboard: unknown; same: boolean }[] = [];

function record(capability: string, orientation: Orientation, gesture: unknown, keyboard: unknown, same: boolean): void {
  log.push({ capability, orientation, gesture, keyboard, same });
  // Two missing results compare equal; a capability is only shown when both
  // paths actually produced something.
  expect(gesture).toBeDefined();
  expect(keyboard).toBeDefined();
  expect(same).toBe(true);
}

describeBothOrientations("keyboard parity", (orientation) => {
  // --- the view -------------------------------------------------------------

  it("pans later with PageDown, as a drag does [cap:view.pan.later]", () => {
    const gesture = rig(orientation);
    const dragged = viewportOf(drag(gesture, [400, EMPTY_CROSS], [100, EMPTY_CROSS]));
    const keyed = rig(orientation);
    const pressed = viewportOf(keyed.press("PageDown"));
    expect(dragged?.reason).toBe("pan");
    expect(pressed?.reason).toBe("pan");
    // The key is the twin's own arithmetic: half a view, through panDomainBy.
    expect(pressed?.domain).toEqual(panDomainBy(DOMAIN, MAIN_SIZE, MAIN_SIZE / 2));
    record(
      "view.pan.later",
      orientation,
      dragged?.domain,
      pressed?.domain,
      (dragged?.domain[0] ?? 0) > DOMAIN[0] && (pressed?.domain[0] ?? 0) > DOMAIN[0],
    );
  });

  it("pans earlier with PageUp, as a drag does [cap:view.pan.earlier]", () => {
    const gesture = rig(orientation);
    const dragged = viewportOf(drag(gesture, [100, EMPTY_CROSS], [400, EMPTY_CROSS]));
    const pressed = viewportOf(rig(orientation).press("PageUp"));
    expect(pressed?.domain).toEqual(panDomainBy(DOMAIN, MAIN_SIZE, -MAIN_SIZE / 2));
    record(
      "view.pan.earlier",
      orientation,
      dragged?.domain,
      pressed?.domain,
      (dragged?.domain[0] ?? 0) < DOMAIN[0] && (pressed?.domain[0] ?? 0) < DOMAIN[0],
    );
  });

  it("zooms in with +, to the same domain a double tap gives [cap:view.zoom.in]", () => {
    const gesture = rig(orientation);
    gesture.pointer(1, "down", MAIN_SIZE / 2, EMPTY_CROSS, 0, "touch");
    gesture.pointer(1, "up", MAIN_SIZE / 2, EMPTY_CROSS, 60, "touch");
    gesture.pointer(1, "down", MAIN_SIZE / 2, EMPTY_CROSS, 150, "touch");
    const tapped = viewportOf(gesture.pointer(1, "up", MAIN_SIZE / 2, EMPTY_CROSS, 210, "touch"));
    // Nothing focused: the keyboard anchors at the middle, where the tap was.
    const pressed = viewportOf(rig(orientation).press("+"));
    expect(tapped?.reason).toBe("zoom");
    record("view.zoom.in", orientation, tapped?.domain, pressed?.domain, JSON.stringify(tapped?.domain) === JSON.stringify(pressed?.domain));
  });

  it("zooms out with -, to the same domain a two-finger tap gives [cap:view.zoom.out]", () => {
    const gesture = rig(orientation);
    gesture.pointer(1, "down", MAIN_SIZE / 2 - 50, EMPTY_CROSS, 0, "touch");
    gesture.pointer(2, "down", MAIN_SIZE / 2 + 50, EMPTY_CROSS, 10, "touch");
    const tapped = viewportOf(gesture.pointer(1, "up", MAIN_SIZE / 2 - 50, EMPTY_CROSS, 80, "touch"));
    gesture.pointer(2, "up", MAIN_SIZE / 2 + 50, EMPTY_CROSS, 90, "touch");
    const pressed = viewportOf(rig(orientation).press("-"));
    expect(tapped?.reason).toBe("zoom");
    record("view.zoom.out", orientation, tapped?.domain, pressed?.domain, JSON.stringify(tapped?.domain) === JSON.stringify(pressed?.domain));
  });

  it("scrolls the lanes forward with Shift+PageDown, as a drag across does [cap:view.cross.forward]", () => {
    const gesture = rig(orientation, { contentCrossSize: 900 });
    const dragged = viewportOf(drag(gesture, [300, 280], [300, 180]));
    const pressed = viewportOf(rig(orientation, { contentCrossSize: 900 }).press("PageDown", { shift: true }));
    expect(pressed?.domain).toEqual(DOMAIN);
    record(
      "view.cross.forward",
      orientation,
      dragged?.crossOffset,
      pressed?.crossOffset,
      (dragged?.crossOffset ?? 0) > 0 && (pressed?.crossOffset ?? 0) > 0,
    );
  });

  it("scrolls the lanes back with Shift+PageUp, as a drag across does [cap:view.cross.back]", () => {
    const gesture = rig(orientation, { contentCrossSize: 900 });
    gesture.machine.pan(0, 400);
    const dragged = viewportOf(drag(gesture, [300, 100], [300, 200]));
    const keyed = rig(orientation, { contentCrossSize: 900 });
    keyed.machine.pan(0, 400);
    const pressed = viewportOf(keyed.press("PageUp", { shift: true }));
    record(
      "view.cross.back",
      orientation,
      dragged?.crossOffset,
      pressed?.crossOffset,
      (dragged?.crossOffset ?? 400) < 400 && (pressed?.crossOffset ?? 400) < 400,
    );
  });

  // --- selection ------------------------------------------------------------

  it("activates the focused item with Enter and Space, as a tap selects it [cap:item.select]", () => {
    const gesture = rig(orientation);
    const main = gesture.surface.mainOf(START + 12 * DAY);
    const cross = gesture.surface.crossOf("b");
    gesture.pointer(1, "down", main, cross, 0, "touch");
    const tap = gesture.pointer(1, "up", main, cross, 60, "touch").find((effect) => effect.type === "tap");
    // A tap carries a point; the host resolves it, as the demo does.
    const tapped = tap?.type === "tap" ? gesture.surface.tester.hitTest({ main: tap.main, cross: tap.cross })?.item.id : undefined;
    const keyed = rig(orientation);
    focus(keyed, "b");
    const enter = keyed.press("Enter").find((effect) => effect.type === "activate");
    const space = keyed.press(" ").find((effect) => effect.type === "activate");
    const pressed = enter?.type === "activate" ? enter.id : undefined;
    expect(space).toEqual(enter);
    record("item.select", orientation, tapped, pressed, tapped === "b" && pressed === "b");
  });

  it("lets go with Escape, as a tap on nothing does [cap:item.deselect]", () => {
    const gesture = rig(orientation);
    gesture.pointer(1, "down", 300, EMPTY_CROSS, 0, "touch");
    const tap = gesture.pointer(1, "up", 300, EMPTY_CROSS, 60, "touch").find((effect) => effect.type === "tap");
    const tapped = tap?.type === "tap" ? (gesture.surface.tester.hitTest({ main: tap.main, cross: tap.cross })?.item.id ?? null) : "no tap";
    const keyed = rig(orientation);
    focus(keyed, "b");
    keyed.machine.setSelection(["b"]);
    const effects = keyed.press("Escape");
    const activate = effects.find((effect) => effect.type === "activate");
    const pressed = activate?.type === "activate" ? activate.id : "no activate";
    expect(keyed.machine.focusedId).toBeNull();
    record("item.deselect", orientation, tapped, pressed, tapped === null && pressed === null);
  });

  it("reaches every item with one key, including those off-screen [cap:item.reach]", () => {
    // Items well past both ends of the view: a finger pans to them, the
    // keyboard has to bring them in itself.
    const items: Item[] = [
      ...demoItems(),
      { id: "early", start: START - 40 * DAY, end: START - 38 * DAY, laneId: "l1" },
      { id: "late", start: START + 70 * DAY, end: START + 75 * DAY, laneId: "l2" },
    ];
    const keyed = rig(orientation, { items });
    const reachedByTap = keyed.surface.layout.items.map((placed) => placed.item.id).sort();
    const seen: string[] = [];
    keyed.press("Home");
    for (let step = 0; step < items.length; step += 1) {
      const id = keyed.machine.focusedId;
      if (id === null) {
        break;
      }
      seen.push(id);
      // And it is on screen: what the keyboard focuses, the eye can find.
      const placed = keyed.surface.layout.items.find((candidate) => candidate.item.id === id);
      const [from, to] = keyed.machine.domain;
      expect(placed !== undefined && placed.span.start < to && placed.span.end > from).toBe(true);
      keyed.press("main+");
    }
    record("item.reach", orientation, reachedByTap, [...seen].sort(), JSON.stringify(reachedByTap) === JSON.stringify([...seen].sort()) && new Set(seen).size === seen.length);
  });

  // --- editing --------------------------------------------------------------

  const DIRECTIONS = [
    { name: "later", key: "main+", pixels: 20 },
    { name: "earlier", key: "main-", pixels: -20 },
  ] as const;

  for (const direction of DIRECTIONS) {
    it(`moves an item ${direction.name} with Alt+arrow, to the command a drag gives [cap:edit.move.${direction.name}]`, () => {
      const gesture = rig(orientation);
      const main = gesture.surface.mainOf(START + 12 * DAY);
      const cross = gesture.surface.crossOf("b");
      const dragged = endOf(drag(gesture, [main, cross], [main + direction.pixels, cross]));
      const keyed = rig(orientation);
      focus(keyed, "b");
      const pressed = endOf(keyed.press(direction.key, { alt: true }));
      expect(pressed?.command).toBeDefined();
      record(`edit.move.${direction.name}`, orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
    });

    it(`moves the end ${direction.name} with Shift+arrow, as the end handle does [cap:edit.resize-end.${direction.name}]`, () => {
      const gesture = rig(orientation);
      const main = gesture.surface.mainOf(START + 14 * DAY) - 3;
      const cross = gesture.surface.crossOf("b");
      const dragged = endOf(drag(gesture, [main, cross], [main + direction.pixels, cross]));
      const keyed = rig(orientation);
      focus(keyed, "b");
      const pressed = endOf(keyed.press(direction.key, { shift: true }));
      expect(dragged?.mode).toBe("resize-end");
      expect(pressed?.mode).toBe("resize-end");
      record(`edit.resize-end.${direction.name}`, orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
    });

    it(`moves the start ${direction.name} with Shift+Alt+arrow, as the start handle does [cap:edit.resize-start.${direction.name}]`, () => {
      const gesture = rig(orientation);
      const main = gesture.surface.mainOf(START + 10 * DAY) + 3;
      const cross = gesture.surface.crossOf("b");
      const dragged = endOf(drag(gesture, [main, cross], [main + direction.pixels, cross]));
      const keyed = rig(orientation);
      focus(keyed, "b");
      const pressed = endOf(keyed.press(direction.key, { shift: true, alt: true }));
      expect(dragged?.mode).toBe("resize-start");
      expect(pressed?.mode).toBe("resize-start");
      record(`edit.resize-start.${direction.name}`, orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
    });
  }

  it("moves an item to the next lane with Alt+arrow across, as a drag across does [cap:edit.lane.next]", () => {
    const gesture = rig(orientation, { editing: { crossLane: true } });
    const main = gesture.surface.mainOf(START + 4 * DAY);
    const dragged = endOf(drag(gesture, [main, gesture.surface.crossOf("a")], [main, gesture.surface.crossOf("c")]));
    const keyed = rig(orientation, { editing: { crossLane: true } });
    focus(keyed, "a");
    const pressed = endOf(keyed.press("cross+", { alt: true }));
    expect(pressed?.command?.after).toEqual([expect.objectContaining({ id: "a", laneId: "l2" })]);
    record("edit.lane.next", orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
  });

  it("moves an item to the previous lane with Alt+arrow across, as a drag across does [cap:edit.lane.previous]", () => {
    const gesture = rig(orientation, { editing: { crossLane: true } });
    const main = gesture.surface.mainOf(START + 6 * DAY);
    const dragged = endOf(drag(gesture, [main, gesture.surface.crossOf("c")], [main, gesture.surface.crossOf("a")]));
    const keyed = rig(orientation, { editing: { crossLane: true } });
    focus(keyed, "c");
    const pressed = endOf(keyed.press("cross-", { alt: true }));
    expect(pressed?.command?.after).toEqual([expect.objectContaining({ id: "c", laneId: "l1" })]);
    record("edit.lane.previous", orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
  });

  it("moves the whole selection when the focused item is part of it [cap:edit.selection]", () => {
    const gesture = rig(orientation, { editing: { multiSelect: true } });
    gesture.machine.setSelection(["b", "a"]);
    const main = gesture.surface.mainOf(START + 12 * DAY);
    const cross = gesture.surface.crossOf("b");
    const dragged = endOf(drag(gesture, [main, cross], [main + 20, cross]));
    const keyed = rig(orientation, { editing: { multiSelect: true } });
    keyed.machine.setSelection(["b", "a"]);
    focus(keyed, "b");
    const pressed = endOf(keyed.press("main+", { alt: true }));
    expect(pressed?.command?.after.map((patch) => patch.id).sort()).toEqual(["a", "b"]);
    record("edit.selection", orientation, dragged?.command?.after, pressed?.command?.after, JSON.stringify(dragged?.command) === JSON.stringify(pressed?.command));
  });

  // --- the rules hold on both paths -----------------------------------------

  it("asks canMove on both paths, and leaves nothing behind when it refuses [rule:veto]", () => {
    const editing = { canMove: () => false };
    const gesture = rig(orientation, { editing });
    const main = gesture.surface.mainOf(START + 12 * DAY);
    const cross = gesture.surface.crossOf("b");
    const dragged = drag(gesture, [main, cross], [main + 20, cross]);
    const keyed = rig(orientation, { editing });
    focus(keyed, "b");
    const pressed = keyed.press("main+", { alt: true });
    const vetoed = (effects: readonly InputEffect[]): boolean =>
      effects.some((effect) => effect.type === "editMove" && effect.vetoed) &&
      endOf(effects)?.command === undefined &&
      endOf(effects)?.cancelled === true;
    record("rule.veto", orientation, vetoed(dragged), vetoed(pressed), vetoed(dragged) && vetoed(pressed));
  });

  it("leaves a locked item alone on both paths [rule:locked]", () => {
    const items: Item[] = demoItems().map((item) =>
      item.id === "b" ? { ...item, movable: false, resizable: false } : item,
    );
    const gesture = rig(orientation, { items });
    const main = gesture.surface.mainOf(START + 12 * DAY);
    const cross = gesture.surface.crossOf("b");
    const dragged = drag(gesture, [main, cross], [main + 20, cross]);
    const edge = drag(rig(orientation, { items }), [gesture.surface.mainOf(START + 14 * DAY) - 3, cross], [gesture.surface.mainOf(START + 15 * DAY), cross]);
    const keyed = rig(orientation, { items });
    focus(keyed, "b");
    const presses = [
      keyed.press("main+", { alt: true }),
      keyed.press("main+", { shift: true }),
      keyed.press("main+", { shift: true, alt: true }),
    ];
    const edited = (effects: readonly InputEffect[]): boolean => effects.some((effect) => effect.type === "editStart");
    // Not ours: the key goes back to the page, untouched.
    expect(presses.every((effects) => effects.length === 0)).toBe(true);
    record(
      "rule.locked",
      orientation,
      edited(dragged) || edited(edge),
      presses.some(edited),
      !edited(dragged) && !edited(edge) && !presses.some(edited),
    );
  });

  it("switches the keys off with the gestures: pan, zoom and editing [rule:disabled]", () => {
    const still = rig(orientation, { pan: false, zoom: false, editing: { enabled: false } });
    const main = still.surface.mainOf(START + 12 * DAY);
    const cross = still.surface.crossOf("b");
    const gestures = [
      ...drag(still, [400, EMPTY_CROSS], [100, EMPTY_CROSS]),
      ...drag(still, [main, cross], [main + 20, cross]),
      ...still.pointer(1, "down", 300, EMPTY_CROSS, 1000, "touch"),
      ...still.pointer(1, "up", 300, EMPTY_CROSS, 1050, "touch"),
      ...still.pointer(1, "down", 300, EMPTY_CROSS, 1100, "touch"),
      ...still.pointer(1, "up", 300, EMPTY_CROSS, 1150, "touch"),
    ];
    focus(still, "b");
    const keys = [
      still.press("PageDown"),
      still.press("+"),
      still.press("-"),
      still.press("g"),
      still.press("main+", { alt: true }),
      still.press("main+", { shift: true }),
    ];
    const changed = (effects: readonly InputEffect[]): boolean =>
      effects.some((effect) => effect.type === "viewport" || effect.type === "editStart");
    expect(keys.every((effects) => effects.length === 0)).toBe(true);
    record("rule.disabled", orientation, changed(gestures), keys.some(changed), !changed(gestures) && !keys.some(changed));
  });
});

afterAll(() => {
  writeFileSync(new URL("../../.keyboard-parity.json", import.meta.url), `${JSON.stringify(log, null, 1)}\n`);
});
