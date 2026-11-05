import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { PointerKind, PointerSample } from "../../src/input.js";
import { createTimeScale } from "../../src/scale.js";
import type { Domain } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

/**
 * The anchor suite: after a gesture, the instant under the focus is still
 * under the focus.
 *
 * This is the one measurement that decides whether zooming *feels* right.
 * Every library gets the arithmetic approximately right and the approximation
 * is what users feel as drift: the content creeping away from the fingers
 * over a long pinch, or the view sliding when you zoom with the cursor
 * parked on a date.
 *
 * So it is measured in pixels, with a tight tolerance, over generated
 * sequences — and the gate checks the tolerance as well as the result,
 * because a test that asserts "within 50 px" passes while the feel is ruined.
 */

/** The error the anchor is allowed, in CSS pixels. Half a hair. */
const TOLERANCE_PX = 0.01;
const CASES = 400;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const YEAR = 365 * 24 * HOUR;

interface ScenarioReport {
  readonly scenario: string;
  readonly cases: number;
  readonly seed: number;
  readonly tolerancePx: number;
  readonly maxErrorPx: number;
  /** Cases the limits legitimately clamped, where no anchor claim applies. */
  readonly skipped: number;
  readonly spanRatioMin: number;
  readonly spanRatioMax: number;
  readonly travelPxMax: number;
  readonly passed: boolean;
}

const reports: ScenarioReport[] = [];

/** A plausible viewport: a sane window somewhere in living memory. */
function randomView(random: () => number): { domain: Domain; mainSize: number } {
  const start = Date.UTC(1990, 0, 1) + Math.floor(random() * 70 * YEAR);
  const span = HOUR + Math.floor(random() * 10 * YEAR);
  return { domain: [start, start + span], mainSize: 320 + Math.floor(random() * 1280) };
}

function sampleAt(
  id: number,
  phase: PointerSample["phase"],
  main: number,
  time: number,
  pointerType: PointerKind = "touch",
): PointerSample {
  return { pointerId: id, phase, x: main, y: 40, time, pointerType };
}

/**
 * Run one scenario and record what it measured.
 *
 * `measure` returns the anchor error in pixels for one generated case, or
 * `undefined` when the case is outside the claim (the span hit a bound, so
 * the anchor could not be honoured and the library says so by clamping).
 */
function scenario(
  name: string,
  seed: number,
  measure: (random: () => number, note: (spanRatio: number, travelPx: number) => void) =>
    | number
    | undefined,
): void {
  const random = makeRandom(seed);
  let maxError = 0;
  let skipped = 0;
  let spanRatioMin = Number.POSITIVE_INFINITY;
  let spanRatioMax = 0;
  let travelPxMax = 0;
  for (let index = 0; index < CASES; index += 1) {
    const error = measure(random, (spanRatio, travelPx) => {
      spanRatioMin = Math.min(spanRatioMin, spanRatio);
      spanRatioMax = Math.max(spanRatioMax, spanRatio);
      travelPxMax = Math.max(travelPxMax, travelPx);
    });
    if (error === undefined) {
      skipped += 1;
      continue;
    }
    maxError = Math.max(maxError, error);
  }
  const passed = maxError <= TOLERANCE_PX;
  reports.push({
    scenario: name,
    cases: CASES,
    seed,
    tolerancePx: TOLERANCE_PX,
    maxErrorPx: maxError,
    skipped,
    spanRatioMin: Number.isFinite(spanRatioMin) ? spanRatioMin : 1,
    spanRatioMax,
    travelPxMax,
    passed,
  });
  expect(maxError, `${name}: worst anchor error in pixels`).toBeLessThanOrEqual(TOLERANCE_PX);
}

/** Where an instant sits now, in main-axis pixels. */
function mainOf(domain: Domain, mainSize: number, time: number): number {
  return createTimeScale(domain, mainSize).toMain(time);
}

function spanOf(domain: Domain): number {
  return domain[1] - domain[0];
}

describe("zoom anchoring", () => {
  it("keeps both pinched instants under their own finger", () => {
    scenario("pinch", 0xa11c0, (random, note) => {
      const view = randomView(random);
      const input = createInputMachine({ domain: view.domain, mainSize: view.mainSize });
      const first = 20 + random() * (view.mainSize - 120);
      const second = first + 60 + random() * (view.mainSize - first - 80);
      input.handle(sampleAt(1, "down", first, 0));
      input.handle(sampleAt(2, "down", second, 5));
      const anchorA = createTimeScale(view.domain, view.mainSize).toTime(first);
      const anchorB = createTimeScale(view.domain, view.mainSize).toTime(second);
      // Move both fingers somewhere else, keeping them apart enough to scale.
      const movedFirst = 10 + random() * (view.mainSize - 60);
      const movedSecond = movedFirst + 40 + random() * (view.mainSize - movedFirst - 30);
      input.handle(sampleAt(1, "move", movedFirst, 10));
      input.handle(sampleAt(2, "move", movedSecond, 15));
      const ratio = spanOf(input.domain) / spanOf(view.domain);
      note(ratio, Math.abs(movedSecond - second));
      if (spanOf(input.domain) <= 1 || ratio > 1e6) {
        return undefined;
      }
      return Math.max(
        Math.abs(mainOf(input.domain, view.mainSize, anchorA) - movedFirst),
        Math.abs(mainOf(input.domain, view.mainSize, anchorB) - movedSecond),
      );
    });
  });

  it("keeps the dragged instant under the finger", () => {
    scenario("pan", 0xd7a6, (random, note) => {
      const view = randomView(random);
      const input = createInputMachine({ domain: view.domain, mainSize: view.mainSize });
      const grabAt = random() * view.mainSize;
      const anchor = createTimeScale(view.domain, view.mainSize).toTime(grabAt);
      input.handle(sampleAt(1, "down", grabAt, 0));
      // A real drag is many moves, and drift accumulates across them.
      let last = grabAt;
      for (let step = 0; step < 8; step += 1) {
        last = random() * view.mainSize;
        input.handle(sampleAt(1, "move", last, 10 + step * 10));
      }
      note(spanOf(input.domain) / spanOf(view.domain), Math.abs(last - grabAt));
      return Math.abs(mainOf(input.domain, view.mainSize, anchor) - last);
    });
  });

  it("keeps the tapped instant under the tap when a double tap zooms in", () => {
    scenario("double tap", 0xdb1e, (random, note) => {
      const view = randomView(random);
      const input = createInputMachine({ domain: view.domain, mainSize: view.mainSize });
      const tapAt = random() * view.mainSize;
      const anchor = createTimeScale(view.domain, view.mainSize).toTime(tapAt);
      input.handle(sampleAt(1, "down", tapAt, 0));
      input.handle(sampleAt(1, "up", tapAt, 40));
      input.handle(sampleAt(1, "down", tapAt, 120));
      input.handle(sampleAt(1, "up", tapAt, 160));
      note(spanOf(input.domain) / spanOf(view.domain), view.mainSize / 2);
      if (spanOf(input.domain) <= 1) {
        return undefined;
      }
      return Math.abs(mainOf(input.domain, view.mainSize, anchor) - tapAt);
    });
  });

  it("keeps the instant between two fingers under them when a two-finger tap zooms out", () => {
    scenario("two-finger tap", 0x2f7a, (random, note) => {
      const view = randomView(random);
      const input = createInputMachine({ domain: view.domain, mainSize: view.mainSize });
      const first = random() * view.mainSize;
      const second = random() * view.mainSize;
      const midpoint = (first + second) / 2;
      const anchor = createTimeScale(view.domain, view.mainSize).toTime(midpoint);
      input.handle(sampleAt(1, "down", first, 0));
      input.handle(sampleAt(2, "down", second, 20));
      input.handle(sampleAt(2, "up", second, 60));
      note(spanOf(input.domain) / spanOf(view.domain), Math.abs(second - first));
      return Math.abs(mainOf(input.domain, view.mainSize, anchor) - midpoint);
    });
  });

  it("keeps the instant under the cursor through a ctrl+wheel zoom", () => {
    scenario("ctrl+wheel", 0x3bee, (random, note) => {
      const view = randomView(random);
      const input = createInputMachine({ domain: view.domain, mainSize: view.mainSize });
      const cursor = random() * view.mainSize;
      const anchor = createTimeScale(view.domain, view.mainSize).toTime(cursor);
      // A trackpad pinch is a burst of small wheel events, not one big one:
      // this is where drift shows up if the anchor is recomputed sloppily.
      for (let step = 0; step < 12; step += 1) {
        input.wheel({
          x: cursor,
          y: 40,
          deltaX: 0,
          deltaY: (random() - 0.5) * 240,
          ctrlKey: true,
          shiftKey: false,
          time: step * 16,
        });
      }
      note(spanOf(input.domain) / spanOf(view.domain), view.mainSize);
      if (spanOf(input.domain) <= 1) {
        return undefined;
      }
      return Math.abs(mainOf(input.domain, view.mainSize, anchor) - cursor);
    });
  });

  it("keeps the instant under the cursor when the span limits stop the zoom", () => {
    // R3: the zoom was computed with the unclamped span and the limits then
    // fixed the span from the start, so every step at the limit slid the view
    // further — [0h, 2h] with a one-hour floor ended near 3.7h..4.7h.
    const mainSize = 1000;
    const cursor = 990;
    const wheelAt = (deltaY: number, step: number) => ({
      x: cursor,
      y: 40,
      deltaX: 0,
      deltaY,
      ctrlKey: true,
      shiftKey: false,
      time: step * 16,
    });
    const zoomIn = createInputMachine({ domain: [0, 2 * HOUR], mainSize, limits: { minSpanMs: HOUR } });
    const zoomOut = createInputMachine({ domain: [0, 2 * HOUR], mainSize, limits: { maxSpanMs: 3 * HOUR } });
    const anchor = createTimeScale([0, 2 * HOUR], mainSize).toTime(cursor);
    for (let step = 0; step < 10; step += 1) {
      zoomIn.wheel(wheelAt(-240, step));
      zoomOut.wheel(wheelAt(240, step));
    }
    expect(spanOf(zoomIn.domain)).toBe(HOUR);
    expect(spanOf(zoomOut.domain)).toBe(3 * HOUR);
    expect(Math.abs(mainOf(zoomIn.domain, mainSize, anchor) - cursor)).toBeLessThan(TOLERANCE_PX);
    expect(Math.abs(mainOf(zoomOut.domain, mainSize, anchor) - cursor)).toBeLessThan(TOLERANCE_PX);

    // The programmatic zoom and the double tap go through the same step.
    const method = createInputMachine({ domain: [0, 2 * HOUR], mainSize, limits: { minSpanMs: HOUR } });
    for (let step = 0; step < 10; step += 1) method.zoom(4, cursor);
    expect(Math.abs(mainOf(method.domain, mainSize, anchor) - cursor)).toBeLessThan(TOLERANCE_PX);
  });

  it("reports an anchor that drifts", () => {
    // The guard on the guard. If the measurement could not fail, every
    // scenario above would be decoration.
    const view = { domain: [0, 1000] as Domain, mainSize: 100 };
    const drifted: Domain = [10, 1010];
    expect(Math.abs(mainOf(drifted, view.mainSize, 500) - 50)).toBeGreaterThan(TOLERANCE_PX);
  });

  afterAll(() => {
    writeFileSync(".zoom-anchor-report.json", `${JSON.stringify(reports, null, 2)}\n`);
  });
});
