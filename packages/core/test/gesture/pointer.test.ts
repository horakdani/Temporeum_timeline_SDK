import { describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { InputEffect, InputMachine, PointerKind, PointerSample } from "../../src/input.js";
import { createTimeScale } from "../../src/scale.js";
import type { Domain, Orientation } from "../../src/types.js";

/**
 * Synthetic pointer sequences — the gesture suite.
 *
 * These are the tests a browser cannot give cheaply and a browser-only suite
 * gives late: every one of them is a *sequence*, and a sequence is where
 * gesture bugs live. The machine takes its timestamps from the samples, so a
 * replay is exact; nothing here is timing-dependent and nothing is flaky.
 *
 * Each `it` below is one claim the gate's `proof` field makes. The meta-check
 * (`sdk_check_gesture.mjs`) reads this file's report and fails if any of those
 * claims is missing — a gesture suite that quietly stopped covering
 * `pointercancel` would otherwise still be green.
 */

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const SPAN = 30 * DAY;
const MAIN = 900;

function machine(overrides: Partial<Parameters<typeof createInputMachine>[0]> = {}): InputMachine {
  return createInputMachine({ domain: [START, START + SPAN], mainSize: MAIN, ...overrides });
}

function at(
  id: number,
  phase: PointerSample["phase"],
  x: number,
  y: number,
  time: number,
  pointerType: PointerKind = "touch",
): PointerSample {
  return { pointerId: id, phase, x, y, time, pointerType };
}

/** The instant under a main-axis offset, for the machine's current domain. */
function timeUnder(domain: Domain, main: number): number {
  return createTimeScale(domain, MAIN).toTime(main);
}

function kinds(effects: readonly InputEffect[]): readonly string[] {
  return effects.map((effect) => effect.type);
}

describe("gesture sequences", () => {
  it("pans with one pointer, and the instant it grabbed stays under it", () => {
    const input = machine();
    const grabbed = timeUnder(input.domain, 300);
    expect(kinds(input.handle(at(1, "down", 300, 40, 0)))).toEqual(["press"]);
    // Under the threshold: a press, not yet a drag.
    expect(input.handle(at(1, "move", 304, 40, 10))).toEqual([]);
    expect(input.phase).toBe("pressing");
    const started = input.handle(at(1, "move", 500, 40, 20));
    expect(kinds(started)).toEqual(["gestureStart", "viewport"]);
    expect(input.phase).toBe("panning");
    // The grabbed instant is under the finger, 200 px further along.
    expect(timeUnder(input.domain, 500)).toBeCloseTo(grabbed, 6);
    // The zoom did not change: a pan is a pan.
    expect(input.domain[1] - input.domain[0]).toBe(SPAN);
    expect(kinds(input.handle(at(1, "up", 500, 40, 30)))).toEqual(["gestureEnd"]);
    expect(input.phase).toBe("idle");
  });

  it("pinches with two pointers, and both instants stay under their fingers", () => {
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    const second = input.handle(at(2, "down", 500, 40, 10));
    expect(kinds(second)).toEqual(["gestureStart"]);
    expect(input.phase).toBe("pinching");
    const heldByFirst = timeUnder(input.domain, 300);
    const heldBySecond = timeUnder(input.domain, 500);
    // Spread the fingers: 200 px apart becomes 600 px apart.
    input.handle(at(1, "move", 150, 40, 20));
    const spread = input.handle(at(2, "move", 750, 40, 30));
    expect(kinds(spread)).toEqual(["viewport"]);
    expect(timeUnder(input.domain, 150)).toBeCloseTo(heldByFirst, 6);
    expect(timeUnder(input.domain, 750)).toBeCloseTo(heldBySecond, 6);
    // Three times the separation is three times the zoom.
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(SPAN / 3, 6);
  });

  it("ends the gesture on pointercancel and stops panning", () => {
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(1, "move", 500, 40, 10));
    const panned = input.domain;
    const cancelled = input.handle(at(1, "cancel", 500, 40, 20));
    expect(cancelled).toEqual([{ type: "gestureEnd", kind: "pan", cancelled: true }]);
    expect(input.phase).toBe("idle");
    expect(input.pointerCount).toBe(0);
    // A move after the cancel belongs to nobody: nothing may follow it.
    expect(input.handle(at(1, "move", 800, 40, 30))).toEqual([]);
    expect(input.domain).toEqual(panned);
    // And a cancelled press is not a tap.
    const second = machine();
    second.handle(at(1, "down", 300, 40, 0));
    expect(kinds(second.handle(at(1, "cancel", 300, 40, 10)))).toEqual([]);
  });

  it("moves nothing when lifting one finger during a pinch", () => {
    // The bug this phase exists to prevent. The surviving finger still holds
    // the instant it grabbed *before* the zoom, so a naive implementation
    // snaps the content the moment the other finger leaves the glass.
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(2, "down", 500, 40, 10));
    input.handle(at(1, "move", 200, 40, 20));
    input.handle(at(2, "move", 700, 40, 30));
    const beforeLift = input.domain;
    const lift = input.handle(at(2, "up", 700, 40, 40));
    expect(kinds(lift)).toEqual(["gestureEnd", "gestureStart"]);
    expect(input.domain).toEqual(beforeLift);
    expect(input.phase).toBe("panning");
    // And the drag continues from where the finger actually is.
    const heldNow = timeUnder(input.domain, 200);
    input.handle(at(1, "move", 400, 40, 50));
    expect(timeUnder(input.domain, 400)).toBeCloseTo(heldNow, 6);
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(beforeLift[1] - beforeLift[0], 6);
  });

  it("zooms in on a double tap, about the tapped point", () => {
    const input = machine();
    const tapped = timeUnder(input.domain, 240);
    input.handle(at(1, "down", 240, 40, 0));
    const first = input.handle(at(1, "up", 240, 40, 60));
    expect(first).toEqual([
      {
        type: "tap",
        main: 240,
        cross: 40,
        pointerType: "touch",
        tapCount: 1,
        pointerCount: 1,
        durationMs: 60,
      },
    ]);
    expect(input.domain[1] - input.domain[0]).toBe(SPAN);
    input.handle(at(1, "down", 243, 41, 160));
    const second = input.handle(at(1, "up", 243, 41, 200));
    expect(kinds(second)).toEqual(["tap", "viewport"]);
    expect(second[0]).toMatchObject({ tapCount: 2 });
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(SPAN / 2, 6);
    expect(timeUnder(input.domain, 243)).toBeCloseTo(timeUnder([START, START + SPAN], 243), 6);
    expect(tapped).toBeLessThan(timeUnder(input.domain, MAIN));
    // A third tap is a fresh first tap, not a triple.
    input.handle(at(1, "down", 243, 41, 300));
    expect(kinds(input.handle(at(1, "up", 243, 41, 340)))).toEqual(["tap"]);
    // Too slow, and too far, are both just taps.
    const slow = machine();
    slow.handle(at(1, "down", 240, 40, 0));
    slow.handle(at(1, "up", 240, 40, 10));
    slow.handle(at(1, "down", 240, 40, 900));
    expect(kinds(slow.handle(at(1, "up", 240, 40, 910)))).toEqual(["tap"]);
    slow.handle(at(1, "down", 600, 40, 950));
    expect(kinds(slow.handle(at(1, "up", 600, 40, 960)))).toEqual(["tap"]);
  });

  it("zooms out on a two-finger tap, about the point between the fingers", () => {
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(2, "down", 500, 40, 20));
    const lift = input.handle(at(2, "up", 500, 40, 60));
    expect(kinds(lift)).toEqual(["gestureEnd", "tap", "viewport"]);
    expect(lift[1]).toMatchObject({ pointerCount: 2, main: 400 });
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(SPAN * 2, 6);
    // The midpoint's instant did not move.
    expect(timeUnder(input.domain, 400)).toBeCloseTo(timeUnder([START, START + SPAN], 400), 6);
    // The finger still on the glass must not start a pan of its own.
    expect(input.phase).toBe("idle");
    expect(input.handle(at(1, "move", 100, 40, 80))).toEqual([]);
    expect(kinds(input.handle(at(1, "up", 100, 40, 100)))).toEqual([]);
    // Held too long, two fingers are a pinch that happened not to move.
    const held = machine();
    held.handle(at(1, "down", 300, 40, 0));
    held.handle(at(2, "down", 500, 40, 20));
    expect(kinds(held.handle(at(2, "up", 500, 40, 900)))).toEqual(["gestureEnd", "gestureStart"]);
  });

  it("holds the drag threshold, and a finger needs more travel than a mouse", () => {
    const finger = machine();
    finger.handle(at(1, "down", 300, 40, 0, "touch"));
    expect(finger.handle(at(1, "move", 306, 40, 10, "touch"))).toEqual([]);
    const mouse = machine();
    mouse.handle(at(1, "down", 300, 40, 0, "mouse"));
    expect(kinds(mouse.handle(at(1, "move", 306, 40, 10, "mouse")))).toEqual([
      "gestureStart",
      "viewport",
    ]);
    // A pen is precise too, and an override applies to every kind.
    const pen = machine({ dragThreshold: 40 });
    pen.handle(at(1, "down", 300, 40, 0, "pen"));
    expect(pen.handle(at(1, "move", 330, 40, 10, "pen"))).toEqual([]);
    expect(kinds(pen.handle(at(1, "move", 360, 40, 20, "pen")))).toEqual([
      "gestureStart",
      "viewport",
    ]);
    // Travel across the time axis counts: a vertical flick on a horizontal
    // timeline is still a drag, it just does not move time.
    const across = machine({ crossSize: 100, contentCrossSize: 400 });
    across.handle(at(1, "down", 300, 40, 0));
    expect(kinds(across.handle(at(1, "move", 300, 10, 10)))).toEqual([
      "gestureStart",
      "viewport",
    ]);
    expect(across.crossOffset).toBe(30);
    // And it stops dead at the first lane instead of drifting into nothing.
    across.handle(at(1, "move", 300, 100, 20));
    expect(across.crossOffset).toBe(0);
    expect(across.domain).toEqual([START, START + SPAN]);
  });

  it("zooms on ctrl+wheel and pans on a plain wheel", () => {
    const input = machine();
    const under = timeUnder(input.domain, 600);
    const zoomed = input.wheel({
      x: 600,
      y: 40,
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      shiftKey: false,
      time: 0,
    });
    // A used wheel step starts a wheel run: announced before the move,
    // and a wake-up for when it ends.
    expect(kinds(zoomed)).toEqual(["gestureStart", "viewport", "schedule"]);
    expect(zoomed[1]).toMatchObject({ reason: "zoom" });
    expect(input.domain[1] - input.domain[0]).toBeLessThan(SPAN);
    expect(timeUnder(input.domain, 600)).toBeCloseTo(under, 6);

    // A plain wheel on a horizontal timeline reports deltaY only, and with
    // nothing to scroll across the lanes it has to pan time or look broken.
    const flat = machine();
    const panned = flat.wheel({
      x: 600,
      y: 40,
      deltaX: 0,
      deltaY: 120,
      ctrlKey: false,
      shiftKey: false,
      time: 0,
    });
    expect(panned[1]).toMatchObject({ reason: "pan" });
    expect(flat.domain[0]).toBeGreaterThan(START);
    expect(flat.domain[1] - flat.domain[0]).toBe(SPAN);

    // With lanes to scroll, the same wheel scrolls them instead.
    const tall = machine({ crossSize: 200, contentCrossSize: 600 });
    tall.wheel({ x: 600, y: 40, deltaX: 0, deltaY: 120, ctrlKey: false, shiftKey: false, time: 0 });
    expect(tall.crossOffset).toBe(120);
    expect(tall.domain).toEqual([START, START + SPAN]);
    // Shift is the escape hatch: it always pans time.
    tall.wheel({ x: 600, y: 40, deltaX: 0, deltaY: 120, ctrlKey: false, shiftKey: true, time: 0 });
    expect(tall.crossOffset).toBe(120);
    expect(tall.domain[0]).toBeGreaterThan(START);
  });

  it("leaves a wheel the timeline could not use to the page", () => {
    // The host needs to know: if nothing moved, no effect comes out, and the
    // binding then does not call preventDefault, so the page scrolls.
    const pinned = machine({
      limits: { min: START, max: START + SPAN },
    });
    expect(
      pinned.wheel({ x: 10, y: 10, deltaX: 0, deltaY: -50, ctrlKey: false, shiftKey: false, time: 0 }),
    ).toEqual([]);
    const locked = machine({ zoom: false, pan: false });
    expect(
      locked.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 50, ctrlKey: true, shiftKey: false, time: 0 }),
    ).toEqual([]);
    expect(
      locked.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 50, ctrlKey: false, shiftKey: false, time: 0 }),
    ).toEqual([]);
    locked.handle(at(1, "down", 300, 40, 0));
    locked.handle(at(1, "move", 600, 40, 10));
    expect(locked.domain).toEqual([START, START + SPAN]);

    // And the desktop twin of the cooperative touch mode: `touch-action`
    // governs touch only, so a cooperative timeline that still swallowed the
    // wheel would trap an article's scroll under the mouse — the very bug the
    // mode exists to prevent, just with a different input device.
    const shared = machine({ touchAction: "cooperative" });
    expect(
      shared.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 90, ctrlKey: false, shiftKey: false, time: 0 }),
    ).toEqual([]);
    expect(shared.domain).toEqual([START, START + SPAN]);
    // Explicit intent still belongs to the widget: ctrl zooms, shift pans.
    // (The first used step starts a wheel run, the second continues it.)
    expect(
      kinds(shared.wheel({ x: 10, y: 10, deltaX: 0, deltaY: -90, ctrlKey: true, shiftKey: false, time: 10 })),
    ).toEqual(["gestureStart", "viewport", "schedule"]);
    expect(
      kinds(shared.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 90, ctrlKey: false, shiftKey: true, time: 20 })),
    ).toEqual(["viewport", "schedule"]);
    // And lanes that have somewhere to scroll are the widget's own content.
    const sharedTall = machine({ touchAction: "cooperative", crossSize: 100, contentCrossSize: 400 });
    sharedTall.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 60, ctrlKey: false, shiftKey: false, time: 0 });
    expect(sharedTall.crossOffset).toBe(60);
  });

  it("makes a run of wheel steps one gesture, which ends when the steps stop", () => {
    const input = machine();
    const step = (time: number, deltaY = -40): readonly InputEffect[] =>
      input.wheel({ x: 600, y: 40, deltaX: 0, deltaY, ctrlKey: true, shiftKey: false, time });
    const first = step(0);
    expect(kinds(first)).toEqual(["gestureStart", "viewport", "schedule"]);
    expect(first[0]).toMatchObject({ kind: "wheel", cancelled: false });
    expect(first[2]).toMatchObject({ at: 150, reason: "wheel" });
    // A step within the run: no second start, and the end moves.
    const second = step(50);
    expect(kinds(second)).toEqual(["viewport", "schedule"]);
    expect(second[1]).toMatchObject({ at: 200 });
    // Woken at the first end, which the second step moved: it goes on.
    expect(input.elapse(150)).toEqual([{ type: "schedule", at: 200, reason: "wheel" }]);
    // Woken at its end: it ends, once.
    expect(input.elapse(200)).toEqual([{ type: "gestureEnd", kind: "wheel", cancelled: false }]);
    expect(input.elapse(400)).toEqual([]);
    // The next step starts a new run.
    expect(kinds(step(500))[0]).toBe("gestureStart");
  });

  it("ends a wheel run at once when a pointer or a key takes over, and starts none for a wheel it leaves", () => {
    const input = machine();
    const wheel = (time: number): readonly InputEffect[] =>
      input.wheel({ x: 600, y: 40, deltaX: 0, deltaY: -40, ctrlKey: true, shiftKey: false, time });
    wheel(0);
    const down = input.handle(at(1, "down", 300, 40, 20));
    expect(down.filter((effect) => effect.type === "gestureEnd")).toEqual([{ type: "gestureEnd", kind: "wheel", cancelled: false }]);
    input.handle(at(1, "up", 300, 40, 30));
    // The wake-up the run had asked for finds nothing to end.
    expect(input.elapse(150)).toEqual([]);

    wheel(200);
    // A key that means nothing here leaves the run alone; one it takes ends it.
    expect(input.key({ key: "q", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 210 })).toEqual([]);
    const keyed = input.key({ key: "PageDown", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 220 });
    expect(kinds(keyed).slice(0, 2)).toEqual(["key", "gestureEnd"]);
    expect(keyed[1]).toMatchObject({ kind: "wheel" });

    // A wheel at a limit moves nothing: no run, no wake-up.
    const pinned = machine({ limits: { min: START, max: START + SPAN } });
    expect(pinned.wheel({ x: 10, y: 10, deltaX: 0, deltaY: -50, ctrlKey: false, shiftKey: false, time: 0 })).toEqual([]);
    expect(pinned.elapse(1000)).toEqual([]);
  });

  it("runs the same sequence identically in both orientations", () => {
    const sequences: Record<Orientation, Domain> = {
      horizontal: [START, START + SPAN],
      vertical: [START, START + SPAN],
    };
    const orientations: readonly Orientation[] = ["horizontal", "vertical"];
    for (const orientation of orientations) {
      const input = machine({ orientation });
      // The same gesture, expressed on whichever screen axis time runs along.
      const point = (main: number): { x: number; y: number } =>
        orientation === "horizontal" ? { x: main, y: 40 } : { x: 40, y: main };
      const first = point(300);
      const second = point(500);
      input.handle({ pointerId: 1, phase: "down", ...first, time: 0, pointerType: "touch" });
      input.handle({ pointerId: 2, phase: "down", ...second, time: 10, pointerType: "touch" });
      input.handle({ pointerId: 1, phase: "move", ...point(200), time: 20, pointerType: "touch" });
      input.handle({ pointerId: 2, phase: "move", ...point(700), time: 30, pointerType: "touch" });
      sequences[orientation] = input.domain;
    }
    expect(sequences.vertical).toEqual(sequences.horizontal);
  });

  it("keeps the gesture sane when a third finger joins and leaves", () => {
    const input = machine();
    input.handle(at(1, "down", 200, 40, 0));
    input.handle(at(2, "down", 400, 40, 10));
    // A third finger is tracked but does not drive: two points already fix
    // the whole transform, and a changing pair mid-gesture is a jump.
    expect(input.handle(at(3, "down", 800, 40, 20))).toEqual([]);
    expect(input.pointerCount).toBe(3);
    const before = input.domain;
    expect(input.handle(at(3, "move", 850, 40, 30))).toEqual([]);
    expect(input.domain).toEqual(before);
    expect(input.handle(at(3, "up", 850, 40, 40))).toEqual([]);
    expect(input.phase).toBe("pinching");
    input.handle(at(1, "move", 100, 40, 50));
    expect(input.domain).not.toEqual(before);
  });

  it("gives every gesture a programmatic twin", () => {
    // The keyboard checks need this: a capability only a finger can reach is a
    // capability a keyboard user does not have.
    const input = machine();
    const under = timeUnder(input.domain, 450);
    expect(kinds(input.zoom(2, 450))).toEqual(["viewport"]);
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(SPAN / 2, 6);
    expect(timeUnder(input.domain, 450)).toBeCloseTo(under, 6);
    const afterZoom = input.domain;
    expect(kinds(input.pan(90))).toEqual(["viewport"]);
    expect(input.domain[0]).toBeGreaterThan(afterZoom[0]);
    expect(input.pan(0)).toEqual([]);
  });
});
