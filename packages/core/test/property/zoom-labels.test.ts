/**
 * A label shown before a zoom and after it is shown on every frame of it.
 *
 * The loop is the README's: a scene space planned with `levels`, re-anchored
 * a power of two at a time while the old scale stands in, a frame drawn for
 * every step and again while `pendingTiles` says the refill is not done,
 * and the frame at rest drawn until the plan stops changing — the overscan
 * grown, every tile in. Before and after are those frames at rest; in
 * between, every frame the host would show.
 *
 * Why only zooms in one direction: every label lives in room that is its
 * item's own — inside it, or after it up to whatever is next in its rows,
 * and every item is reserved — so whether an item gets a label depends on
 * its own room alone. In a zoom that only goes in, or only out, about a
 * fixed instant, that room grows or shrinks steadily, or grows and then
 * shrinks where the view's edge clips it; either way it is never smaller in
 * between than at both ends. A zoom that goes in and back out can pass
 * through a scale where the label does not fit, and then the right thing is
 * to give it up.
 *
 * Not covered: a `maxLabels` ceiling, which tiles hold a share of during a
 * gesture, and clusters, which group differently at every scale.
 *
 * The control: the same gestures drawn the way 1.0.0-rc.4 drew them — new
 * tiles bare from the first frame of the gesture, nothing pinned to the
 * edge (`bare: true` on every frame of it). They must lose a label that is
 * there before and after: otherwise the property would hold without the
 * change, and prove nothing about it.
 */

import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { containerExtents } from "../../src/geometry.js";
import { LABEL_ELLIPSIS } from "../../src/labels.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions, RenderResult } from "../../src/render.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { Density, Item, Orientation } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 500;
const ORIENTATIONS: readonly Orientation[] = ["horizontal", "vertical"];
const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];
/** Frames a host draws at rest before a plan settles; far more than an overscan takes. */
const SETTLE_FRAMES = 200;

interface Gesture {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly domain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** Where along the view the zoom holds still, 0 to 1. */
  readonly about: number;
  /** In (more than 1) or out (less than 1), per step. */
  readonly steps: readonly number[];
  readonly labels: readonly string[];
}

function generate(random: () => number): GeneratedCase<Gesture> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  // Unique texts, some long enough to be shortened, so a label names its item.
  const labels = base.items.map((_, index) => `L${String(index)}${"x".repeat(Math.floor(random() * 16))}`);
  const zoomIn = random() < 0.5;
  const count = 3 + Math.floor(random() * 14);
  const steps = Array.from({ length: count }, () => {
    const factor = 1.05 + random() * 0.3;
    return zoomIn ? factor : 1 / factor;
  });
  const gesture: Gesture = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    domain: [start, start + Math.floor(5 + random() * 120) * DAY],
    width: 300 + Math.floor(random() * 900),
    height: 200 + Math.floor(random() * 500),
    about: random(),
    steps,
    labels,
  };
  return { ...base, steps: [gesture] };
}

/** Ids of the labels on screen: their box, through the layer's transform, meets the viewport. */
function onScreen(result: RenderResult, space: SceneSpace | undefined, domain: readonly [number, number], mainSize: number): Map<string, string> {
  const msPerPx = (domain[1] - domain[0]) / mainSize;
  const stretch = space === undefined ? 1 : space.msPerPx / msPerPx;
  const shift = space === undefined ? 0 : (space.origin - domain[0]) / msPerPx;
  const shown = new Map<string, string>();
  for (const label of result.labels.kept) {
    const main = stretch * label.box.main + shift;
    if (main < mainSize && main + stretch * label.box.mainSize > 0) {
      shown.set(label.id, label.text);
    }
  }
  return shown;
}

const control = { cases: 0, labelsBeforeAndAfter: 0, gestureFrames: 0, lostByOld: 0, casesLostByOld: 0 };

function check(generated: GeneratedCase<Gesture>, legacy: boolean): string | undefined {
  const gesture = generated.steps?.[0];
  if (gesture === undefined) {
    return undefined;
  }
  const items: Item[] = generated.items.map((item, index) => ({ ...item, label: gesture.labels[index] ?? "" }));
  const { mainSize } = containerExtents(gesture.width, gesture.height, gesture.orientation);
  const options = (domain: readonly [number, number], space: SceneSpace): RenderOptions => ({
    items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain,
    width: gesture.width,
    height: gesture.height,
    orientation: gesture.orientation,
    density: gesture.density,
    space,
  });
  const view = (domain: readonly [number, number]): { readonly domain: readonly [number, number]; readonly mainSize: number } => ({ domain, mainSize });

  /** Draw at rest until the plan settles; the last frame is the one the reader sees. */
  const settle = (start: SceneSpace | undefined, domain: readonly [number, number]): { space: SceneSpace; result: RenderResult } | undefined => {
    let space = planSceneSpace(start, view(domain), { settle: true, levels: true });
    let result = renderTimeline(options(domain, space));
    for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
      const next = planSceneSpace(space, view(domain), { settle: true, levels: true });
      if (next === space && result.pendingTiles === 0) {
        return { space, result };
      }
      space = next;
      result = renderTimeline(options(domain, space));
    }
    return undefined;
  };

  const before = settle(undefined, gesture.domain);
  if (before === undefined) {
    return "the frame at rest before the gesture never settled";
  }
  // The gesture: each step zooms about the same instant.
  const anchor = gesture.domain[0] + (gesture.domain[1] - gesture.domain[0]) * gesture.about;
  let domain = gesture.domain;
  let space = before.space;
  const frames: { readonly shown: Map<string, string>; readonly at: number }[] = [];
  for (const factor of gesture.steps) {
    domain = [anchor - (anchor - domain[0]) / factor, anchor + (domain[1] - anchor) / factor];
    space = planSceneSpace(space, view(domain), { levels: true });
    if (legacy) {
      space = { ...space, bare: true };
    }
    let result = renderTimeline(options(domain, space));
    frames.push({ shown: onScreen(result, space, domain, mainSize), at: frames.length });
    // The host asks for another frame while the refill is not done.
    for (let more = 0; more < 64 && result.pendingTiles > 0; more += 1) {
      result = renderTimeline(options(domain, space));
      frames.push({ shown: onScreen(result, space, domain, mainSize), at: frames.length });
    }
  }
  const after = settle(space, domain);
  if (after === undefined) {
    return "the frame at rest after the gesture never settled";
  }
  const shownBefore = onScreen(before.result, before.space, gesture.domain, mainSize);
  const shownAfter = onScreen(after.result, after.space, domain, mainSize);
  let both = 0;
  let lost = 0;
  for (const [id, text] of shownBefore) {
    if (!shownAfter.has(id)) {
      continue;
    }
    both += 1;
    const full = items.find((item) => item.id === id)?.label ?? "";
    for (const frame of frames) {
      const drawn = frame.shown.get(id);
      if (drawn === undefined) {
        if (legacy) {
          lost += 1;
          break;
        }
        return `label "${id}" ("${text}") is on screen before and after the zoom, and missing on gesture frame ${String(frame.at)} of ${String(frames.length)} (${gesture.orientation}, ${gesture.steps[0] !== undefined && gesture.steps[0] > 1 ? "in" : "out"})`;
      }
      // What is drawn is the item's text, whole or shortened.
      if (drawn !== full && !(drawn.endsWith(LABEL_ELLIPSIS) && full.startsWith(drawn.slice(0, -LABEL_ELLIPSIS.length).trimEnd()))) {
        return `label "${id}" shows "${drawn}" on gesture frame ${String(frame.at)}, which is not its text "${full}"`;
      }
    }
  }
  if (legacy) {
    control.cases += 1;
    control.labelsBeforeAndAfter += both;
    control.gestureFrames += frames.length;
    control.lostByOld += lost;
    control.casesLostByOld += lost > 0 ? 1 : 0;
  }
  return undefined;
}

describe("labels during a zoom", () => {
  it("shows on every frame of a zoom each label shown before it and after it", () => {
    forAll("zoom keeps the labels on both ends", CASES, 0x200b1, generate, (generated) => check(generated, false));
  });

  it("needs the change: the same zooms drawn as 1.0.0-rc.4 did lose such labels (control)", () => {
    // The same seed and count: the very cases the property ran on.
    forAll("zoom labels control cases", CASES, 0x200b1, generate, (generated) => check(generated, true));
    expect(control.labelsBeforeAndAfter).toBeGreaterThan(1000);
    expect(control.lostByOld).toBeGreaterThan(0);
  });
});

afterAll(() => {
  writePropertyReport("zoom-labels");
  writeFileSync(".zoom-labels-control.json", `${JSON.stringify(control, null, 2)}\n`);
});
