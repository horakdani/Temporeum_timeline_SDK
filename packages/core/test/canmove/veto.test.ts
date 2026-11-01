import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type {
  EditEndEffect,
  EditMoveEffect,
  EditStartEffect,
  EditingInputOptions,
  InputEffect,
  InputMachine,
  PointerSample,
} from "../../src/input.js";
import type { Item, ItemPatch } from "../../src/types.js";
import { DAY, START, MAIN_SIZE, surfaceFor } from "../edit-fixture.js";

/**
 * `canMove`, which is where a host's own rules meet the gesture.
 *
 * Two decisions are under test, and both are easy to get subtly wrong.
 *
 * A veto is **atomic**: one refused item refuses the whole proposal. A
 * partial move would silently rearrange what the user grabbed, and they would
 * read that as a bug in the library rather than as their own rule working.
 *
 * A veto is **not a cancel**: the last accepted position goes out again with
 * `vetoed: true`, so applying the patches is always the right thing for the
 * host to do and `vetoed` is feedback rather than a branch. The item stays
 * where the rule last allowed it — it does not snap back to the start, and it
 * does not get left in the refused position when the finger lifts.
 *
 * And a *locked* item is a different thing from a refused one: it is simply
 * not part of the drag. Refusing a whole selection because one item is pinned
 * would make selections unusable.
 *
 * Both routes to an edit are driven here — the gesture and the programmatic
 * twin — because a veto that only works for fingers is a keyboard user's
 * data-loss bug. The suite writes a trace of which routes actually produced a
 * veto, and the gate reads it.
 */

const CEILING_START = START + 4 * DAY;
const CEILING_END = START + 8 * DAY;

function editableItems(): Item[] {
  return [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "l1" },
    { id: "b", start: START + 10 * DAY, end: START + 14 * DAY, laneId: "l1" },
    // Pinned by the host: part of a selection, but never dragged.
    { id: "locked", start: START + 4 * DAY, end: START + 8 * DAY, laneId: "l2", movable: false },
    // Movable, but its duration is not the user's to change.
    { id: "fixed", start: START + 16 * DAY, end: START + 20 * DAY, laneId: "l2", resizable: false },
  ];
}

const surface = surfaceFor(editableItems());

interface Trace {
  /** Which routes to an edit actually produced a veto. */
  vetoed: string[];
  /** Commands emitted for a position the host refused. Must stay zero. */
  commandsAfterVeto: number;
  /** Refused multi-item proposals: how many items moved anyway. */
  atomic: { selected: number; movedAnyway: number }[];
  canMoveCalls: number;
}

const trace: Trace = { vetoed: [], commandsAfterVeto: 0, atomic: [], canMoveCalls: 0 };

function machineWith(editing: Partial<EditingInputOptions>): InputMachine {
  return createInputMachine({
    domain: [START, START + 30 * DAY],
    mainSize: MAIN_SIZE,
    crossSize: surface.layout.crossSize,
    contentCrossSize: surface.layout.crossSize,
    editing: {
      enabled: true,
      moveTrigger: "edit-mode",
      hitTest: surface.tester.hitTest,
      lookup: surface.tester.lookup,
      laneAt: surface.tester.laneAt,
      ...editing,
    },
  });
}

/** `canMove` that counts its calls, so atomicity is observable. */
function rule(allow: (item: Item, next: ItemPatch) => boolean): (i: Item, n: ItemPatch) => boolean {
  return (item, next) => {
    trace.canMoveCalls += 1;
    return allow(item, next);
  };
}

let clock = 1000;
function at(main: number, cross: number, phase: PointerSample["phase"]): PointerSample {
  return { pointerId: 1, phase, x: main, y: cross, time: (clock += 20), pointerType: "mouse" };
}

const moveOf = (effects: readonly InputEffect[]): EditMoveEffect | undefined =>
  effects.find((effect) => effect.type === "editMove") as EditMoveEffect | undefined;
const endOf = (effects: readonly InputEffect[]): EditEndEffect | undefined =>
  effects.find((effect) => effect.type === "editEnd") as EditEndEffect | undefined;
const startOf = (effects: readonly InputEffect[]): EditStartEffect | undefined =>
  effects.find((effect) => effect.type === "editStart") as EditStartEffect | undefined;

const BODY_A = surface.mainOf(START + 4 * DAY);
const CROSS_A = surface.crossOf("a");
/** The last pixels of item "a": its end handle. */
const HANDLE_A_END = surface.mainOf(START + 6 * DAY) - 3;

describe("canMove", () => {
  it("leaves the item at the last accepted position when the host refuses", () => {
    const machine = machineWith({
      canMove: rule((_item, next) => next.start === undefined || next.start <= CEILING_START),
    });
    machine.handle(at(BODY_A, CROSS_A, "down"));
    // +2 days: the rule's limit exactly, so it is allowed.
    const allowed = moveOf(machine.handle(at(BODY_A + 40, CROSS_A, "move")));
    expect(allowed?.vetoed).toBe(false);
    expect(allowed?.patches[0]?.start).toBe(START + 4 * DAY);

    // +3 days: refused. The last accepted position goes out again.
    const refused = moveOf(machine.handle(at(BODY_A + 60, CROSS_A, "move")));
    expect(refused?.vetoed).toBe(true);
    expect(refused?.patches[0]?.start).toBe(START + 4 * DAY);
    trace.vetoed.push("gesture-move");

    // And the lift commits the accepted position, not the refused one.
    const end = endOf(machine.handle(at(BODY_A + 60, CROSS_A, "up")));
    expect(end?.command?.after[0]?.start).toBe(START + 4 * DAY);
    if (end?.command?.after[0]?.start !== START + 4 * DAY) {
      trace.commandsAfterVeto += 1;
    }
  });

  it("says so once, not on every pixel, and takes it back when the rule allows again", () => {
    const machine = machineWith({
      canMove: rule((_item, next) => next.start === undefined || next.start <= CEILING_START),
    });
    machine.handle(at(BODY_A, CROSS_A, "down"));
    machine.handle(at(BODY_A + 40, CROSS_A, "move"));
    expect(moveOf(machine.handle(at(BODY_A + 60, CROSS_A, "move")))?.vetoed).toBe(true);
    // Still refused, and the host has already been told. Repeating it every
    // pixel would turn a rule into a stream of events.
    expect(moveOf(machine.handle(at(BODY_A + 80, CROSS_A, "move")))).toBeUndefined();
    expect(moveOf(machine.handle(at(BODY_A + 100, CROSS_A, "move")))).toBeUndefined();
    // Back inside the rule: the veto is lifted explicitly.
    const back = moveOf(machine.handle(at(BODY_A + 20, CROSS_A, "move")));
    expect(back?.vetoed).toBe(false);
    expect(back?.patches[0]?.start).toBe(START + 3 * DAY);
  });

  it("refuses the whole selection when one item is refused", () => {
    const machine = machineWith({
      multiSelect: true,
      // Only "b" has a limit, and it is tighter than "a"'s.
      canMove: rule(
        (item, next) => item.id !== "b" || next.start === undefined || next.start <= START + 11 * DAY,
      ),
    });
    machine.setSelection(["a", "b"]);
    machine.handle(at(BODY_A, CROSS_A, "down"));
    const allowed = moveOf(machine.handle(at(BODY_A + 20, CROSS_A, "move")));
    expect(allowed?.vetoed).toBe(false);
    expect(allowed?.patches).toHaveLength(2);

    // "a" could move another day. It does not, because "b" cannot.
    const refused = moveOf(machine.handle(at(BODY_A + 40, CROSS_A, "move")));
    expect(refused?.vetoed).toBe(true);
    const movedAnyway = (refused?.patches ?? []).filter(
      (patch) => patch.id === "a" && patch.start !== START + 3 * DAY,
    ).length;
    expect(movedAnyway).toBe(0);
    trace.atomic.push({ selected: 2, movedAnyway });
    // Both items were asked about, not just the one under the pointer.
    expect(refused?.patches.map((patch) => patch.id)).toEqual(["a", "b"]);
  });

  it("refuses a resize the same way", () => {
    const machine = machineWith({
      canMove: rule((_item, next) => next.end === undefined || next.end === null || next.end <= CEILING_END),
    });
    machine.handle(at(HANDLE_A_END, CROSS_A, "down"));
    expect(startOf(machine.handle(at(HANDLE_A_END + 20, CROSS_A, "move")))?.mode).toBe(
      "resize-end",
    );
    const refused = moveOf(machine.handle(at(HANDLE_A_END + 80, CROSS_A, "move")));
    expect(refused?.vetoed).toBe(true);
    trace.vetoed.push("gesture-resize");
    const end = endOf(machine.handle(at(HANDLE_A_END + 80, CROSS_A, "up")));
    // The accepted end was day 7; the refused one would have been day 10.
    expect(end?.command?.after[0]?.end).toBe(START + 7 * DAY);
    if ((end?.command?.after[0]?.end ?? 0) > CEILING_END) {
      trace.commandsAfterVeto += 1;
    }
  });

  it("refuses the programmatic twin, which is the keyboard route", () => {
    const machine = machineWith({
      canMove: rule((_item, next) => next.start === undefined || next.start <= CEILING_START),
    });
    // A keyboard nudge that a rule refuses must not be the one route that
    // writes the change anyway.
    const effects = machine.moveItems(["a"], 10 * DAY);
    expect(startOf(effects)?.trigger).toBe("api");
    expect(moveOf(effects)?.vetoed).toBe(true);
    expect(moveOf(effects)?.patches).toEqual([]);
    const end = endOf(effects);
    expect(end?.cancelled).toBe(true);
    expect(end?.command).toBeUndefined();
    trace.vetoed.push("api-move");
    if (end?.command !== undefined) {
      trace.commandsAfterVeto += 1;
    }
  });

  it("refuses a programmatic resize too", () => {
    const machine = machineWith({
      canMove: rule((_item, next) => next.end === undefined || next.end === null || next.end <= CEILING_END),
    });
    const effects = machine.resizeItem("a", "end", 10 * DAY);
    expect(moveOf(effects)?.vetoed).toBe(true);
    const end = endOf(effects);
    expect(end?.cancelled).toBe(true);
    expect(end?.command).toBeUndefined();
    trace.vetoed.push("api-resize");
    if (end?.command !== undefined) {
      trace.commandsAfterVeto += 1;
    }
  });

  it("hands the rule the item and the position it would get, not the one it has", () => {
    const seen: { id: string; start: number | undefined }[] = [];
    const machine = machineWith({
      canMove: rule((item, next) => {
        seen.push({ id: item.id, start: next.start });
        return true;
      }),
    });
    machine.handle(at(BODY_A, CROSS_A, "down"));
    machine.handle(at(BODY_A + 40, CROSS_A, "move"));
    expect(seen).toEqual([{ id: "a", start: START + 4 * DAY }]);
    // The item itself, by identity, so a host can read its own payload off it.
    expect(surface.layout.items.some((placed) => placed.item.id === "a")).toBe(true);
  });

  it("leaves a locked item out of the drag instead of refusing the drag", () => {
    const machine = machineWith({ multiSelect: true });
    machine.setSelection(["a", "locked"]);
    machine.handle(at(BODY_A, CROSS_A, "down"));
    const moved = moveOf(machine.handle(at(BODY_A + 40, CROSS_A, "move")));
    expect(moved?.vetoed).toBe(false);
    // One patch: the pinned item is simply not in the drag.
    expect(moved?.patches.map((patch) => patch.id)).toEqual(["a"]);
  });

  it("will not start a drag on a locked item at all", () => {
    const machine = machineWith({});
    const cross = surface.crossOf("locked");
    machine.handle(at(surface.mainOf(START + 6 * DAY), cross, "down"));
    const effects = machine.handle(at(surface.mainOf(START + 6 * DAY) + 40, cross, "move"));
    expect(startOf(effects)).toBeUndefined();
    // It pans instead, which is what the gesture means when nothing is grabbed.
    expect(machine.phase).toBe("panning");
  });

  it("will not resize a non-resizable item even if the host's hit tester offers a handle", () => {
    // The core's own hit tester reports a non-resizable item as all body, so
    // this can only happen with a host-supplied one — and a host that gets it
    // wrong must not be able to resize an item the host itself pinned. The
    // machine does not trust what it is handed.
    const hit = surface.tester.lookup("fixed");
    expect(hit).toBeDefined();
    const machine = machineWith({
      hitTest: () => (hit === undefined ? undefined : { ...hit, part: "end" }),
    });
    const cross = surface.crossOf("fixed");
    machine.handle(at(surface.mainOf(START + 18 * DAY), cross, "down"));
    const effects = machine.handle(at(surface.mainOf(START + 18 * DAY) + 40, cross, "move"));
    expect(startOf(effects)).toBeUndefined();
    expect(machine.phase).toBe("panning");
  });

  it("moves an item whose duration is not the user's to change", () => {
    const machine = machineWith({});
    const cross = surface.crossOf("fixed");
    // Aimed at where the end handle would be. A non-resizable item is all
    // body, so this moves it rather than doing nothing.
    const edge = surface.mainOf(START + 20 * DAY) - 3;
    machine.handle(at(edge, cross, "down"));
    const started = startOf(machine.handle(at(edge + 40, cross, "move")));
    expect(started?.mode).toBe("move");
  });
});

afterAll(() => {
  writeFileSync(".canmove-trace.json", `${JSON.stringify(trace, null, 2)}\n`);
});
