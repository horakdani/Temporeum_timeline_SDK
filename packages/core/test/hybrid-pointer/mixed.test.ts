import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type {
  EditStartEffect,
  EditTrigger,
  InputEffect,
  InputMachine,
  PointerKind,
  PointerSample,
  ScheduleEffect,
} from "../../src/input.js";
import { DAY, START, MAIN_SIZE, surfaceFor } from "../edit-fixture.js";

/**
 * The hybrid device, which is the case a touch/mouse split gets wrong.
 *
 * A laptop with a touchscreen is one machine with two hands, and the user
 * switches between them mid-sentence. A mouse that has to be held for half a
 * second feels broken; a finger that drags on contact makes the list
 * unscrollable. So `moveTrigger: "auto"` resolves **per gesture, from the
 * pointer that started it** — and the thing worth proving is that the machine
 * does not *latch*: the mouse is still immediate after a finger used the hold.
 *
 * Every test here drives one machine through synthetic pointer samples, and
 * the single-session test writes a trace of what actually happened for the
 * gate to read. Name-matching a test title would let the claim drift away
 * from the behaviour; the trace cannot, because the machine produced it.
 */

const surface = surfaceFor();
/** Inside item "a" (days 2 to 6), clear of both resize handles. */
const BODY_MAIN = surface.mainOf(START + 4 * DAY);
const BODY_CROSS = surface.crossOf("a");
/** The start handle: the first ten pixels of the item. */
const HANDLE_MAIN = surface.mainOf(START + 2 * DAY) + 3;
const LONG_PRESS_MS = 500;

interface TraceEvent {
  readonly step: number;
  readonly pointerType: PointerKind;
  /** The wake-up the machine asked for on press, if any. */
  readonly scheduled: number | null;
  /** Whether the edit needed the clock to come round before it started. */
  readonly elapsed: boolean;
  readonly trigger: EditTrigger | null;
}

const trace: { machinesInSession: number; events: TraceEvent[] } = {
  machinesInSession: 0,
  events: [],
};

function machineFor(): InputMachine {
  return createInputMachine({
    domain: [START, START + 30 * DAY],
    mainSize: MAIN_SIZE,
    crossSize: surface.layout.crossSize,
    contentCrossSize: surface.layout.crossSize,
    editing: {
      enabled: true,
      // The setting under test. Nothing else in the options mentions a
      // pointer type: the resolution is the machine's job.
      moveTrigger: "auto",
      longPressMs: LONG_PRESS_MS,
      hitTest: surface.tester.hitTest,
      lookup: surface.tester.lookup,
      laneAt: surface.tester.laneAt,
    },
  });
}

function sample(
  pointerId: number,
  phase: PointerSample["phase"],
  main: number,
  time: number,
  pointerType: PointerKind,
): PointerSample {
  return { pointerId, phase, x: main, y: BODY_CROSS, time, pointerType };
}

function startOf(effects: readonly InputEffect[]): EditStartEffect | undefined {
  return effects.find((effect) => effect.type === "editStart") as EditStartEffect | undefined;
}

function scheduleOf(effects: readonly InputEffect[]): ScheduleEffect | undefined {
  return effects.find((effect) => effect.type === "schedule") as ScheduleEffect | undefined;
}

describe("one machine, two hands", () => {
  it("drags at once for the mouse and holds for the finger, in the same session", () => {
    let machines = 0;
    const make = (): InputMachine => {
      machines += 1;
      return machineFor();
    };
    // ONE machine for the whole session. That is the claim: not that a
    // mouse-configured machine drags and a touch-configured one holds, which
    // would prove only that two different objects behave differently.
    const machine = make();

    // --- the mouse, which must not be made to wait ---------------------------
    const mouseDown = machine.handle(sample(1, "down", BODY_MAIN, 1000, "mouse"));
    expect(scheduleOf(mouseDown)).toBeUndefined();
    expect(startOf(mouseDown)).toBeUndefined();
    // No clock went round, and no wake-up was asked for: the very next move
    // starts the drag.
    expect(machine.elapse(9_999_999)).toEqual([]);
    const mouseMove = machine.handle(sample(1, "move", BODY_MAIN + 24, 1020, "mouse"));
    const mouseStart = startOf(mouseMove);
    expect(mouseStart?.trigger).toBe("pointer");
    expect(mouseStart?.mode).toBe("move");
    const mouseUp = machine.handle(sample(1, "up", BODY_MAIN + 24, 1040, "mouse"));
    expect(mouseUp.some((effect) => effect.type === "editEnd" && effect.command !== undefined)).toBe(
      true,
    );
    trace.events.push({
      step: 1,
      pointerType: "mouse",
      scheduled: null,
      elapsed: false,
      trigger: mouseStart?.trigger ?? null,
    });

    // --- the finger, on the same machine, which must be held ----------------
    const touchDown = machine.handle(sample(2, "down", BODY_MAIN, 2000, "touch"));
    expect(startOf(touchDown)).toBeUndefined();
    const asked = scheduleOf(touchDown);
    expect(asked?.at).toBe(2000 + LONG_PRESS_MS);
    expect(asked?.reason).toBe("long-press");
    // Still not due: a hold that fired early would make a tap feel like a drag.
    expect(machine.elapse(2000 + LONG_PRESS_MS - 1)).toEqual([]);
    const woken = machine.elapse(2000 + LONG_PRESS_MS);
    const touchStart = startOf(woken);
    expect(touchStart?.trigger).toBe("long-press");
    const touchMove = machine.handle(sample(2, "move", BODY_MAIN + 24, 2520, "touch"));
    expect(touchMove.some((effect) => effect.type === "editMove")).toBe(true);
    const touchUp = machine.handle(sample(2, "up", BODY_MAIN + 24, 2540, "touch"));
    expect(touchUp.some((effect) => effect.type === "editEnd" && effect.command !== undefined)).toBe(
      true,
    );
    trace.events.push({
      step: 2,
      pointerType: "touch",
      scheduled: asked?.at ?? null,
      elapsed: true,
      trigger: touchStart?.trigger ?? null,
    });

    // --- the mouse again: the machine must not have latched -----------------
    const againDown = machine.handle(sample(3, "down", BODY_MAIN, 3000, "mouse"));
    expect(scheduleOf(againDown)).toBeUndefined();
    const againMove = machine.handle(sample(3, "move", BODY_MAIN + 24, 3020, "mouse"));
    const againStart = startOf(againMove);
    expect(againStart?.trigger).toBe("pointer");
    machine.handle(sample(3, "up", BODY_MAIN + 24, 3040, "mouse"));
    trace.events.push({
      step: 3,
      pointerType: "mouse",
      scheduled: null,
      elapsed: false,
      trigger: againStart?.trigger ?? null,
    });

    trace.machinesInSession = machines;
    expect(machines).toBe(1);
  });

  it("takes a finger's tap and a mouse's click on the same spot as two taps, not a double tap", () => {
    const tapOf = (effects: readonly InputEffect[]) => effects.find((effect) => effect.type === "tap") as { tapCount: number } | undefined;
    const zooms = (effects: readonly InputEffect[]) => effects.some((effect) => effect.type === "viewport");
    const tap = (machine: InputMachine, id: number, time: number, pointerType: PointerKind): readonly InputEffect[] => {
      machine.handle(sample(id, "down", BODY_MAIN, time, pointerType));
      return machine.handle(sample(id, "up", BODY_MAIN, time + 40, pointerType));
    };
    // The finger, then the mouse, 100 ms apart on the same pixel: a hybrid
    // device's two hands, not one hand tapping twice.
    const mixed = machineFor();
    expect(tapOf(tap(mixed, 1, 1000, "touch"))?.tapCount).toBe(1);
    const second = tap(mixed, 2, 1100, "mouse");
    expect(tapOf(second)?.tapCount).toBe(1);
    expect(zooms(second)).toBe(false);
    // The control: the same two taps by one mouse are a double tap, and zoom.
    const one = machineFor();
    tap(one, 1, 1000, "mouse");
    const double = tap(one, 1, 1100, "mouse");
    expect(tapOf(double)?.tapCount).toBe(2);
    expect(zooms(double)).toBe(true);
  });

  it("lets a finger take a resize handle without the hold", () => {
    const machine = machineFor();
    const down = machine.handle({
      pointerId: 1,
      phase: "down",
      x: HANDLE_MAIN,
      y: BODY_CROSS,
      time: 1000,
      pointerType: "touch",
    });
    // A handle is aimed at, so the intent is already explicit. Making the
    // user hold it as well is ceremony for its own sake.
    expect(scheduleOf(down)).toBeUndefined();
    const move = machine.handle({
      pointerId: 1,
      phase: "move",
      x: HANDLE_MAIN + 20,
      y: BODY_CROSS,
      time: 1020,
      pointerType: "touch",
    });
    const started = startOf(move);
    expect(started?.trigger).toBe("handle");
    expect(started?.mode).toBe("resize-start");
  });

  it("cancels the hold when the finger pans instead of waiting", () => {
    const machine = machineFor();
    machine.handle(sample(1, "down", BODY_MAIN, 1000, "touch"));
    const moved = machine.handle(sample(1, "move", BODY_MAIN + 40, 1100, "touch"));
    // The wake-up has to be taken back, or the host's timer fires into a
    // gesture that is now a pan and the item jumps out from under the finger.
    expect(scheduleOf(moved)?.at).toBeNull();
    expect(startOf(moved)).toBeUndefined();
    expect(machine.phase).toBe("panning");
    // And the clock coming round later changes nothing.
    expect(machine.elapse(1_000_000)).toEqual([]);
  });

  it("takes back the wake-up when the finger lifts before the hold is due", () => {
    const machine = machineFor();
    machine.handle(sample(1, "down", BODY_MAIN, 1000, "touch"));
    const lifted = machine.handle(sample(1, "up", BODY_MAIN, 1100, "touch"));
    expect(scheduleOf(lifted)?.at).toBeNull();
    expect(machine.elapse(1_000_000)).toEqual([]);
  });

  it("promotes on a late move, so a replayed sequence reaches the same conclusion", () => {
    const machine = machineFor();
    machine.handle(sample(1, "down", BODY_MAIN, 1000, "touch"));
    // The host's timer would have woken the machine at 1500, so a move
    // stamped later than that cannot be a pan: a recorded session has to
    // decide the same way a live one did.
    const late = machine.handle(sample(1, "move", BODY_MAIN + 40, 1800, "touch"));
    expect(startOf(late)?.trigger).toBe("long-press");
    expect(machine.phase).toBe("editing");
  });

  it("holds for a pen the way it does for a mouse", () => {
    const machine = machineFor();
    const down = machine.handle(sample(1, "down", BODY_MAIN, 1000, "pen"));
    // A pen is aimed, not swiped: holding it would be the mouse's problem all
    // over again.
    expect(scheduleOf(down)).toBeUndefined();
    expect(startOf(machine.handle(sample(1, "move", BODY_MAIN + 24, 1020, "pen")))?.trigger).toBe(
      "pointer",
    );
  });
});

afterAll(() => {
  writeFileSync(".hybrid-trace.json", `${JSON.stringify(trace, null, 2)}\n`);
});
