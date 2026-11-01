/**
 * The keyboard reaches everything, and motion never changes where it lands.
 *
 * Two properties over generated layouts — every awkward case the generator
 * has: open intervals, tall items, instants, empty lanes, both orientations,
 * a container too short for its lanes:
 *
 * 1. **One key walks every item.** From `Home`, the next-item key visits each
 *    laid-out item exactly once, and after every step the focused item is
 *    shown — along time and across the lanes. `End` and the previous-item key
 *    walk the same order back. This is the screen-reader user's whole access
 *    to the timeline, so it is proved for every shape, not for a fixture.
 * 2. **A transition is only a path.** The same key sequence on a machine with
 *    motion and on one with reduced motion ends every step on the same view,
 *    once the transition has run out. Motion is presentation; if it changed
 *    the destination, reduced motion would be a different product.
 */

import { afterAll, describe, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { InputEffect, InputMachine } from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import type { KeySample } from "../../src/keyboard.js";
import { layoutItems } from "../../src/layout.js";
import type { Orientation } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 600;
const INSET = 28;

interface View {
  readonly orientation: Orientation;
  readonly domain: readonly [number, number];
  readonly mainSize: number;
  readonly crossSize: number;
  /** Keys pressed for the motion property. */
  readonly keys: readonly string[];
}

const KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "+", "-"];

function generate(random: () => number): GeneratedCase<View> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  return {
    ...base,
    steps: [
      {
        orientation: random() < 0.5 ? "horizontal" : "vertical",
        domain: [start, start + Math.floor(5 + random() * 120) * DAY],
        mainSize: 300 + Math.floor(random() * 900),
        crossSize: 60 + Math.floor(random() * 300),
        keys: Array.from({ length: 12 }, () => KEYS[Math.floor(random() * KEYS.length)] as string),
      },
    ],
  };
}

function press(machine: InputMachine, key: string, time: number): readonly InputEffect[] {
  const sample: KeySample = { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time };
  return machine.key(sample);
}

function machineFor(generated: GeneratedCase<View>, view: View, reducedMotion: boolean): { machine: InputMachine; layout: ReturnType<typeof layoutItems> } {
  const layout = layoutItems(generated.items, {
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    ...(generated.packMode === undefined ? {} : { packMode: generated.packMode }),
  });
  const machine = createInputMachine({
    domain: view.domain,
    mainSize: view.mainSize,
    crossSize: view.crossSize,
    contentCrossSize: layout.crossSize + INSET,
    orientation: view.orientation,
    keyboard: { navigator: createNavigator(layout, { crossInset: INSET }), reducedMotion },
  });
  return { machine, layout };
}

/** Let a transition run out, as the host's timer would. */
function settle(machine: InputMachine, effects: readonly InputEffect[]): void {
  let next = [...effects].reverse().find((effect) => effect.type === "schedule");
  for (let guard = 0; guard < 100 && next?.type === "schedule" && next.at !== null; guard += 1) {
    const step = machine.elapse(next.at);
    next = step.find((effect) => effect.type === "schedule");
  }
}

function walk(generated: GeneratedCase<View>): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const { machine, layout } = machineFor(generated, view, true);
  const ids = layout.items.map((placed) => placed.item.id);
  if (ids.length === 0) {
    return press(machine, "Home", 0).length === 0 ? undefined : "Home was taken with nothing to focus";
  }
  const byId = new Map(layout.items.map((placed) => [placed.item.id, placed]));
  const visited: string[] = [];
  press(machine, "Home", 0);
  for (let step = 0; step < ids.length; step += 1) {
    const id = machine.focusedId;
    if (id === null) {
      return "the walk lost the focus";
    }
    visited.push(id);
    const placed = byId.get(id);
    if (placed === undefined) {
      return `focused an item that is not laid out: ${id}`;
    }
    const [from, to] = machine.domain;
    const span = placed.span;
    const along = span.start <= to && span.end >= from && Math.min(span.end, to) - Math.max(span.start, from) >= Math.min(span.end - span.start, (to - from) * 0.1) - 1e-6;
    if (!along) {
      return `"${id}" is focused but not in view along time`;
    }
    const band = view.crossSize - INSET;
    const top = placed.cross - machine.crossOffset;
    const fits = placed.crossSize <= band;
    const across = fits ? top >= -1e-6 && top + placed.crossSize <= band + 1e-6 : top < band && top + placed.crossSize > 0;
    if (!across) {
      return `"${id}" is focused but scrolled out of the lanes (${view.orientation})`;
    }
    // The arrows follow the axes: time runs down a vertical timeline.
    press(machine, view.orientation === "horizontal" ? "ArrowRight" : "ArrowDown", 0);
  }
  if (new Set(visited).size !== ids.length || visited.length !== ids.length) {
    return `the walk visited ${String(new Set(visited).size)} of ${String(ids.length)} items`;
  }
  const back: string[] = [];
  press(machine, "End", 0);
  for (let step = 0; step < ids.length; step += 1) {
    back.push(machine.focusedId ?? "");
    press(machine, view.orientation === "horizontal" ? "ArrowLeft" : "ArrowUp", 0);
  }
  if (JSON.stringify(back) !== JSON.stringify([...visited].reverse())) {
    return "End and the previous-item key do not walk the same order back";
  }
  return undefined;
}

function sameDestination(generated: GeneratedCase<View>): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const still = machineFor(generated, view, true).machine;
  const moving = machineFor(generated, view, false).machine;
  let time = 0;
  for (const key of view.keys) {
    time += 1000;
    press(still, key, time);
    settle(moving, press(moving, key, time));
    const [a, b] = [still.domain, moving.domain];
    const tolerance = (a[1] - a[0]) * 1e-9;
    if (Math.abs(a[0] - b[0]) > tolerance || Math.abs(a[1] - b[1]) > tolerance || Math.abs(still.crossOffset - moving.crossOffset) > 1e-6) {
      return `after "${key}" the transition landed elsewhere than reduced motion`;
    }
    if (still.focusedId !== moving.focusedId) {
      return `after "${key}" motion changed which item has the focus`;
    }
  }
  return undefined;
}

describe("keyboard properties", () => {
  it("walks every item with one key, and keeps each in view", () => {
    forAll("one key walks every item", CASES, 0x6e7b0a, generate, walk);
  });

  it("lands every transition where reduced motion lands at once", () => {
    forAll("motion is only a path", CASES, 0x6e7b0b, generate, sameDestination);
  });
});

afterAll(() => {
  writePropertyReport("keyboard");
});
