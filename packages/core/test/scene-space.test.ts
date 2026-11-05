import { describe, expect, it } from "vitest";

import { DEFAULT_GROWTH, DEFAULT_OVERSCAN, planSceneSpace } from "../src/scene-space.js";
import type { SceneSpace, SceneSpaceView } from "../src/scene-space.js";

/**
 * The scene-space plan: when the stable space a frame is drawn in is kept,
 * when it is re-anchored, and how far past the viewport it is drawn.
 * Orientation-free on purpose — it reasons in time and main-axis pixels
 * only; the geometry it leads to is checked in both orientations in
 * `geometry/culling.test.ts`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);

/** Frames at rest until the overscan is full: the plan stops changing. */
function grown(space: SceneSpace, view: SceneSpaceView): SceneSpace {
  let current = space;
  for (let frame = 0; frame < 100; frame += 1) {
    const next = planSceneSpace(current, view, { settle: true });
    if (next === current) {
      return current;
    }
    current = next;
  }
  throw new Error("the overscan never filled");
}

function covers(space: SceneSpace, view: SceneSpaceView): boolean {
  const extent = space.extent;
  return (
    extent !== undefined &&
    extent[0] <= Number(view.domain[0]) &&
    extent[1] >= Number(view.domain[1])
  );
}

describe("planSceneSpace", () => {
  const domain: readonly [number, number] = [T0, T0 + 10 * DAY];
  const view = { domain, mainSize: 1000 };
  const msPerPx = (10 * DAY) / 1000;

  it("anchors a first space at the viewport, drawing the viewport only", () => {
    expect(planSceneSpace(undefined, view)).toEqual({
      origin: T0,
      msPerPx,
      extent: domain,
      atRest: false,
    });
    expect(planSceneSpace(undefined, view, { settle: true }).atRest).toBe(true);
  });

  it("keeps the same object while a gesture stays inside what is drawn", () => {
    const space = planSceneSpace(undefined, view);
    expect(planSceneSpace(space, view)).toBe(space);
  });

  it("during a gesture reaches as far as the viewport, and never further", () => {
    const space = planSceneSpace(undefined, view);
    const panned = { domain: [T0 + DAY, T0 + 11 * DAY] as const, mainSize: 1000 };
    const next = planSceneSpace(space, panned);
    expect(next.origin).toBe(space.origin);
    expect(next.msPerPx).toBe(space.msPerPx);
    // What was drawn stays; the strip that came in is added; nothing ahead.
    expect(next.extent).toEqual([T0, T0 + 11 * DAY]);
  });

  it("at rest grows into the overscan a step per frame, from the frame after settling", () => {
    let space = planSceneSpace(undefined, view, { settle: true });
    // The frame that settles drew the viewport; the next one starts growing.
    const extents: (readonly [number, number] | undefined)[] = [];
    for (let frame = 0; frame < 40; frame += 1) {
      const next = planSceneSpace(space, view, { settle: true });
      if (next === space) {
        break;
      }
      space = next;
      extents.push(space.extent);
    }
    // A sixteenth of a viewport a frame — one tile — on one side: the one
    // with more still to draw, the later one on a tie. Once it was a
    // quarter on both sides at once, and that frame, at 2000 items in view,
    // was the one an ending wheel run missed; then an eighth, the tile of
    // the time, still a frame the wheel run missed when the machine was busy.
    // One viewport each side: thirty-two frames.
    expect(DEFAULT_GROWTH).toBe(0.0625);
    expect(extents.slice(0, 4)).toEqual([
      [T0, T0 + 10.625 * DAY],
      [T0 - 0.625 * DAY, T0 + 10.625 * DAY],
      [T0 - 0.625 * DAY, T0 + 11.25 * DAY],
      [T0 - 1.25 * DAY, T0 + 11.25 * DAY],
    ]);
    expect(extents).toHaveLength(32);
    expect(extents.at(-1)).toEqual([T0 - 10 * DAY, T0 + 20 * DAY]);
    // Every frame adds one strip, never two.
    extents.forEach((extent, frame) => {
      const before = frame === 0 ? domain : (extents[frame - 1] as readonly [number, number]);
      const added = before[0] - (extent?.[0] ?? 0) + ((extent?.[1] ?? 0) - before[1]);
      expect(added).toBeCloseTo(0.625 * DAY, 0);
    });
    // Done: the same object, which is how a host knows to stop drawing.
    expect(planSceneSpace(space, view, { settle: true })).toBe(space);
    expect(DEFAULT_OVERSCAN).toBe(1);
  });

  it("does not grow during a gesture, even with room to grow", () => {
    const space = planSceneSpace(undefined, view, { settle: true });
    expect(planSceneSpace(space, view).extent).toEqual(domain);
  });

  it("trims what lies beyond the overscan, and always covers the viewport", () => {
    const space = grown(planSceneSpace(undefined, view, { settle: true }), view);
    // A pan of one and a half viewports during a gesture: the trailing side
    // is trimmed to the overscan, the leading side reaches the viewport.
    const near = { domain: [T0 + 15 * DAY, T0 + 25 * DAY] as const, mainSize: 1000 };
    expect(planSceneSpace(space, near).extent).toEqual([T0 + 5 * DAY, T0 + 25 * DAY]);
    // A jump of three viewports: nothing drawn is near, so only the viewport.
    const far = { domain: [T0 + 30 * DAY, T0 + 40 * DAY] as const, mainSize: 1000 };
    const next = planSceneSpace(space, far);
    expect(next.extent).toEqual([T0 + 30 * DAY, T0 + 40 * DAY]);
    // A random walk of pans and zooms: never an uncovered viewport.
    let random = 7;
    const rand = (): number => {
      random = (random * 48_271) % 2_147_483_647;
      return random / 2_147_483_647;
    };
    let current = next;
    let start = T0 + 30 * DAY;
    let span = 10 * DAY;
    for (let step = 0; step < 500; step += 1) {
      start += (rand() - 0.5) * span;
      span *= 0.8 + rand() * 0.4;
      const stepView = { domain: [start, start + span] as const, mainSize: 1000 };
      current = planSceneSpace(current, stepView, { settle: rand() < 0.3 });
      expect(covers(current, stepView)).toBe(true);
      const extent = current.extent as readonly [number, number];
      expect(extent[0]).toBeGreaterThanOrEqual(start - span * DEFAULT_OVERSCAN - 1e-6);
      expect(extent[1]).toBeLessThanOrEqual(start + span + span * DEFAULT_OVERSCAN + 1e-6);
    }
  });

  it("re-anchors past the stretch limit, in both directions, drawing the viewport only", () => {
    const space = planSceneSpace(undefined, view);
    const inward = planSceneSpace(space, { domain: [T0, T0 + 6 * DAY], mainSize: 1000 });
    expect(inward.msPerPx).toBeCloseTo((6 * DAY) / 1000);
    expect(inward.extent).toEqual([T0, T0 + 6 * DAY]);
    const outward = planSceneSpace(space, { domain: [T0, T0 + 16 * DAY], mainSize: 1000 });
    expect(outward.msPerPx).toBeCloseTo((16 * DAY) / 1000);
    expect(outward.extent).toEqual([T0, T0 + 16 * DAY]);
    // Inside the limit the scale holds, and the extent reaches the viewport.
    const held = planSceneSpace(space, { domain: [T0, T0 + 14 * DAY], mainSize: 1000 });
    expect(held.msPerPx).toBe(space.msPerPx);
    expect(held.origin).toBe(space.origin);
    expect(held.extent).toEqual([T0, T0 + 14 * DAY]);
  });

  it("with levels, steps a gesture's scale by a power of two around the same origin, keeping what is drawn", () => {
    // A space at rest that has grown some overscan, then a gesture starts.
    const rest = grown(planSceneSpace(undefined, view, { settle: true }), view);
    expect(rest.extent?.[0]).toBeLessThan(T0);
    const space = planSceneSpace(rest, view, { levels: true });
    expect(space.budget).toBe(2);
    // In past the limit: half the scale, the origin kept, what is drawn kept.
    const inward = planSceneSpace(space, { domain: [T0 + 2 * DAY, T0 + 8 * DAY], mainSize: 1000 }, { levels: true });
    expect(inward.origin).toBe(space.origin);
    expect(inward.msPerPx).toBe(space.msPerPx / 2);
    // Kept, trimmed to the new viewport's overscan: one viewport each side.
    expect(inward.extent).toEqual([T0 + 2 * DAY - 6 * DAY, T0 + 8 * DAY + 6 * DAY]);
    expect(inward.extent?.[0]).toBeGreaterThanOrEqual(space.extent?.[0] ?? Number.NaN);
    expect(inward.budget).toBe(2);
    // Out, squeezed down to half before it steps: at 1.6x out it holds.
    const squeezed = planSceneSpace(space, { domain: [T0, T0 + 16 * DAY], mainSize: 1000 }, { levels: true });
    expect(squeezed.msPerPx).toBe(space.msPerPx);
    // Past half: twice the scale; a far zoom takes as many steps as it needs.
    const outward = planSceneSpace(space, { domain: [T0, T0 + 25 * DAY], mainSize: 1000 }, { levels: true });
    expect(outward.msPerPx).toBe(space.msPerPx * 2);
    expect(outward.origin).toBe(space.origin);
    const far = planSceneSpace(space, { domain: [T0, T0 + 50 * DAY], mainSize: 1000 }, { levels: true });
    expect(far.msPerPx).toBe(space.msPerPx * 4);
    // A step lands on a scale not coarser than the screen's, and within half
    // of it: what it draws has at least the room the screen shows.
    for (const [next, days] of [[inward, 6], [outward, 25], [far, 50]] as const) {
      const left = next.msPerPx / ((days * DAY) / 1000);
      expect(left).toBeLessThanOrEqual(1);
      expect(left).toBeGreaterThan(0.5);
    }
  });

  // Until 1.0.0-rc.4 a step set `bare` itself, and the labels of what it
  // drew blinked out until the gesture ended. Since rc.5 only a host does.
  it("with levels, never draws bare by itself; a host's bare lasts until the gesture comes to rest", () => {
    const space = planSceneSpace(undefined, view, { levels: true });
    expect(space.bare).toBeUndefined();
    const stepped = planSceneSpace(space, { domain: [T0 + 2 * DAY, T0 + 8 * DAY], mainSize: 1000 }, { levels: true });
    expect(stepped.msPerPx).toBe(space.msPerPx / 2);
    expect(stepped.bare).toBeUndefined();
    // A host that asks for it keeps it through the gesture, a pan included...
    const asked = planSceneSpace({ ...space, bare: true }, { domain: [T0 + 2 * DAY, T0 + 8 * DAY], mainSize: 1000 }, { levels: true });
    expect(asked.bare).toBe(true);
    const onward = planSceneSpace(asked, { domain: [T0 + 2.5 * DAY, T0 + 8.5 * DAY], mainSize: 1000 }, { levels: true });
    expect(onward.bare).toBe(true);
    // ...and at rest the frame is exact, labels and all.
    expect(planSceneSpace(onward, { domain: [T0 + 2.5 * DAY, T0 + 8.5 * DAY], mainSize: 1000 }, { levels: true, settle: true }).bare).toBeUndefined();
  });

  it("with levels, anchors at the viewport when a step cannot do — at rest, too far out, or a tight limit", () => {
    const space = planSceneSpace(undefined, view, { levels: true });
    const zoomed = { domain: [T0, T0 + 6 * DAY] as const, mainSize: 1000 };
    // At rest: exact, and nothing to pace.
    expect(planSceneSpace(space, zoomed, { levels: true, settle: true })).toEqual({
      origin: T0,
      msPerPx: (6 * DAY) / 1000,
      extent: [T0, T0 + 6 * DAY],
      atRest: true,
    });
    // Without levels a tight limit anchors at the viewport; with them a step
    // always finds a scale within half of the screen's, so it steps.
    const tight = planSceneSpace(space, { domain: [T0, T0 + 8 * DAY], mainSize: 1000 }, { maxStretch: 1.2 });
    expect(tight.msPerPx).toBeCloseTo((8 * DAY) / 1000);
    expect(tight.extent).toEqual([T0, T0 + 8 * DAY]);
    expect(planSceneSpace(space, { domain: [T0, T0 + 8 * DAY], mainSize: 1000 }, { levels: true, maxStretch: 1.2 }).msPerPx).toBe(space.msPerPx / 2);
    // The origin would end up too many pixels away at the stepped scale.
    const away = planSceneSpace(space, { domain: [T0 + 900 * DAY, T0 + 906 * DAY], mainSize: 1000 }, { levels: true });
    expect(away.origin).toBe(T0 + 900 * DAY);
    expect(away.msPerPx).toBeCloseTo((6 * DAY) / 1000);
    expect(() => planSceneSpace(space, zoomed, { levels: true, budget: 0 })).toThrow(RangeError);
    expect(planSceneSpace(space, zoomed, { levels: true, budget: 3 }).budget).toBe(3);
  });

  // R97: the numbers of a real wheel zoom (bench:wheel, 1.2x a notch, 8 in
  // and 8 out) at its last notch: the space squeezed to half, the view back
  // at its first scale but 2.5e-14 off it. The step out compared the stretch
  // with a half exactly and did not happen, and at rest the space was
  // anchored at the viewport — every node rewritten in one frame, 2 missed
  // vsyncs of the perf-wheel check — although its first scale is a level.
  it("with levels, takes a scale a hair off a level for the level — stepping out in the gesture, settling on it at rest", () => {
    const back = { domain: [1_796_160_960_000.001, 1_825_096_320_000.0002] as const, mainSize: 1440 };
    const squeezed: SceneSpace = {
      origin: 1_796_160_960_000,
      msPerPx: 10_047_000,
      extent: [1_796_160_960_000.001, 1_825_096_320_000.0002],
      atRest: false,
      budget: 2,
      rest: 20_094_000,
    };
    expect(squeezed.msPerPx / ((back.domain[1] - back.domain[0]) / back.mainSize)).not.toBe(0.5);
    const stepped = planSceneSpace(squeezed, back, { levels: true });
    expect(stepped.msPerPx).toBe(20_094_000);
    expect(stepped.origin).toBe(squeezed.origin);
    expect(stepped.budget).toBe(2);
    // At rest from the squeezed space: on the level, around the same origin.
    expect(planSceneSpace(squeezed, back, { levels: true, settle: true })).toEqual({
      origin: 1_796_160_960_000,
      msPerPx: 20_094_000,
      extent: [1_796_160_960_000.001, 1_825_096_320_000.0002],
      atRest: true,
    });
    // And the stepped one, at rest, is kept: there is no stretch left.
    const settled = planSceneSpace(stepped, back, { levels: true, settle: true });
    expect(settled.origin).toBe(stepped.origin);
    expect(settled.msPerPx).toBe(20_094_000);
    // Without levels there is no level to settle on: exact, at the viewport.
    expect(planSceneSpace(squeezed, back, { settle: true }).origin).toBe(back.domain[0]);
    // A whole power of two in, at rest, settles on its level as well.
    const space = planSceneSpace(undefined, view, { levels: true });
    expect(planSceneSpace(space, { domain: [T0 + 2.5 * DAY, T0 + 7.5 * DAY], mainSize: 1000 }, { levels: true, settle: true })).toEqual({
      origin: T0,
      msPerPx: msPerPx / 2,
      extent: [T0 + 2.5 * DAY, T0 + 7.5 * DAY],
      atRest: true,
    });
  });

  it("re-anchors a long pan without changing the scale", () => {
    const space = planSceneSpace(undefined, view);
    const far = planSceneSpace(space, { domain: [T0 + 2000 * DAY, T0 + 2010 * DAY], mainSize: 1000 });
    expect(far.origin).toBe(T0 + 2000 * DAY);
    expect(far.msPerPx).toBe(space.msPerPx);
    expect(far.extent).toEqual([T0 + 2000 * DAY, T0 + 2010 * DAY]);
  });

  it("settles a stretched space exactly, and keeps a merely shifted one", () => {
    const space = planSceneSpace(undefined, view);
    const zoomed = { domain: [T0, T0 + 12 * DAY] as const, mainSize: 1000 };
    expect(planSceneSpace(space, zoomed).msPerPx).toBe(space.msPerPx);
    expect(planSceneSpace(space, zoomed, { settle: true })).toEqual({
      origin: T0,
      msPerPx: (12 * DAY) / 1000,
      extent: [T0, T0 + 12 * DAY],
      atRest: true,
    });
    const panned = { domain: [T0 + DAY, T0 + 11 * DAY] as const, mainSize: 1000 };
    const settled = planSceneSpace(space, panned, { settle: true });
    expect(settled.origin).toBe(space.origin);
    expect(settled.msPerPx).toBe(space.msPerPx);
    expect(settled.atRest).toBe(true);
  });

  it("marks the frame at rest, and the frame of a gesture not", () => {
    const space = planSceneSpace(undefined, view);
    const resting = planSceneSpace(space, view, { settle: true });
    expect(resting.atRest).toBe(true);
    expect(resting.extent).toEqual(space.extent);
    expect(planSceneSpace(resting, view).atRest).toBe(false);
  });

  it("keeps what it has when there is nothing to draw", () => {
    const space = planSceneSpace(undefined, view);
    expect(planSceneSpace(space, { domain, mainSize: 0 })).toBe(space);
    expect(planSceneSpace(undefined, { domain: [T0, T0], mainSize: 100 })).toEqual({
      origin: T0,
      msPerPx: 1,
      extent: [T0, T0],
      atRest: false,
    });
  });

  it("refuses limits that cannot work", () => {
    expect(() => planSceneSpace(undefined, view, { maxStretch: 0.5 })).toThrow(RangeError);
    expect(() => planSceneSpace(undefined, view, { maxShift: 0 })).toThrow(RangeError);
    expect(() => planSceneSpace(undefined, view, { overscan: -1 })).toThrow(RangeError);
    expect(() => planSceneSpace(undefined, view, { overscan: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => planSceneSpace(undefined, view, { growth: 0 })).toThrow(RangeError);
  });
});
