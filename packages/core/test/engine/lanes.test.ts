/** Items and lanes that do not line up. */
import { describe, expect, it } from "vitest";

import { createHitTester } from "../../src/editing.js";
import { createInputMachine } from "../../src/input.js";
import type { EditMoveEffect, InputEffect } from "../../src/input.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { Domain, Item, Lane } from "../../src/types.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const DOMAIN: Domain = [START, START + 30 * DAY];
const LANES: readonly Lane[] = [{ id: "plan" }, { id: "build" }];
const ITEMS: readonly Item[] = [
  { id: "declared", start: START + 2 * DAY, end: START + 5 * DAY, laneId: "plan" },
  { id: "unknown-lane", start: START + 3 * DAY, end: START + 6 * DAY, laneId: "nowhere" },
  { id: "no-lane", start: START + 8 * DAY, end: START + 9 * DAY },
];

describe("items outside the declared lanes", () => {
  it("are laid out in a default lane after the declared ones", () => {
    const layout = layoutItems(ITEMS, { lanes: LANES });
    expect(layout.items.map((placed) => placed.item.id).sort()).toEqual(["declared", "no-lane", "unknown-lane"]);
    expect(layout.lanes.map((lane) => lane.lane.id)).toEqual(["plan", "build", ""]);
    const fallback = layout.lanes[2];
    for (const id of ["no-lane", "unknown-lane"]) {
      const placed = layout.items.find((candidate) => candidate.item.id === id);
      expect(placed?.laneId).toBe("");
      expect(placed?.cross).toBeGreaterThanOrEqual(fallback?.cross ?? Number.NaN);
    }
    // Apart in time, so the two share one row.
    expect(fallback?.sublaneCount).toBe(1);
  });

  it("are drawn", () => {
    const { scene } = renderTimeline({ items: ITEMS, lanes: LANES, domain: DOMAIN, width: 900, height: 300 });
    const ids: string[] = [];
    const walk = (node: typeof scene): void => {
      const id = node.attrs?.["data-tl-id"];
      if (typeof id === "string") {
        ids.push(id);
      }
      for (const child of node.children ?? []) {
        if (typeof child !== "string") {
          walk(child);
        }
      }
    };
    walk(scene);
    expect(ids).toEqual(expect.arrayContaining(["declared", "unknown-lane", "no-lane"]));
  });

  it("adds no lane when every item has a declared one", () => {
    const layout = layoutItems([ITEMS[0] as Item], { lanes: LANES });
    expect(layout.lanes.map((lane) => lane.lane.id)).toEqual(["plan", "build"]);
  });
});

describe("a drag released between lanes or past the last one", () => {
  const items: readonly Item[] = [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "plan" },
    { id: "b", start: START + 4 * DAY, end: START + 8 * DAY, laneId: "build" },
  ];
  const layout = layoutItems(items, { lanes: LANES, metrics: { laneGap: 12 } });
  const scale = createTimeScale(DOMAIN, 600);
  const machine = (): ReturnType<typeof createInputMachine> =>
    createInputMachine({
      domain: DOMAIN,
      mainSize: 600,
      crossSize: 400,
      editing: { enabled: true, crossLane: true, ...createHitTester({ layout, scale }) },
    });
  const crossOf = (id: string): number => {
    const placed = layout.items.find((candidate) => candidate.item.id === id);
    return (placed?.cross ?? 0) + (placed?.crossSize ?? 0) / 2;
  };
  const lastMove = (effects: readonly InputEffect[]): EditMoveEffect | undefined =>
    effects.filter((effect): effect is EditMoveEffect => effect.type === "editMove").at(-1);
  const sample = (phase: "down" | "move" | "up", x: number, y: number, time: number) =>
    ({ pointerId: 1, phase, x, y, time, pointerType: "mouse" }) as const;

  it("keeps the lane it was last over", () => {
    const m = machine();
    const main = scale.toMain(START + 3 * DAY);
    const plan = layout.lanes[0];
    const build = layout.lanes[1];
    expect(plan !== undefined && build !== undefined).toBe(true);
    m.handle(sample("down", main, crossOf("a"), 0));
    expect(lastMove(m.handle(sample("move", main + 20, crossOf("b"), 16)))?.patches[0]?.laneId).toBe("build");
    // In the gap between the lanes: still "build", not cleared.
    const gap = (plan?.cross ?? 0) + (plan?.crossSize ?? 0) + 6;
    const inGap = m.handle(sample("move", main + 40, gap, 32));
    // (No new proposal at all is fine too: then the last one, "build", stands.)
    expect([undefined, "build"]).toContain(lastMove(inGap)?.patches[0]?.laneId);
    // Below the last lane: still "build".
    const below = m.handle(sample("move", main + 60, 390, 48));
    expect(lastMove(below)?.patches[0]?.laneId).toBe("build");
  });

  it("keeps the item's own lane when it never reached another", () => {
    const m = machine();
    const main = scale.toMain(START + 5 * DAY);
    m.handle(sample("down", main, crossOf("b"), 0));
    m.handle(sample("move", main + 20, crossOf("b"), 16));
    const below = lastMove(m.handle(sample("move", main + 40, 390, 32)));
    // Moved, so the assertion on the lane is not vacuous.
    expect(below).toBeDefined();
    // Unset keeps the item's lane; `null` would clear it.
    expect([undefined, "build"]).toContain(below?.patches[0]?.laneId);
  });
});

describe("the axis band", () => {
  const items: readonly Item[] = [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "plan" },
    { id: "b", start: START + 4 * DAY, end: START + 8 * DAY, laneId: "build" },
  ];
  const layout = layoutItems(items, { lanes: LANES });
  const scale = createTimeScale(DOMAIN, 600);
  const axis = 40;

  it("hides the items scrolled under it from the pointer", () => {
    const placed = layout.items.find((candidate) => candidate.item.id === "a");
    // Scrolled so that 15 px above the band's edge is 10 px into "a".
    const tester = createHitTester({ layout, scale, crossInset: axis, crossOffset: (placed?.cross ?? 0) + 25 });
    const main = scale.toMain(START + 4 * DAY);
    expect(tester.hitTest({ main, cross: axis - 15 })).toBeUndefined();
    expect(tester.hitTest({ main, cross: axis - 15 }, "touch")).toBeUndefined();
    expect(tester.laneAt(axis - 15)).toBeUndefined();
    // Below the band, the lanes are there as before.
    expect(tester.laneAt(axis + 10)).toBe("build");
  });

  it("does not start a drag there", () => {
    const placed = layout.items.find((candidate) => candidate.item.id === "a");
    const machine = createInputMachine({
      domain: DOMAIN,
      mainSize: 600,
      crossSize: 300,
      editing: { enabled: true, ...createHitTester({ layout, scale, crossInset: axis, crossOffset: (placed?.cross ?? 0) + 25 }) },
    });
    const main = scale.toMain(START + 4 * DAY);
    const effects = [
      ...machine.handle({ pointerId: 1, phase: "down", x: main, y: axis - 15, time: 0, pointerType: "mouse" }),
      ...machine.handle({ pointerId: 1, phase: "move", x: main + 40, y: axis - 15, time: 16, pointerType: "mouse" }),
    ];
    expect(effects.some((effect) => effect.type === "editStart")).toBe(false);
  });
});

describe("the axis band and a finger", () => {
  it("still lets a finger in the band reach an item drawn right below it", () => {
    const layout = layoutItems([{ id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "plan" }], { lanes: LANES });
    const scale = createTimeScale(DOMAIN, 600);
    const tester = createHitTester({ layout, scale, crossInset: 40 });
    expect(tester.hitTest({ main: scale.toMain(START + 4 * DAY), cross: 34 }, "touch")?.item.id).toBe("a");
    expect(tester.hitTest({ main: scale.toMain(START + 4 * DAY), cross: 34 })).toBeUndefined();
  });
});

describe("a container that collapses to 0 px mid-gesture", () => {
  const touch = (pointerId: number, phase: "down" | "move" | "up" | "cancel", x: number, time: number) =>
    ({ pointerId, phase, x, y: 10, time, pointerType: "touch" }) as const;

  for (const lift of ["up", "cancel"] as const) {
    it(`lets go of the pointer on ${lift}, so the next touch is a first finger again`, () => {
      const machine = createInputMachine({ domain: DOMAIN, mainSize: 600 });
      machine.handle(touch(1, "down", 300, 0));
      machine.handle(touch(1, "move", 340, 16));
      expect(machine.pointerCount).toBe(1);
      machine.resize({ mainSize: 0 });
      const ended = machine.handle(touch(1, lift, 340, 32));
      expect(machine.pointerCount).toBe(0);
      expect(machine.phase).toBe("idle");
      expect(ended.some((effect) => effect.type === "gestureEnd" && effect.cancelled)).toBe(true);
      machine.resize({ mainSize: 600 });
      // One finger pans; a "second finger" would pinch.
      machine.handle(touch(2, "down", 300, 1000));
      const moved = machine.handle(touch(2, "move", 340, 1016));
      expect(machine.pointerCount).toBe(1);
      expect(moved.some((effect) => effect.type === "gestureStart" && effect.kind === "pan")).toBe(true);
    });
  }
});
