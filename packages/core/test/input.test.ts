import { describe, expect, it } from "vitest";

import { createInputMachine } from "../src/input.js";
import type { InputEffect, InputMachine, PointerKind, PointerSample } from "../src/input.js";
import { createTimeScale } from "../src/scale.js";

/**
 * The input machine's API and its edges.
 *
 * The sequences live in `test/gesture/`, which the gate measures separately.
 * What is here is everything around them: the options that turn capabilities
 * off, the host-driven calls, and the awkward inputs a real host will send —
 * an event for a pointer that is already gone, a container that resized
 * mid-gesture, an orientation that flipped under a finger.
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

function kinds(effects: readonly InputEffect[]): readonly string[] {
  return effects.map((effect) => effect.type);
}

describe("the input machine's edges", () => {
  it("clamps the domain it is given, instead of trusting it", () => {
    const input = machine({
      domain: [START - 10 * DAY, START + 100 * DAY],
      limits: { min: START, max: START + 40 * DAY },
    });
    expect(input.domain[0]).toBeGreaterThanOrEqual(START);
    expect(input.domain[1]).toBeLessThanOrEqual(START + 40 * DAY);
  });

  it("ignores events for a pointer it never saw", () => {
    const input = machine();
    expect(input.handle(at(9, "move", 100, 10, 0))).toEqual([]);
    expect(input.handle(at(9, "up", 100, 10, 10))).toEqual([]);
    expect(input.handle(at(9, "cancel", 100, 10, 20))).toEqual([]);
    expect(input.pointerCount).toBe(0);
  });

  it("turns a running pan into a pinch when a second finger lands", () => {
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(1, "move", 500, 40, 10));
    expect(input.phase).toBe("panning");
    const second = input.handle(at(2, "down", 700, 40, 20));
    // The pan has to be closed before the pinch opens, or a host that pairs
    // start with end leaks a gesture.
    expect(second).toEqual([
      { type: "gestureEnd", kind: "pan", cancelled: false },
      { type: "gestureStart", kind: "pinch", cancelled: false },
    ]);
    expect(input.phase).toBe("pinching");
  });

  it("ends a pinch cleanly when the host resets mid-gesture", () => {
    // A host resets when the element is removed, or the page is hidden. The
    // fingers are gone as far as the library is concerned, and a gesture that
    // was open has to be closed.
    const input = machine();
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(2, "down", 500, 40, 10));
    expect(input.reset()).toEqual([{ type: "gestureEnd", kind: "pinch", cancelled: true }]);
    expect(input.pointerCount).toBe(0);
    expect(input.phase).toBe("idle");
    // And a reset with nothing running says nothing.
    expect(input.reset()).toEqual([]);
  });

  it("stops the lanes at the last one, not past it", () => {
    const input = machine({ crossSize: 100, contentCrossSize: 300 });
    input.handle(at(1, "down", 300, 400, 0));
    input.handle(at(1, "move", 300, 0, 10));
    // 400 px of drag, but only 200 px of content to scroll.
    expect(input.crossOffset).toBe(200);
    input.handle(at(1, "up", 300, 0, 20));
    // Nothing to scroll at all: the offset stays nailed to zero.
    const flat = machine({ crossSize: 300, contentCrossSize: 100 });
    flat.handle(at(1, "down", 300, 200, 0));
    flat.handle(at(1, "move", 300, 0, 10));
    expect(flat.crossOffset).toBe(0);
  });

  it("respects pan and zoom being turned off, gesture or not", () => {
    const noZoom = machine({ zoom: false });
    noZoom.handle(at(1, "down", 300, 40, 0));
    noZoom.handle(at(2, "down", 500, 40, 10));
    noZoom.handle(at(1, "move", 150, 40, 20));
    // Without zoom, a pinch is still a pan: the midpoint drags.
    expect(noZoom.domain[1] - noZoom.domain[0]).toBe(SPAN);
    expect(noZoom.domain[0]).not.toBe(START);
    expect(noZoom.zoom(2, 100)).toEqual([]);

    const noPan = machine({ pan: false });
    noPan.handle(at(1, "down", 300, 40, 0));
    noPan.handle(at(1, "move", 500, 40, 10));
    expect(noPan.domain).toEqual([START, START + SPAN]);
    expect(noPan.pan(100)).toEqual([]);
    // Fingers held across the time axis cannot scale, and with pan off there
    // is nothing left for the gesture to do. (Fresh fingers: the one above
    // has already been dragged, and a pinch re-grabs from where they are.)
    const across = machine({ pan: false });
    across.handle(at(1, "down", 300, 40, 0));
    across.handle(at(2, "down", 310, 100, 10));
    across.handle(at(2, "move", 305, 160, 20));
    expect(across.domain).toEqual([START, START + SPAN]);

    const frozen = machine({ zoom: false, pan: false });
    frozen.handle(at(1, "down", 300, 40, 0));
    frozen.handle(at(1, "up", 300, 40, 40));
    frozen.handle(at(1, "down", 300, 40, 100));
    // The tap still comes out — the host may want it for selection — but the
    // view does not move.
    expect(kinds(frozen.handle(at(1, "up", 300, 40, 140)))).toEqual(["tap"]);
    expect(frozen.domain).toEqual([START, START + SPAN]);
    frozen.handle(at(1, "down", 300, 40, 200));
    frozen.handle(at(2, "down", 500, 40, 210));
    expect(kinds(frozen.handle(at(2, "up", 500, 40, 240)))).toEqual(["gestureEnd", "tap"]);
    expect(frozen.domain).toEqual([START, START + SPAN]);
  });

  it("keeps a pinch sane when the fingers end up on top of each other", () => {
    const input = machine({ minPinchSeparation: 100 });
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(2, "down", 600, 40, 10));
    // 300 px apart becomes 200: still over the floor, so this one scales —
    // the fingers came together, so the window widens.
    input.handle(at(1, "move", 400, 40, 20));
    const afterScaling = input.domain;
    expect(afterScaling[1] - afterScaling[0]).toBeCloseTo((SPAN * 300) / 200, 6);
    // Now 20 px apart, well under the floor: the zoom freezes and the
    // midpoint keeps panning. Dividing by that separation would otherwise
    // blow the span up by a factor of ten.
    input.handle(at(2, "move", 420, 40, 30));
    expect(input.domain[1] - input.domain[0]).toBeCloseTo(afterScaling[1] - afterScaling[0], 6);
    expect(input.domain[0]).not.toBe(afterScaling[0]);
    expect(Number.isFinite(input.domain[0])).toBe(true);
    // Fingers crossing over each other is the same refusal: the sign flips.
    const crossed = machine();
    crossed.handle(at(1, "down", 300, 40, 0));
    crossed.handle(at(2, "down", 500, 40, 10));
    crossed.handle(at(1, "move", 700, 40, 20));
    crossed.handle(at(2, "move", 200, 40, 30));
    expect(crossed.domain[1] - crossed.domain[0]).toBeCloseTo(SPAN, 6);
  });

  it("takes a new domain from the host without emitting anything", () => {
    const input = machine();
    input.setDomain([START + DAY, START + 3 * DAY]);
    expect(input.domain).toEqual([START + DAY, START + 3 * DAY]);
    // Mid-gesture, the host's own change has to re-seat the finger, or the
    // next move drags the content back to where the finger started.
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(1, "move", 400, 40, 10));
    input.setDomain([START + 10 * DAY, START + 12 * DAY]);
    const held = createTimeScale(input.domain, MAIN).toTime(400);
    input.handle(at(1, "move", 600, 40, 20));
    expect(createTimeScale(input.domain, MAIN).toTime(600)).toBeCloseTo(held, 6);
  });

  it("survives the container resizing and the orientation flipping mid-gesture", () => {
    const input = machine({ crossSize: 200, contentCrossSize: 1000 });
    input.handle(at(1, "down", 300, 40, 0));
    input.handle(at(1, "move", 300, 0, 10));
    expect(input.crossOffset).toBe(40);
    // The container grew: there is less to scroll, so the offset comes back.
    input.resize({ crossSize: 980 });
    expect(input.crossOffset).toBe(20);
    input.resize({ mainSize: 400, contentCrossSize: 100 });
    expect(input.crossOffset).toBe(0);
    // A resize with nothing in it changes nothing.
    const before = input.domain;
    input.resize({});
    expect(input.domain).toEqual(before);
    // And the finger keeps its instant across an orientation flip, which is
    // what a responsive host does on rotation.
    // A flip swaps which screen axis the finger's position is read from, so
    // the gesture inevitably jumps once. What must not break is the anchor:
    // the instant the finger holds stays the instant under the finger.
    input.setOrientation("vertical");
    const held = createTimeScale(input.domain, 400).toTime(300);
    input.handle(at(1, "move", 40, 0, 20));
    expect(createTimeScale(input.domain, 400).toTime(0)).toBeCloseTo(held, 6);
  });

  it("reports when the limits cut a gesture short", () => {
    const input = machine({
      domain: [START + DAY, START + DAY + SPAN],
      limits: { min: START, max: START + DAY + SPAN },
    });
    input.handle(at(1, "down", 300, 40, 0));
    // Ten days of drag with one day of room: it goes as far as it can and
    // says so, which is what a host needs to show the end of the data.
    const effects = input.handle(at(1, "move", 600, 40, 10));
    const viewport = effects.find((effect) => effect.type === "viewport");
    expect(viewport).toMatchObject({ atLimit: true, reason: "pan" });
    expect(input.domain).toEqual([START, START + SPAN]);
    // Dragging further is not an error, it just does nothing — and emits
    // nothing, so a host does not re-render a frame per event at the end.
    expect(input.handle(at(1, "move", 700, 40, 20))).toEqual([]);
  });
});
