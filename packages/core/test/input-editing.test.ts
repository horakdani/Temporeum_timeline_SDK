import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHitTester } from "../src/editing.js";
import { createInputMachine } from "../src/input.js";
import type {
  EditEndEffect,
  EditMoveEffect,
  EditStartEffect,
  EditingInputOptions,
  InputEffect,
  PointerKind,
  PointerPhase,
  PointerSample,
  ScheduleEffect,
} from "../src/input.js";
import { layoutItems } from "../src/layout.js";
import { createTimeScale } from "../src/scale.js";
import type { Item, ItemPatch } from "../src/types.js";
import { DAY, DOMAIN, MAIN_SIZE, START, demoItems, surfaceFor } from "./edit-fixture.js";

function sample(
  pointerId: number,
  phase: PointerPhase,
  main: number,
  cross: number,
  time: number,
  pointerType: PointerKind = "mouse",
): PointerSample {
  return { pointerId, phase, x: main, y: cross, time, pointerType };
}

function of<K extends InputEffect["type"]>(
  effects: readonly InputEffect[],
  type: K,
): Extract<InputEffect, { type: K }>[] {
  return effects.filter((effect) => effect.type === type) as Extract<
    InputEffect,
    { type: K }
  >[];
}

let surface = surfaceFor();

function machineFor(editing: EditingInputOptions = {}, items: readonly Item[] = demoItems()) {
  surface = surfaceFor(items);
  return createInputMachine({
    domain: DOMAIN,
    mainSize: MAIN_SIZE,
    crossSize: 200,
    editing: { enabled: true, ...surface.tester, ...editing },
  });
}

beforeEach(() => {
  surface = surfaceFor();
});

describe("editing is off unless asked for", () => {
  it("pans over an item when editing is not enabled", () => {
    const own = surfaceFor();
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { ...own.tester },
    });
    machine.handle(sample(1, "down", own.mainOf(START + 3 * DAY), own.crossOf("a"), 0));
    const moved = machine.handle(
      sample(1, "move", own.mainOf(START + 5 * DAY), own.crossOf("a"), 16),
    );
    expect(of(moved, "editStart")).toHaveLength(0);
    expect(of(moved, "gestureStart")).toHaveLength(1);
  });

  it("pans when editing is enabled but nothing can be hit", () => {
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { enabled: true },
    });
    machine.handle(sample(1, "down", 100, 10, 0));
    const moved = machine.handle(sample(1, "move", 160, 10, 16));
    expect(of(moved, "editStart")).toHaveLength(0);
    expect(machine.phase).toBe("panning");
  });

  it("pans over empty space with editing on", () => {
    const machine = machineFor();
    machine.handle(sample(1, "down", 580, 190, 0));
    const moved = machine.handle(sample(1, "move", 520, 190, 16));
    expect(of(moved, "editStart")).toHaveLength(0);
    expect(of(moved, "viewport")).not.toHaveLength(0);
  });
});

describe("a mouse drags an item straight away", () => {
  it("starts an edit once the pointer passes the drag threshold", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const down = machine.handle(sample(1, "down", surface.mainOf(START + 3 * DAY), cross, 0));
    expect(of(down, "editStart")).toHaveLength(0);
    expect(of(down, "schedule")).toHaveLength(0);

    const twoPixels = machine.handle(
      sample(1, "move", surface.mainOf(START + 3 * DAY) + 2, cross, 8),
    );
    expect(of(twoPixels, "editStart")).toHaveLength(0);

    const dragged = machine.handle(sample(1, "move", surface.mainOf(START + 4 * DAY), cross, 16));
    const started = of(dragged, "editStart")[0] as EditStartEffect;
    expect(started.mode).toBe("move");
    expect(started.trigger).toBe("pointer");
    expect(started.items.map((item) => item.id)).toEqual(["a"]);
    expect(machine.phase).toBe("editing");

    const proposed = of(dragged, "editMove")[0] as EditMoveEffect;
    expect(proposed.vetoed).toBe(false);
    expect(proposed.patches).toEqual([
      { id: "a", start: START + 3 * DAY, end: START + 7 * DAY },
    ]);
  });

  it("leaves a reversible command behind when the pointer lifts", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    machine.handle(sample(1, "down", surface.mainOf(START + 3 * DAY), cross, 0));
    machine.handle(sample(1, "move", surface.mainOf(START + 5 * DAY), cross, 16));
    const ended = machine.handle(sample(1, "up", surface.mainOf(START + 5 * DAY), cross, 32));
    const end = of(ended, "editEnd")[0] as EditEndEffect;
    expect(end.cancelled).toBe(false);
    expect(end.command?.type).toBe("move");
    expect(end.command?.after).toEqual([
      { id: "a", start: START + 4 * DAY, end: START + 8 * DAY },
    ]);
    expect(end.command?.inverse.after).toEqual([
      { id: "a", start: START + 2 * DAY, end: START + 6 * DAY },
    ]);
    expect(machine.phase).toBe("idle");
  });

  it("stays a tap when the mouse never passes the threshold", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 1, cross, 8));
    const lifted = machine.handle(sample(1, "up", main + 1, cross, 16));
    expect(of(lifted, "editStart")).toHaveLength(0);
    expect(of(lifted, "tap")).toHaveLength(1);
  });

  it("leaves no command when the drag comes back to where it started", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 60, cross, 16));
    machine.handle(sample(1, "move", main, cross, 32));
    const ended = machine.handle(sample(1, "up", main, cross, 48));
    const end = of(ended, "editEnd")[0] as EditEndEffect;
    expect(end.cancelled).toBe(true);
    expect(end.command).toBeUndefined();
  });

  it("drops the edit on pointercancel without a command", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 60, cross, 16));
    const ended = machine.handle(sample(1, "cancel", main + 60, cross, 32));
    const end = of(ended, "editEnd")[0] as EditEndEffect;
    expect(end.cancelled).toBe(true);
    expect(end.command).toBeUndefined();
  });
});

describe("a finger has to hold", () => {
  it("asks to be woken, and the hold starts the edit", () => {
    const machine = machineFor({ longPressMs: 400 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    const down = machine.handle(sample(1, "down", main, cross, 1000, "touch"));
    const scheduled = of(down, "schedule")[0] as ScheduleEffect;
    expect(scheduled.at).toBe(1400);
    expect(scheduled.reason).toBe("long-press");

    expect(machine.elapse(1399)).toHaveLength(0);
    const woken = machine.elapse(1400);
    const started = of(woken, "editStart")[0] as EditStartEffect;
    expect(started.trigger).toBe("long-press");
    // The wake-up it asked for has been used up.
    expect((of(woken, "schedule")[0] as ScheduleEffect).at).toBeNull();

    const dragged = machine.handle(sample(1, "move", main + 40, cross, 1500, "touch"));
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 4 * DAY, end: START + 8 * DAY },
    ]);
  });

  it("cancels the hold when the finger leaves before it comes due", () => {
    const machine = machineFor({ longPressMs: 400 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 1000, "touch"));
    const moved = machine.handle(sample(1, "move", main + 40, cross, 1100, "touch"));
    expect((of(moved, "schedule")[0] as ScheduleEffect).at).toBeNull();
    expect(of(moved, "editStart")).toHaveLength(0);
    expect(machine.phase).toBe("panning");
    // And a late wake-up finds nothing to do.
    expect(machine.elapse(2000)).toHaveLength(0);
  });

  it("cancels the hold when the finger lifts", () => {
    const machine = machineFor({ longPressMs: 400 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 1000, "touch"));
    const lifted = machine.handle(sample(1, "up", main, cross, 1100, "touch"));
    expect((of(lifted, "schedule")[0] as ScheduleEffect).at).toBeNull();
    expect(of(lifted, "tap")).toHaveLength(1);
  });

  it("starts the edit from a late move when no wake-up arrived", () => {
    const machine = machineFor({ longPressMs: 400 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 1000, "touch"));
    // The host never called `elapse`, but the sample itself proves that more
    // than the hold has passed.
    const late = machine.handle(sample(1, "move", main + 60, cross, 1600, "touch"));
    expect((of(late, "editStart")[0] as EditStartEffect).trigger).toBe("long-press");
  });

  it("ignores a wake-up with no press behind it", () => {
    const machine = machineFor();
    expect(machine.elapse(9999)).toHaveLength(0);
  });

  it("drops the hold when a second finger lands", () => {
    const machine = machineFor({ longPressMs: 400 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 1000, "touch"));
    const second = machine.handle(sample(2, "down", main + 120, cross, 1100, "touch"));
    expect((of(second, "schedule")[0] as ScheduleEffect).at).toBeNull();
    expect(machine.phase).toBe("pinching");
    expect(machine.elapse(1500)).toHaveLength(0);
  });
});

describe("handles resize", () => {
  it("drags the start edge without moving the end", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const left = surface.mainOf(START + 2 * DAY);
    machine.handle(sample(1, "down", left + 2, cross, 0));
    const dragged = machine.handle(sample(1, "move", left + 22, cross, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).mode).toBe("resize-start");
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 3 * DAY },
    ]);
  });

  it("drags the end edge without moving the start", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const right = surface.mainOf(START + 6 * DAY);
    machine.handle(sample(1, "down", right - 2, cross, 0));
    const dragged = machine.handle(sample(1, "move", right + 18, cross, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).mode).toBe("resize-end");
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", end: START + 7 * DAY },
    ]);
  });

  it("gives a finger the handle without the ceremony", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const right = surface.mainOf(START + 6 * DAY);
    machine.handle(sample(1, "down", right - 2, cross, 0, "touch"));
    const dragged = machine.handle(sample(1, "move", right + 20, cross, 16, "touch"));
    const started = of(dragged, "editStart")[0] as EditStartEffect;
    expect(started.trigger).toBe("handle");
    expect(started.mode).toBe("resize-end");
  });

  it("refuses to resize an item the host locked", () => {
    const items = demoItems().map((item) =>
      item.id === "a" ? { ...item, resizable: false } : item,
    );
    const machine = machineFor({}, items);
    const cross = surface.crossOf("a");
    const right = surface.mainOf(START + 6 * DAY);
    machine.handle(sample(1, "down", right - 2, cross, 0));
    const dragged = machine.handle(sample(1, "move", right + 18, cross, 16));
    // The body is still draggable: locking the size is not locking the item.
    expect((of(dragged, "editStart")[0] as EditStartEffect).mode).toBe("move");
  });
});

describe("moveTrigger", () => {
  it("long-press makes even a mouse hold", () => {
    const machine = machineFor({ moveTrigger: "long-press", longPressMs: 300 });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    const down = machine.handle(sample(1, "down", main, cross, 0));
    expect((of(down, "schedule")[0] as ScheduleEffect).at).toBe(300);
    const early = machine.handle(sample(1, "move", main + 40, cross, 100));
    expect(of(early, "editStart")).toHaveLength(0);
  });

  it("long-press applies to a handle too", () => {
    const machine = machineFor({ moveTrigger: "long-press", longPressMs: 300 });
    const cross = surface.crossOf("a");
    const right = surface.mainOf(START + 6 * DAY);
    machine.handle(sample(1, "down", right - 2, cross, 0));
    const woken = machine.elapse(300);
    expect((of(woken, "editStart")[0] as EditStartEffect).mode).toBe("resize-end");
  });

  it("edit-mode drags with a finger straight away", () => {
    const machine = machineFor({ moveTrigger: "edit-mode" });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0, "touch"));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16, "touch"));
    expect((of(dragged, "editStart")[0] as EditStartEffect).trigger).toBe("pointer");
  });

  it("handle lets the body pan and only the edges edit", () => {
    const machine = machineFor({ moveTrigger: "handle" });
    const cross = surface.crossOf("a");
    const middle = surface.mainOf(START + 4 * DAY);
    machine.handle(sample(1, "down", middle, cross, 0));
    const panned = machine.handle(sample(1, "move", middle + 40, cross, 16));
    expect(of(panned, "editStart")).toHaveLength(0);
    expect(of(panned, "viewport")).not.toHaveLength(0);

    machine.handle(sample(1, "up", middle + 40, cross, 32));
    const right = surface.mainOf(START + 6 * DAY);
    machine.handle(sample(2, "down", right - 2, cross, 100));
    const resized = machine.handle(sample(2, "move", right + 18, cross, 116));
    expect((of(resized, "editStart")[0] as EditStartEffect).mode).toBe("resize-end");
  });

  it("pans an item the host marked immovable", () => {
    const items = demoItems().map((item) => (item.id === "a" ? { ...item, movable: false } : item));
    const machine = machineFor({ moveTrigger: "edit-mode" }, items);
    const cross = surface.crossOf("a");
    const middle = surface.mainOf(START + 4 * DAY);
    machine.handle(sample(1, "down", middle, cross, 0));
    const moved = machine.handle(sample(1, "move", middle + 40, cross, 16));
    expect(of(moved, "editStart")).toHaveLength(0);
    expect(of(moved, "viewport")).not.toHaveLength(0);
  });
});

describe("snapping", () => {
  it("puts the grabbed item on the grid", () => {
    const machine = machineFor({ snapMs: DAY });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    // Thirteen pixels is 0.65 of a day: it rounds up, not down.
    const dragged = machine.handle(sample(1, "move", main + 13, cross, 16));
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 3 * DAY, end: START + 7 * DAY },
    ]);
  });

  it("says nothing while the drag stays on the same grid step", () => {
    const machine = machineFor({ snapMs: DAY });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 20, cross, 16));
    const again = machine.handle(sample(1, "move", main + 24, cross, 32));
    expect(of(again, "editMove")).toHaveLength(0);
  });
});

describe("dragging a selection", () => {
  const selected = ["a", "c"];

  it("moves every selected item by the same shift", () => {
    const machine = machineFor({ multiSelect: true, snapMs: DAY });
    machine.setSelection(selected);
    expect(machine.selectedIds).toEqual(selected);
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16));
    const started = of(dragged, "editStart")[0] as EditStartEffect;
    expect(started.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 4 * DAY, end: START + 8 * DAY },
      { id: "c", start: START + 6 * DAY, end: START + 10 * DAY },
    ]);
  });

  it("drags only the grabbed item when it is not in the selection", () => {
    const machine = machineFor({ multiSelect: true });
    machine.setSelection(["b", "c"]);
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).items).toHaveLength(1);
  });

  it("leaves a locked item of the selection where it is", () => {
    const items = demoItems().map((item) => (item.id === "c" ? { ...item, movable: false } : item));
    const machine = machineFor({ multiSelect: true }, items);
    machine.setSelection(selected);
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).items.map((item) => item.id)).toEqual([
      "a",
    ]);
  });

  it("ignores the selection without a lookup to resolve it with", () => {
    const own = surfaceFor();
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { enabled: true, hitTest: own.tester.hitTest, multiSelect: true },
    });
    machine.setSelection(selected);
    const cross = own.crossOf("a");
    const main = own.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).items).toHaveLength(1);
  });
});

describe("dragging between lanes", () => {
  it("patches the lane of the grabbed item only", () => {
    const machine = machineFor({ crossLane: true, multiSelect: true, snapMs: DAY });
    machine.setSelection(["a", "c"]);
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, surface.crossOf("a"), 0));
    const dragged = machine.handle(sample(1, "move", main + 20, surface.crossOf("c"), 16));
    const patches = (of(dragged, "editMove")[0] as EditMoveEffect).patches;
    expect(patches[0]?.laneId).toBe("l2");
    // The rest of the selection keeps its lane: a selection spanning lanes
    // would otherwise collapse into one.
    expect("laneId" in (patches[1] ?? {})).toBe(false);
  });

  it("keeps the lane when crossLane is off", () => {
    const machine = machineFor({ snapMs: DAY });
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, surface.crossOf("a"), 0));
    const dragged = machine.handle(sample(1, "move", main + 20, surface.crossOf("c"), 16));
    expect("laneId" in ((of(dragged, "editMove")[0] as EditMoveEffect).patches[0] ?? {})).toBe(
      false,
    );
  });

  it("keeps the lane when the pointer leaves every lane", () => {
    const machine = machineFor({ crossLane: true, snapMs: DAY });
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, surface.crossOf("a"), 0));
    const dragged = machine.handle(sample(1, "move", main + 20, 199, 16));
    // Not `null`: with declared lanes a cleared lane took the item out of
    // view. Unset keeps the lane it was in.
    expect("laneId" in ((of(dragged, "editMove")[0] as EditMoveEffect).patches[0] ?? {})).toBe(false);
  });
});

describe("the view can move under a drag", () => {
  it("keeps the grabbed instant under the pointer across a zoom", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, cross, 16));
    const before = (of(dragged, "editMove")[0] as EditMoveEffect).patches[0]?.start ?? 0;

    const spanBefore = machine.domain[1] - machine.domain[0];
    machine.zoom(2, main + 40);
    // Really zoomed, so the assertion below is not vacuous.
    expect(machine.domain[1] - machine.domain[0]).toBeLessThan(spanBefore);

    const again = machine.handle(sample(1, "move", main + 40, cross, 32));
    const proposed = of(again, "editMove")[0] as EditMoveEffect | undefined;
    // Zooming about the pointer leaves the instant under it alone, so the
    // dragged item must not move either. Nothing new to propose is the
    // strongest form of that: the change detector compares the proposed start.
    expect(proposed?.patches[0]?.start ?? before).toBeCloseTo(before, 0);
  });
});

describe("another pointer during an edit", () => {
  it("neither pinches nor takes the drag over", () => {
    const machine = machineFor({ moveTrigger: "edit-mode" });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0, "touch"));
    machine.handle(sample(1, "move", main + 40, cross, 16, "touch"));
    const second = machine.handle(sample(2, "down", main + 200, cross, 32, "touch"));
    expect(of(second, "gestureStart")).toHaveLength(0);
    expect(machine.phase).toBe("editing");
    expect(machine.pointerCount).toBe(2);

    // The second finger moving does nothing at all.
    const stray = machine.handle(sample(2, "move", main + 260, cross, 48, "touch"));
    expect(stray).toHaveLength(0);

    const lifted = machine.handle(sample(1, "up", main + 40, cross, 64, "touch"));
    expect((of(lifted, "editEnd")[0] as EditEndEffect).cancelled).toBe(false);

    // And the finger still down must not inherit the gesture.
    const leftover = machine.handle(sample(2, "move", main + 320, cross, 80, "touch"));
    expect(of(leftover, "viewport")).toHaveLength(0);
  });

  it("lets the edit end when a stray pointer lifts first", () => {
    const machine = machineFor({ moveTrigger: "edit-mode" });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0, "touch"));
    machine.handle(sample(1, "move", main + 40, cross, 16, "touch"));
    machine.handle(sample(2, "down", main + 200, cross, 32, "touch"));
    const strayUp = machine.handle(sample(2, "up", main + 200, cross, 48, "touch"));
    expect(of(strayUp, "editEnd")).toHaveLength(0);
    expect(machine.phase).toBe("editing");
    const ended = machine.handle(sample(1, "up", main + 40, cross, 64, "touch"));
    expect(of(ended, "editEnd")).toHaveLength(1);
  });
});

describe("the programmatic twin", () => {
  it("moves items with the same snapping, veto and command as a drag", () => {
    const machine = machineFor({ snapMs: DAY, multiSelect: true });
    const effects = machine.moveItems(["a", "c"], 2.4 * DAY);
    expect((of(effects, "editStart")[0] as EditStartEffect).trigger).toBe("api");
    expect((of(effects, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 4 * DAY, end: START + 8 * DAY },
      { id: "c", start: START + 6 * DAY, end: START + 10 * DAY },
    ]);
    const command = (of(effects, "editEnd")[0] as EditEndEffect).command;
    expect(command?.inverse.after).toEqual([
      { id: "a", start: START + 2 * DAY, end: START + 6 * DAY },
      { id: "c", start: START + 4 * DAY, end: START + 8 * DAY },
    ]);
  });

  it("moves an item into another lane", () => {
    const machine = machineFor();
    const effects = machine.moveItems(["a"], 0, "l2");
    expect((of(effects, "editEnd")[0] as EditEndEffect).command?.after).toEqual([
      { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "l2" },
    ]);
  });

  it("resizes one item", () => {
    const machine = machineFor();
    const effects = machine.resizeItem("a", "end", DAY);
    expect((of(effects, "editEnd")[0] as EditEndEffect).command?.after).toEqual([
      { id: "a", end: START + 7 * DAY },
    ]);
  });

  it("reports an edit that changes nothing as cancelled", () => {
    const machine = machineFor();
    const effects = machine.moveItems(["a"], 0);
    expect((of(effects, "editEnd")[0] as EditEndEffect).cancelled).toBe(true);
    // A resize that cannot move the edge at all proposes nothing: start, end.
    expect(machine.resizeItem("a", "end", 0)).toHaveLength(2);
  });

  it("does nothing without editing, a lookup, or a known item", () => {
    const own = surfaceFor();
    const off = createInputMachine({ domain: DOMAIN, mainSize: MAIN_SIZE });
    expect(off.moveItems(["a"], DAY)).toHaveLength(0);
    expect(off.resizeItem("a", "end", DAY)).toHaveLength(0);

    const noLookup = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      editing: { enabled: true, hitTest: own.tester.hitTest },
    });
    expect(noLookup.moveItems(["a"], DAY)).toHaveLength(0);
    expect(noLookup.resizeItem("a", "end", DAY)).toHaveLength(0);

    const machine = machineFor();
    expect(machine.moveItems(["nope"], DAY)).toHaveLength(0);
    expect(machine.resizeItem("nope", "end", DAY)).toHaveLength(0);
  });

  it("refuses to resize an item the host locked", () => {
    const items = demoItems().map((item) =>
      item.id === "a" ? { ...item, resizable: false } : item,
    );
    const machine = machineFor({}, items);
    expect(machine.resizeItem("a", "end", DAY)).toHaveLength(0);
  });

  it("skips an immovable item", () => {
    const items = demoItems().map((item) => (item.id === "a" ? { ...item, movable: false } : item));
    const machine = machineFor({}, items);
    expect(machine.moveItems(["a"], DAY)).toHaveLength(0);
  });
});

describe("the host can change the rules", () => {
  it("takes a fresh hit tester after a redraw", () => {
    const machine = machineFor();
    const moved: Item[] = [{ id: "z", start: START + 20 * DAY, end: START + 24 * DAY }];
    const layout = layoutItems(moved);
    const scale = createTimeScale(DOMAIN, MAIN_SIZE);
    machine.setEditing({ ...createHitTester({ layout, scale }) });
    const main = scale.toMain(START + 22 * DAY);
    machine.handle(sample(1, "down", main, 10, 0));
    const dragged = machine.handle(sample(1, "move", main + 40, 10, 16));
    expect((of(dragged, "editStart")[0] as EditStartEffect).items.map((item) => item.id)).toEqual([
      "z",
    ]);
  });

  it("keeps the rules it was not given", () => {
    const machine = machineFor({ snapMs: DAY });
    machine.setEditing({ multiSelect: true });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const dragged = machine.handle(sample(1, "move", main + 13, cross, 16));
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches[0]?.start).toBe(START + 3 * DAY);
  });
});

describe("edges", () => {
  it("cancels a running edit on reset", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 40, cross, 16));
    const effects = machine.reset();
    expect((of(effects, "editEnd")[0] as EditEndEffect).cancelled).toBe(true);
    expect(machine.phase).toBe("idle");
  });

  it("cancels a pending hold on reset", () => {
    const machine = machineFor({ longPressMs: 400 });
    machine.handle(sample(1, "down", surface.mainOf(START + 3 * DAY), surface.crossOf("a"), 0, "touch"));
    expect((of(machine.reset(), "schedule")[0] as ScheduleEffect).at).toBeNull();
  });

  it("says nothing at all in a container with no pixels", () => {
    const own = surfaceFor();
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: 0,
      editing: { enabled: true, ...own.tester },
    });
    expect(machine.handle(sample(1, "down", 10, 10, 0))).toHaveLength(0);
    expect(machine.elapse(10_000)).toHaveLength(0);
  });

  it("edits a vertical timeline through the same code", () => {
    const own = surfaceFor();
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: MAIN_SIZE,
      crossSize: 200,
      orientation: "vertical",
      editing: { enabled: true, ...own.tester, snapMs: DAY },
    });
    const main = own.mainOf(START + 3 * DAY);
    const cross = own.crossOf("a");
    // Vertical: the time axis is y, the lanes run across x.
    machine.handle(sample(1, "down", cross, main, 0));
    const dragged = machine.handle(sample(1, "move", cross, main + 40, 16));
    expect((of(dragged, "editMove")[0] as EditMoveEffect).patches).toEqual([
      { id: "a", start: START + 4 * DAY, end: START + 8 * DAY },
    ]);
  });

  it("ignores a move from a pointer it never saw go down", () => {
    const machine = machineFor();
    expect(machine.handle(sample(9, "move", 100, 10, 0))).toHaveLength(0);
  });

  it("lets the wheel zoom while an item is being dragged", () => {
    const machine = machineFor();
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 40, cross, 16));
    const zoomed = machine.wheel({
      x: main,
      y: cross,
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      shiftKey: false,
      time: 32,
    });
    expect(of(zoomed, "viewport")).toHaveLength(1);
    expect(machine.phase).toBe("editing");
  });
});

describe("canMove is asked about every proposal", () => {
  it("is called with the item and the patch", () => {
    const canMove = vi.fn<(item: Item, next: ItemPatch) => boolean>(() => true);
    const machine = machineFor({ canMove, snapMs: DAY });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 20, cross, 16));
    expect(canMove).toHaveBeenCalled();
    const [item, patch] = canMove.mock.calls[0] ?? [];
    expect(item?.id).toBe("a");
    expect(patch?.start).toBe(START + 3 * DAY);
  });

  it("holds the item at the last accepted position when it says no", () => {
    const machine = machineFor({
      snapMs: DAY,
      // Nothing may start after day 5.
      canMove: (_item, next) => (next.start ?? 0) <= START + 5 * DAY,
    });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    const allowed = machine.handle(sample(1, "move", main + 60, cross, 16));
    expect((of(allowed, "editMove")[0] as EditMoveEffect).patches[0]?.start).toBe(START + 5 * DAY);

    const refused = machine.handle(sample(1, "move", main + 120, cross, 32));
    const effect = of(refused, "editMove")[0] as EditMoveEffect;
    expect(effect.vetoed).toBe(true);
    // The last accepted position comes back out, so applying it is always right.
    expect(effect.patches[0]?.start).toBe(START + 5 * DAY);

    // And it says no only once while the answer stays no.
    expect(of(machine.handle(sample(1, "move", main + 140, cross, 48)), "editMove")).toHaveLength(
      0,
    );

    const ended = machine.handle(sample(1, "up", main + 140, cross, 64));
    expect((of(ended, "editEnd")[0] as EditEndEffect).command?.after[0]?.start).toBe(
      START + 5 * DAY,
    );
  });

  it("goes back to yes when the pointer returns to allowed ground", () => {
    const machine = machineFor({
      snapMs: DAY,
      canMove: (_item, next) => (next.start ?? 0) <= START + 5 * DAY,
    });
    const cross = surface.crossOf("a");
    const main = surface.mainOf(START + 3 * DAY);
    machine.handle(sample(1, "down", main, cross, 0));
    machine.handle(sample(1, "move", main + 120, cross, 16));
    const back = machine.handle(sample(1, "move", main + 20, cross, 32));
    const effect = of(back, "editMove")[0] as EditMoveEffect;
    expect(effect.vetoed).toBe(false);
    expect(effect.patches[0]?.start).toBe(START + 3 * DAY);
  });
});
