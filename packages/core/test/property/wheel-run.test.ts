/**
 * A run of wheel steps is one gesture.
 *
 * A wheel has no lift. Without runs every notch would end where it began, so a host
 * that keeps a scene space while a gesture runs — the README's loop:
 * `settle: !gesture` — settled after every notch: it re-anchored, redrew the
 * view and started filling its overscan between two notches, and a 4.3x
 * ctrl+wheel zoom missed half its frames. The machine now opens a `wheel`
 * gesture with the first step that moves the view and closes it when
 * WHEEL_RUN_MS pass without another — through its own wake-ups, so a
 * recorded session replays the same.
 *
 * Generated sequences of wheel steps — some at a limit, so they move nothing
 * — with pointer presses and keys among them, at random gaps, are fed to the
 * machine the way the browser binding does: its single wake-up slot fires
 * before any later event. Against a model that knows only the times, this
 * checks that the run is open exactly while it should be, that every move a
 * wheel makes falls inside an open run, that starts and ends alternate, and
 * that a step which moved nothing opens nothing.
 *
 * The control: the same sequences read the way a host without the run would
 * see them — a step is a gesture of its own — must leave the host at rest
 * between two steps of one run in some case. Otherwise the property would
 * hold without the run and prove nothing about it.
 */

import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { createInputMachine } from "../../src/input.js";
import type { InputEffect, InputMachine } from "../../src/input.js";
import { forAll, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);
const SPAN = 30 * DAY;
const RUN_MS = 150;
const CASES = 600;

type Step =
  | { readonly kind: "wheel"; readonly time: number; readonly ctrl: boolean; readonly delta: number }
  | { readonly kind: "press"; readonly time: number }
  | { readonly kind: "key"; readonly time: number };

function generate(random: () => number): GeneratedCase<Step> {
  const steps: Step[] = [];
  let time = 0;
  const count = 1 + Math.floor(random() * 30);
  for (let index = 0; index < count; index += 1) {
    // Mostly notch-like gaps, some pauses across the run's end, a few long.
    const roll = random();
    time += roll < 0.6 ? 10 + random() * 80 : roll < 0.9 ? 120 + random() * 60 : 300 + random() * 500;
    const kind = random();
    if (kind < 0.82) {
      steps.push({ kind: "wheel", time, ctrl: random() < 0.6, delta: (random() < 0.5 ? -1 : 1) * (20 + random() * 120) });
    } else if (kind < 0.92) {
      steps.push({ kind: "press", time });
    } else {
      steps.push({ kind: "key", time });
    }
  }
  return { items: [], steps };
}

function freshMachine(): InputMachine {
  return createInputMachine({
    domain: [START, START + SPAN],
    mainSize: 1000,
    crossSize: 300,
    // A limit a little wider than the view: some steps reach it and move nothing.
    limits: { min: START - DAY, max: START + SPAN + DAY, minSpanMs: DAY, maxSpanMs: 40 * DAY },
  });
}

/** What the control measured, over every case. */
const control = { cases: 0, runsWithSeveralSteps: 0, restsInsideARun: 0, stillSteps: 0 };

function check(generated: GeneratedCase<Step>, record: boolean): string | undefined {
  const machine = freshMachine();
  const steps = generated.steps ?? [];
  let wake: number | null = null;
  let open: boolean = false;
  /** The model: the last step that moved the view, while a run lasts. */
  let lastMove: number | undefined;
  let stepsInRun = 0;
  let failure: string | undefined;

  const take = (effects: readonly InputEffect[], at: number, cause: string): void => {
    for (const effect of effects) {
      if (failure !== undefined) return;
      if (effect.type === "schedule") {
        wake = effect.at;
      } else if (effect.type === "gestureStart" && effect.kind === "wheel") {
        if (open) failure = `a second wheel start at ${at.toFixed(0)} (${cause})`;
        open = true;
      } else if (effect.type === "gestureEnd" && effect.kind === "wheel") {
        if (!open) failure = `a wheel end without a start at ${at.toFixed(0)} (${cause})`;
        open = false;
      } else if (effect.type === "viewport" && cause === "wheel" && !open) {
        failure = `a wheel moved the view at ${at.toFixed(0)} outside a run`;
      }
    }
  };

  const fireWakeUpsBefore = (time: number): void => {
    // The binding's one timer: it fires before any later event does.
    while (wake !== null && wake <= time && failure === undefined) {
      const due: number = wake;
      wake = null;
      take(machine.elapse(due), due, "wake-up");
      if (lastMove !== undefined && due >= lastMove + RUN_MS) {
        if (open) failure = `the run is still open at ${due.toFixed(0)}, ${String(RUN_MS)} ms after its last step`;
        if (record && stepsInRun > 1) control.runsWithSeveralSteps += 1;
        lastMove = undefined;
        stepsInRun = 0;
      }
    }
  };

  for (const step of steps) {
    fireWakeUpsBefore(step.time);
    if (failure !== undefined) return failure;
    if (lastMove !== undefined && step.time >= lastMove + RUN_MS) {
      return `no wake-up ended the run that was due at ${(lastMove + RUN_MS).toFixed(0)}`;
    }
    if (step.kind === "wheel") {
      const effects = machine.wheel({ x: 500, y: 40, deltaX: 0, deltaY: step.delta, ctrlKey: step.ctrl, shiftKey: !step.ctrl, time: step.time });
      const moved = effects.some((effect) => effect.type === "viewport");
      const wasOpen: boolean = open;
      take(effects, step.time, "wheel");
      if (failure !== undefined) return failure;
      if (!moved) {
        if (record) control.stillSteps += 1;
        if (open !== wasOpen) return `a step that moved nothing changed the run at ${step.time.toFixed(0)}`;
        continue;
      }
      if (record && lastMove !== undefined) control.restsInsideARun += 1;
      lastMove = step.time;
      stepsInRun += 1;
      if (!open) return `a step that moved the view left no run open at ${step.time.toFixed(0)}`;
    } else {
      const effects =
        step.kind === "press"
          ? [
              ...machine.handle({ pointerId: 1, phase: "down", x: 500, y: 40, time: step.time, pointerType: "mouse" }),
              ...machine.handle({ pointerId: 1, phase: "up", x: 500, y: 40, time: step.time + 1, pointerType: "mouse" }),
            ]
          : machine.key({ key: "PageDown", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: step.time });
      take(effects, step.time, step.kind);
      if (failure !== undefined) return failure;
      // A pointer always ends a run; a key does when the timeline took it.
      const ended = step.kind === "press" || effects.some((effect) => effect.type === "key");
      if (ended) {
        if (open) return `a ${step.kind} at ${step.time.toFixed(0)} left the wheel run open`;
        lastMove = undefined;
        stepsInRun = 0;
      }
    }
  }
  fireWakeUpsBefore(Number.POSITIVE_INFINITY);
  if (failure !== undefined) return failure;
  if (open) return "the run never ended";
  if (record) control.cases += 1;
  return undefined;
}

describe("a run of wheel steps", () => {
  it("is one gesture, open from the first step that moves the view until the steps stop", () => {
    forAll("a wheel run is one gesture", CASES, 0x77ee1, generate, (generated) => check(generated, false));
  });

  it("is what keeps a host in its gesture between notches (control)", () => {
    // The same seed and count: the very cases the property ran on. Without
    // the run, each of these steps would have been a gesture of its own,
    // and the host at rest between it and the step before.
    forAll("wheel run control cases", CASES, 0x77ee1, generate, (generated) => check(generated, true));
    expect(control.cases).toBe(CASES);
    expect(control.runsWithSeveralSteps).toBeGreaterThan(CASES / 4);
    expect(control.restsInsideARun).toBeGreaterThan(1000);
    // And the limits were reached: steps that moved nothing were among them.
    expect(control.stillSteps).toBeGreaterThan(100);
  });
});

afterAll(() => {
  writePropertyReport("wheel-run");
  writeFileSync(".wheel-run-control.json", `${JSON.stringify(control, null, 2)}\n`);
});
