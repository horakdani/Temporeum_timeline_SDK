import { describe, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { createHitTester } from "../../src/editing.js";
import type { HitTester } from "../../src/editing.js";
import { projectPoint, unprojectPoint } from "../../src/geometry.js";
import { createInputMachine } from "../../src/input.js";
import type { InputEffect, PointerSample } from "../../src/input.js";
import { layoutItems } from "../../src/layout.js";
import type { LayoutItem } from "../../src/layout.js";
import {
  DENSE_MIN_TARGET,
  HIT_SLOP_COARSE,
  HIT_SLOP_FINE,
  hitSlopFor,
  slopForExtent,
} from "../../src/responsive.js";
import { createTimeScale } from "../../src/scale.js";
import type { Density, Domain, Item, Lane, Orientation, PointerKind } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

/**
 * The hitslop check: the target a pointer gets comes from the pointer.
 *
 * One slop number is too blunt (`api_terv` §8.6). A mouse aims to the pixel,
 * and a 12-pixel zone would make it grab neighbours; a finger covers about
 * forty pixels of glass, and a 4-pixel zone makes a 2-pixel instant
 * unreachable. The engine therefore grows each target by the pointer's own
 * slop, and at the `dense` level up to the 24-pixel minimum of WCAG 2.2.
 *
 * Every claim is measured from the *screen*: points are written as pixels in
 * the container, projected through the orientation, and handed over the way
 * a browser binding would. A zone built in `(main, cross)` space is correct in
 * both orientations or in neither, and the suite runs both to tell.
 *
 * And every "reaches" claim has a "does not reach" twin. A suite that only
 * shows the finger hitting would pass with an infinite slop, which is a
 * timeline where every press grabs something.
 */

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const DOMAIN: Domain = [START, START + 30 * DAY];
const MAIN_SIZE = 600;
const LANES: readonly Lane[] = [{ id: "l1" }, { id: "l2" }];

function items(): Item[] {
  return [
    // A true instant: one millisecond, drawn at the level's minimum extent.
    { id: "moment", start: START + 15 * DAY, laneId: "l1" },
    { id: "left", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "l2" },
    // Half a day — ten pixels — after `left`: closer than a finger's slop.
    { id: "right", start: START + 6.5 * DAY, end: START + 11 * DAY, laneId: "l2" },
    { id: "wide", start: START + 18 * DAY, end: START + 28 * DAY, laneId: "l2" },
  ];
}

interface Frame {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly tester: HitTester;
  readonly axisSize: number;
  readonly minItemMainSize: number;
  readonly placed: (id: string) => LayoutItem;
  readonly mainOf: (time: number) => number;
  /** Container-relative screen point for `(main, cross)` in content space. */
  readonly screen: (main: number, contentCross: number) => { x: number; y: number };
  readonly hit: (
    screen: { x: number; y: number },
    pointerType?: PointerKind,
  ) => ReturnType<HitTester["hitTest"]>;
}

function frameFor(orientation: Orientation, density: Density): Frame {
  const metrics = densityMetrics(density, orientation);
  const layout = layoutItems(items(), {
    lanes: LANES,
    metrics: { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap },
  });
  const scale = createTimeScale(DOMAIN, MAIN_SIZE);
  const tester = createHitTester({
    layout,
    scale,
    crossInset: metrics.axisSize,
    minItemMainSize: metrics.minItemMainSize,
    density,
  });
  const screen = (main: number, contentCross: number) =>
    projectPoint({ main, cross: contentCross + metrics.axisSize }, orientation);
  return {
    orientation,
    density,
    tester,
    axisSize: metrics.axisSize,
    minItemMainSize: metrics.minItemMainSize,
    placed: (id) => {
      const found = layout.items.find((candidate) => candidate.item.id === id);
      if (found === undefined) {
        throw new Error(`no item ${id}`);
      }
      return found;
    },
    mainOf: (time) => scale.toMain(time),
    screen,
    hit: (point, pointerType) => tester.hitTest(unprojectPoint(point, orientation), pointerType),
  };
}

/** The middle of an item across its row. */
function midCross(placed: LayoutItem): number {
  return placed.cross + placed.crossSize / 2;
}

describeBothOrientations("the target a pointer gets", (orientation) => {
  describe("a 2 px item", () => {
    const frame = frameFor(orientation, "compact");
    const moment = frame.placed("moment");
    const edge = frame.mainOf(START + 15 * DAY);

    it("is drawn 2 px long, so the claim is about a real 2 px target", () => {
      expect(frame.minItemMainSize).toBe(2);
      // The span is one millisecond: everything visible is the minimum extent.
      expect(frame.mainOf(moment.span.end) - frame.mainOf(moment.span.start)).toBeLessThan(0.01);
    });

    it("a finger reaches a 2 px item it misses by 10 px along time", () => {
      const point = frame.screen(edge + frame.minItemMainSize + 10, midCross(moment));
      expect(frame.hit(point, "touch")?.item.id).toBe("moment");
      expect(frame.hit({ ...point }, "touch")?.part).toBe("body");
    });

    it("a finger reaches a 2 px item it misses by 10 px across the lanes", () => {
      const point = frame.screen(edge + 1, moment.cross - 10);
      expect(frame.hit(point, "touch")?.item.id).toBe("moment");
    });

    it("a mouse does not reach the same item from 10 px — the zone is the pointer's", () => {
      const point = frame.screen(edge + frame.minItemMainSize + 10, midCross(moment));
      expect(frame.hit(point, "mouse")).toBeUndefined();
      expect(frame.hit(point, "pen")).toBeUndefined();
    });

    it("a mouse reaches it from 3 px, a finger not from 13 px", () => {
      const near = frame.screen(edge + frame.minItemMainSize + HIT_SLOP_FINE - 1, midCross(moment));
      expect(frame.hit(near, "mouse")?.item.id).toBe("moment");
      const far = frame.screen(
        edge + frame.minItemMainSize + HIT_SLOP_COARSE + 1,
        midCross(moment),
      );
      expect(frame.hit(far, "touch")).toBeUndefined();
    });

    it("without a pointer type the geometry is exact", () => {
      const point = frame.screen(edge + frame.minItemMainSize + 1, midCross(moment));
      expect(frame.hit(point)).toBeUndefined();
      expect(frame.hit(frame.screen(edge + 1, midCross(moment)))?.item.id).toBe("moment");
    });
  });

  describe("the dense level", () => {
    const frame = frameFor(orientation, "dense");
    const moment = frame.placed("moment");
    const edge = frame.mainOf(START + 15 * DAY);
    const reach = (DENSE_MIN_TARGET - frame.minItemMainSize) / 2;

    it("without a pointer type even dense stays exact", () => {
      // The dense minimum is for a pointer the library knows is aiming. A
      // host's own programmatic hit test asks about a point, not a finger.
      const point = frame.screen(edge + frame.minItemMainSize + 1, midCross(moment));
      expect(frame.hit(point, "mouse")?.item.id).toBe("moment");
      expect(frame.hit(point)).toBeUndefined();
    });

    it("dense raises even a mouse's target to 24 px", () => {
      expect(reach).toBeGreaterThan(HIT_SLOP_FINE);
      const inside = frame.screen(edge + frame.minItemMainSize + reach - 0.5, midCross(moment));
      expect(frame.hit(inside, "mouse")?.item.id).toBe("moment");
      const before = frame.screen(edge - reach + 0.5, midCross(moment));
      expect(frame.hit(before, "mouse")?.item.id).toBe("moment");
      const outside = frame.screen(edge + frame.minItemMainSize + reach + 0.5, midCross(moment));
      expect(frame.hit(outside, "mouse")).toBeUndefined();
    });

    it("dense turns resizing off: the edge of a wide item is body", () => {
      const wide = frame.placed("wide");
      const start = frame.mainOf(START + 18 * DAY);
      const end = frame.mainOf(START + 28 * DAY);
      expect(frame.hit(frame.screen(start + 2, midCross(wide)), "mouse")?.part).toBe("body");
      expect(frame.hit(frame.screen(end - 2, midCross(wide)), "mouse")?.part).toBe("body");
      // The same aim at comfortable is a handle, so the claim is not vacuous.
      const roomy = frameFor(orientation, "comfortable");
      const roomyWide = roomy.placed("wide");
      expect(roomy.hit(roomy.screen(start + 2, midCross(roomyWide)), "mouse")?.part).toBe("start");
      expect(roomy.hit(roomy.screen(end - 2, midCross(roomyWide)), "mouse")?.part).toBe("end");
    });
  });

  describe("a larger zone does not steal", () => {
    const frame = frameFor(orientation, "comfortable");
    const left = frame.placed("left");
    const leftEnd = frame.mainOf(START + 6 * DAY);
    const rightStart = frame.mainOf(START + 6.5 * DAY);

    it("an exact hit wins over a slop hit on a neighbour", () => {
      // One pixel inside `left`, well within a finger's slop of `right`.
      const point = frame.screen(leftEnd - 1, midCross(left));
      expect(rightStart - (leftEnd - 1)).toBeLessThan(HIT_SLOP_COARSE);
      expect(frame.hit(point, "touch")?.item.id).toBe("left");
    });

    it("in the gap between two items the nearest one wins", () => {
      const nearRight = frame.screen(rightStart - 3, midCross(left));
      expect(frame.hit(nearRight, "touch")?.item.id).toBe("right");
      const nearLeft = frame.screen(leftEnd + 3, midCross(left));
      expect(frame.hit(nearLeft, "touch")?.item.id).toBe("left");
    });

    it("a slop hit is the body, never a handle", () => {
      const wide = frame.placed("wide");
      const start = frame.mainOf(START + 18 * DAY);
      // Exactly on the first pixels it is the start handle...
      expect(frame.hit(frame.screen(start + 2, midCross(wide)), "touch")?.part).toBe("start");
      // ...but a finger landing just before the item grows the target, not
      // the handle: otherwise a pan that starts there would resize instead.
      const before = frame.hit(frame.screen(start - 6, midCross(wide)), "touch");
      expect(before?.item.id).toBe("wide");
      expect(before?.part).toBe("body");
    });
  });

  describe("through the input machine", () => {
    const frame = frameFor(orientation, "dense");
    const moment = frame.placed("moment");
    const edge = frame.mainOf(START + 15 * DAY);
    const screen = frame.screen(edge + frame.minItemMainSize + 12, midCross(moment));

    function machineFor() {
      const seen: (PointerKind | undefined)[] = [];
      const machine = createInputMachine({
        domain: DOMAIN,
        mainSize: MAIN_SIZE,
        crossSize: 300,
        orientation,
        editing: {
          enabled: true,
          longPressMs: 400,
          hitTest: (point, pointerType) => {
            seen.push(pointerType);
            return frame.tester.hitTest(point, pointerType);
          },
          lookup: frame.tester.lookup,
        },
      });
      return { machine, seen };
    }

    function press(pointerType: PointerKind, time: number): PointerSample {
      return { pointerId: 1, phase: "down", x: screen.x, y: screen.y, time, pointerType };
    }

    const starts = (effects: readonly InputEffect[]) =>
      effects.filter((effect) => effect.type === "editStart");

    it("a finger long press picks up the 2 px item from 12 px away", () => {
      const { machine, seen } = machineFor();
      const down = machine.handle(press("touch", 1000));
      // The press is armed: the machine asks to be woken for the long press.
      expect(down.some((effect) => effect.type === "schedule" && effect.at === 1400)).toBe(true);
      const woken = machine.elapse(1400);
      expect(starts(woken)).toHaveLength(1);
      // The pipeline carried the pointer type to the hit test; without it the
      // zone would be exact and nothing would have been picked up.
      expect(seen).toEqual(["touch"]);
    });

    it("a mouse press at the same pixel picks up nothing", () => {
      const { machine, seen } = machineFor();
      const down = machine.handle(press("mouse", 1000));
      expect(down.some((effect) => effect.type === "schedule")).toBe(false);
      const moved = machine.handle({
        ...press("mouse", 1010),
        phase: "move",
        x: screen.x + 20,
        y: screen.y + 20,
      });
      expect(starts(moved)).toHaveLength(0);
      expect(seen).toEqual(["mouse"]);
    });
  });
});

describe("the slop numbers", () => {
  it("are 4 px for a precise pointer, 12 px for a finger, none for an unknown one", () => {
    expect(hitSlopFor("mouse")).toBe(4);
    expect(hitSlopFor("pen")).toBe(4);
    expect(hitSlopFor("touch")).toBe(12);
    expect(hitSlopFor(undefined)).toBe(0);
  });

  it("dense reaches the 24 px minimum target in each axis, and never shrinks a zone", () => {
    expect(DENSE_MIN_TARGET).toBe(24);
    for (const extent of [0, 2, 10, 24, 40]) {
      for (const base of [4, 12]) {
        const slop = slopForExtent(base, extent, "dense");
        expect(extent + 2 * slop).toBeGreaterThanOrEqual(DENSE_MIN_TARGET);
        expect(slop).toBeGreaterThanOrEqual(base);
        expect(slopForExtent(base, extent, "compact")).toBe(base);
      }
    }
  });
});
